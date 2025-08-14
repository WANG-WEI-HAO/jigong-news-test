import json
import os
import io
import datetime
from datetime import timezone, timedelta
import asyncio
import re
import time
from dotenv import load_dotenv
from telethon import TelegramClient, sessions
import requests
import firebase_admin
from firebase_admin import credentials, firestore, storage
# from google.cloud.firestore import FieldPath # 保持註釋或移除這行

# --- 配置區 ---
load_dotenv()

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")
CHANNEL_USERNAME = os.getenv("CHANNEL_USERNAME")
STORAGE_BUCKET_NAME = os.getenv("STORAGE_BUCKET_NAME") 
OUTPUT_JSON_FILENAME = "posts.json"
CLOUD_FUNCTION_BASE_URL = os.getenv("CLOUD_FUNCTION_BASE_URL")
PWA_BASE_URL = os.getenv("PWA_BASE_URL")
SESSION_FILE_PATH = os.getenv('TELEGRAM_SESSION_FILE_PATH', '/secrets/telegram-session')

# 為方便診斷，在啟動時印出 Firebase Admin SDK 版本
print(f"DEBUG: Firebase Admin SDK Version at script start: {firebase_admin.__version__}") 

# 將 Telegram 原始訊息 ID 正規化為固定長度字串的長度。
# 設定為 5 位，表示 ID 將被補零到例如 "00001", "12345" 等格式。
# 重要提示：如果 Telegram 原始 ID (例如 msg.id) 超過 5 位數 (例如 100000)，
# 此設定將導致字串長度不一致，進而影響 Firestore 的字串排序。
# 請確保您的 Telegram 訊息 ID 不會超出這個範圍。
RAW_ID_PAD_LENGTH = 5 
TW_TZ = timezone(timedelta(hours=8))

# --- 模組化函數 ---

def normalize_raw_telegram_id(raw_id_value):
    """
    將原始 Telegram 訊息 ID (數字) 轉換為固定長度、左側補零的字串。
    例如：若 RAW_ID_PAD_LENGTH=5，2132 轉為 "02132"。
    """
    return str(raw_id_value).zfill(RAW_ID_PAD_LENGTH)

def create_composite_id(date_obj, raw_telegram_id):
    """
    根據日期物件和原始 Telegram ID 創建複合 ID 字串 (YYYY-MM-DD_XXXXX)。
    這個複合 ID 將作為 Firestore 文檔的唯一識別符號，並用於排序。
    """
    date_str = date_obj.astimezone(TW_TZ).strftime('%Y-%m-%d')
    normalized_raw_id = normalize_raw_telegram_id(raw_telegram_id)
    return f"{date_str}_{normalized_raw_id}"

def check_env_vars():
    """檢查所有必要的環境變數是否存在且格式正確。"""
    print("--- 步驟 1: 檢查環境變數 ---")
    required_vars = [
        "TELEGRAM_API_ID", "TELEGRAM_API_HASH", "IMGBB_API_KEY", 
        "CHANNEL_USERNAME", "STORAGE_BUCKET_NAME", 
        "CLOUD_FUNCTION_BASE_URL", "PWA_BASE_URL"
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"錯誤：缺少必要的環境變數: {', '.join(missing_vars)}")
        exit(1)
    
    try:
        int(API_ID)
    except (ValueError, TypeError):
        print("錯誤：TELEGRAM_API_ID 必須是數字。")
        exit(1)
    print("✅ 所有環境變數檢查通過。")

def initialize_firebase():
    """初始化 Firebase Admin SDK，並返回 Firestore 和 Storage 的客戶端。"""
    print("--- 2. 初始化 Firebase 服務 ---")
    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={
                'storageBucket': STORAGE_BUCKET_NAME
            })
        print("✅ 成功初始化 Firebase Admin SDK。")
        return firestore.client(), storage.bucket()
    except Exception as e:
        print(f"錯誤：無法初始化 Firebase Admin SDK: {e}")
        exit(1)

def initialize_telethon():
    """從掛載的 Secret 檔案初始化 Telethon 客戶端。"""
    print("--- 3. 初始化 Telegram 用戶端 ---")
    try:
        if not os.path.exists(SESSION_FILE_PATH):
            raise FileNotFoundError(f"指定的 Session 檔案路徑不存在: {SESSION_FILE_PATH}")
        with open(SESSION_FILE_PATH, 'r') as f:
            session_string = f.read()
        session = sessions.StringSession(session_string)
        client = TelegramClient(session, int(API_ID), API_HASH)
        print("✅ 成功從 Secret 檔案初始化 Telethon Session。")
        return client
    except Exception as e:
        print(f"錯誤：從 Secret 檔案初始化 Telethon Session 時發生錯誤: {e}")
        exit(1)

