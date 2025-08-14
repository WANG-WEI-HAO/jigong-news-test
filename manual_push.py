# manual_push.py

import os
import requests
import json
from dotenv import load_dotenv

# --- 配置區 ---
# 這個腳本會從您的 .env 檔案讀取設定
load_dotenv()

# 1. 您的 posts.json 的公開 URL
#    (這是 everypy.py 成功執行後，上傳到 Firebase Storage 的那個檔案的 URL)
POSTS_JSON_URL = os.getenv("POSTS_JSON_URL")

# 2. 您的 Cloud Function API 的基礎 URL
CLOUD_FUNCTION_BASE_URL = os.getenv("CLOUD_FUNCTION_BASE_URL")

# 3. 您的 PWA 網站的基礎 URL
PWA_BASE_URL = os.getenv("PWA_BASE_URL")

# --- 檢查配置 ---
if not all([POSTS_JSON_URL, CLOUD_FUNCTION_BASE_URL, PWA_BASE_URL]):
    print("錯誤：請確保您的 .env 檔案中包含了 POSTS_JSON_URL, CLOUD_FUNCTION_BASE_URL 和 PWA_BASE_URL。")
    exit(1)

def main():
    """
    主函數：獲取最新貼文並觸發手動推播。
    """
    print("--- 開始手動推播任務 ---")

    # --- 步驟 1: 從 Firebase Storage 獲取最新的 posts.json ---
    print(f"正在從 {POSTS_JSON_URL} 獲取最新貼文列表...")
    try:
        response = requests.get(POSTS_JSON_URL, timeout=10)
        response.raise_for_status() # 如果請求失敗 (如 404)，會拋出異常
        all_posts = response.json()
        
        if not all_posts or not isinstance(all_posts, list):
            print("錯誤：獲取到的 posts.json 內容為空或格式不正確。")
            return
            
        print(f"✅ 成功獲取到 {len(all_posts)} 筆貼文。")

    except requests.exceptions.RequestException as e:
        print(f"錯誤：無法獲取 posts.json 檔案。請檢查 URL 是否正確以及檔案是否已公開。")
        print(f"錯誤詳情: {e}")
        return

    # --- 步驟 2: 提取最新一則貼文並準備 Payload ---
    latest_post = all_posts[0] # JSON 檔案已按 ID 降序排列，第一個就是最新的
    post_id = latest_post.get("id")
    post_text = latest_post.get("text", "")
    post_image = latest_post.get("image")
    
    print(f"將推播的最新貼文 ID: {post_id}")
    
    # 準備推播的 Payload
    push_payload = {
        "title": "✨ 濟公報：今日最新聖賢語錄 ✨",
        "body": post_text or "點此查看今日的最新啟示。",
        #"image": post_image,
        "url": f"{PWA_BASE_URL.rstrip('/')}/?post_id={post_id}" # 點擊後可直接定位到文章
    }

    # --- 步驟 3: 呼叫 Cloud Function API 觸發推播 ---
    trigger_endpoint = f"{CLOUD_FUNCTION_BASE_URL.rstrip('/')}/send-daily-notification"
    
    print(f"\n準備發送推播請求至: {trigger_endpoint}")
    print(f"推播內容 Payload: {json.dumps(push_payload, ensure_ascii=False)}")
    
    try:
        api_response = requests.post(trigger_endpoint, json=push_payload, timeout=30)
        api_response.raise_for_status()
        print("\n✅ 成功！手動推播請求已發送。")
        print("Cloud Function 回應:", api_response.json())
        
    except requests.exceptions.HTTPError as e:
        print(f"\n錯誤：觸發推播請求失敗，狀態碼 {e.response.status_code}")
        print("Cloud Function 錯誤回應:", e.response.text)
    except Exception as e:
        print(f"\n錯誤：觸發推播時發生未知錯誤: {e}")
        
    print("\n--- 手動推播任務結束 ---")


if __name__ == '__main__':
    main()