async def upload_to_imgbb(file_bytes_io: io.BytesIO, file_name: str):
    """將圖片上傳到 ImgBB 並返回 URL。"""
    file_bytes_io.seek(0)
    try:
        response = requests.post(
            "https://api.imgbb.com/1/upload",
            params={"key": IMGBB_API_KEY},
            files={"image": (file_name, file_bytes_io, 'image/jpeg')},
            timeout=60
        )
        response.raise_for_status()
        data = response.json()
        if data.get("success"):
            return data["data"]["url"]
        else:
            print(f"警告：ImgBB API 回應未成功。回應: {data}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"警告：上傳到 ImgBB 時發生網路錯誤。錯誤: {e}")
        return None

def trigger_specific_push(payload: dict):
    """向 Cloud Function 發送包含特定內容的推播請求。"""
    print("\n--- 步驟 7: 觸發推播通知 ---")
    if not CLOUD_FUNCTION_BASE_URL:
        print("警告：未設定 CLOUD_FUNCTION_BASE_URL，跳過推播。")
        return
    
    trigger_endpoint = f"{CLOUD_FUNCTION_BASE_URL.rstrip('/')}/send-daily-notification"
    
    print(f"準備發送推播請求至: {trigger_endpoint}")
    print(f"推播內容 Payload: {json.dumps(payload, ensure_ascii=False)}")
    
    try:
        response = requests.post(trigger_endpoint, json=payload, timeout=30)
        response.raise_for_status()
        print("✅ 成功！推播請求已發送。")
        print("Cloud Function 回應:", response.json())
    except requests.exceptions.HTTPError as e:
        print(f"錯誤：觸發推播請求失敗，狀態碼 {e.response.status_code}")
        print("Cloud Function 錯誤回應:", e.response.text)
    except Exception as e:
        print(f"錯誤：觸發推播時發生未知錯誤: {e}")

# --- 主要處理流程 ---
async def main(db, bucket, client):
    """核心業務邏輯：拉取數據、處理、儲存並觸發推播。"""
    print(f"\n--- 腳本主流程開始運行於：{datetime.datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S %Z')} ---")
    start_time = time.time()
    
    # 這裡的 start_date_to_process 不再用於中斷 Telegram 消息拉取循環，
    # 而是用作日誌參考。我們將處理所有在指定 limit 內找到的、需要更新的訊息。
    today_in_tw = datetime.datetime.now(TW_TZ)
    start_of_today_tw = today_in_tw.replace(hour=0, minute=0, second=0, microsecond=0)
    
    print("\n--- 步驟 4: 從 Firestore 讀取現有貼文 ---")
    existing_posts_by_composite_id = {} # 使用複合 ID 作為字典的鍵
    try:
        posts_ref = db.collection('posts').stream()
        for post_doc in posts_ref: 
            post_data = post_doc.to_dict()
            if 'id' in post_data and post_data['id'] is not None and str(post_data['id']).strip() != '':
                composite_id = post_data['id']
                existing_posts_by_composite_id[composite_id] = post_data
            else:
                print(f"警告：Firestore 文檔 '{post_doc.id}' 缺少有效 'id' 字段或格式不符，跳過。")
        print(f"✅ 已讀取 {len(existing_posts_by_composite_id)} 筆現有貼文。")
    except Exception as e:
        print(f"錯誤：無法從 Firestore 讀取完整貼文列表: {e}")
        return

    print("\n--- 步驟 5: 從 Telegram 獲取新訊息或需要更新的訊息 ---")
    await client.connect()
    if not await client.is_user_authorized():
        print("錯誤：Telethon Session 字串無效或已過期。請在本地重新生成並更新 Secret。")
        return
    entity = await client.get_entity(CHANNEL_USERNAME)

    messages_to_process = []
    # 提高 Telegram 訊息拉取限制，以涵蓋更多過去的日期，捕獲漏掉的貼文。
    # 500 條訊息通常足以涵蓋數天的內容，如果頻道更新頻繁，可能需要更高。
    TELEGRAM_FETCH_LIMIT = 500 
    
    async for msg in client.iter_messages(entity, limit=TELEGRAM_FETCH_LIMIT):
        # 不再提前跳出循環，以確保檢查到所有在 FETCH_LIMIT 範圍內的未處理訊息
        if not (msg.text or msg.photo):
            continue
        
        current_composite_id = create_composite_id(msg.date, msg.id)

        # 如果資料庫中沒有此貼文，或貼文有圖片但資料庫中缺少圖片 URL，則加入待處理列表
        if current_composite_id not in existing_posts_by_composite_id or \
           (msg.photo and not existing_posts_by_composite_id.get(current_composite_id, {}).get("image")):
            messages_to_process.append(msg)
            
    # 根據 composite_id 降序排序，確保列表中的第一個是最新且待處理的訊息
    # 這條訊息將被用於推播 (如果最終有推播的話)
    messages_to_process.sort(key=lambda m: create_composite_id(m.date, m.id), reverse=True)

    latest_processed_post_data_for_push = None # 用於儲存本次運行中被新增/更新的最新的貼文資料

    if not messages_to_process:
        print("✅ 沒有找到需要新增或更新的貼文。")
    else:
        print(f"找到 {len(messages_to_process)} 則待處理訊息，開始處理並同步到 Firestore...")
        batch = db.batch()
        posts_collection_ref = db.collection('posts')

        for msg in messages_to_process:
            composite_id_for_firestore = create_composite_id(msg.date, msg.id)
            
            # 從現有資料庫中獲取圖片 URL，如果沒有，則嘗試上傳新圖片
            img_bb_url = existing_posts_by_composite_id.get(composite_id_for_firestore, {}).get("image")
            
            if msg.photo and not img_bb_url:
                text_snippet = re.sub(r'[\s\W]+', '_', (msg.text or "")).strip('_')[:30]
                # 確保文件名的唯一性，包含日期和原始ID
                file_name = f"{msg.date.astimezone(TW_TZ).strftime('%Y-%m-%d')}_{msg.id}_{text_snippet}.jpg"
                photo_bytes_io = io.BytesIO()
                try:
                    await client.download_media(msg.photo, file=photo_bytes_io)
                    img_bb_url = await upload_to_imgbb(photo_bytes_io, file_name)
                    if img_bb_url:
                        print(f"✅ 訊息 {msg.id} 的圖片已上傳到 ImgBB。")
                    else:
                        print(f"❌ 訊息 {msg.id} 的圖片上傳失敗。")
                finally:
                    photo_bytes_io.close()
            
            post_data = { 
                "id": composite_id_for_firestore, 
                "date": msg.date.astimezone(TW_TZ).strftime('%Y-%m-%d'), 
                "text": msg.text or "",
                "image": img_bb_url
            }
            doc_ref = posts_collection_ref.document(composite_id_for_firestore)
            batch.set(doc_ref, post_data)
            
            # 判斷是否為本次運行中新增/更新的最新的貼文，用於推播
            if latest_processed_post_data_for_push is None or post_data['id'] > latest_processed_post_data_for_push['id']:
                latest_processed_post_data_for_push = post_data

        try:
            batch.commit()
            print("✅ 成功！新貼文已同步到 Firestore。")
        except Exception as e:
            print(f"錯誤：寫入 Firestore 失敗: {e}")
            return

    print("\n--- 步驟 6: 更新 Firebase Storage (posts.json) ---")
    all_posts = []
    try:
        # 再次診斷：在執行查詢前，額外印出 firestore 模組的屬性，確認 FieldPath 是否存在。
        print(f"DEBUG: Checking firestore module attributes before query in Step 6.")
        print(f"DEBUG: Is firestore.FieldPath callable? {hasattr(firestore, 'FieldPath')}")

        all_posts_ref = db.collection('posts').order_by('__name__', direction=firestore.Query.DESCENDING).stream()
        for post_doc in all_posts_ref: 
            doc_data = post_doc.to_dict()
            all_posts.append({
                "id": doc_data.get("id"), 
                "date": doc_data.get("date", ""),
                "text": doc_data.get("text", ""),
                "image": doc_data.get("image", None)
            })
        print(f"✅ 成功從 Firestore 獲取到 {len(all_posts)} 筆完整貼文以生成 posts.json。")
    except Exception as e:
        print(f"錯誤：無法從 Firestore 讀取完整貼文列表: {e}") 
        return

    temp_json_path = '/tmp/posts.json'
    try:
        with open(temp_json_path, "w", encoding="utf-8") as f:
            json.dump(all_posts, f, ensure_ascii=False, indent=2)
        
        blob = bucket.blob(OUTPUT_JSON_FILENAME)
        blob.upload_from_filename(temp_json_path)
        blob.make_public() 
        print(f"✅ 成功！'{OUTPUT_JSON_FILENAME}' 已上傳到 Firebase Storage。")
        print(f"公開 URL: {blob.public_url}")

        # 如果有新的貼文被處理並更新到 Firestore，則觸發推播
        if latest_processed_post_data_for_push:
            # 確保推播 URL 指向該特定貼文
            push_title = "✨ 濟公報：今日聖賢語錄 ✨" # 更改為更通用的標題
            push_body = latest_processed_post_data_for_push["text"] or "點此查看最新啟示。"
            push_image = latest_processed_post_data_for_push.get("image")
            push_url = f"{PWA_BASE_URL.rstrip('/')}/?post_id={latest_processed_post_data_for_push['id']}" 
            
            payload_for_push = {
                "title": push_title,
                "body": push_body,
                "image": push_image,
                "url": push_url
            }
            trigger_specific_push(payload_for_push)
        else:
            print("\n本次運行沒有新內容更新至 Firestore，不觸發推播。")
            
    except Exception as e:
        print(f"錯誤：寫入或上傳 posts.json 失敗: {e}")
    finally:
        if os.path.exists(temp_json_path):
            os.remove(temp_json_path)

    end_time = time.time()
    print(f"\n--- 腳本結束運行於：{datetime.datetime.now(TW_TZ).strftime('%Y-%m-%d %H:%M:%S %Z')} ---")
    print(f"總耗時：{end_time - start_time:.2f} 秒")

# --- 腳本執行入口 ---
async def run_wrapper():
    """封裝了初始化和主流程的執行器。"""
    check_env_vars()
    db, bucket = initialize_firebase()
    client = initialize_telethon()
    async with client:
        await main(db, bucket, client)

if __name__ == '__main__':
    try:
        asyncio.run(run_wrapper())
    except Exception as e:
        print(f"腳本執行時發生頂層錯誤: {e}")