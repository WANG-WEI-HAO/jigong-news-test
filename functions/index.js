// functions/index.js (最終整合版)

// 導入 dotenv 並在最頂部進行配置，以載入 .env 檔案中的變數
require('dotenv').config();

const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const { JobsClient } = require('@google-cloud/run');
const axios = require('axios'); // 確保已引入 axios

// 【新增】定義 app 變數
const app = express(); // <--- 這裡已經修正了

// 【新增】判斷是否在模擬器環境
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

// --- 初始化 ---
// 【修改】Firebase Admin 初始化，判斷是否在模擬器
if (isEmulator) {
  // 在本地模擬器中，使用一個簡單的憑證，並指向模擬器 Firestore
  admin.initializeApp({ projectId: 'jigong-news-test' }); // 必須指定專案ID
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'; // 通常模擬器埠號，但應依實際設定
} else {
  // 在雲端環境，自動獲取憑證
  admin.initializeApp();
}
const db = admin.firestore();

// --- 中介軟體設定 ---
// 為了安全，只允許來自您 PWA 網站的請求
app.use(cors({ origin: ['https://jigong-news-test.web.app', 'http://localhost:5501', 'http://127.0.0.1:5501'] })); // 允許本地開發
app.use(express.json());

// --- 輔助函數 ---
/**
 * 安全地編碼字串為 Firestore 文件 ID。
 * 避免使用不安全字元，將斜線替換為底線。
 * @param {string} str - 要編碼的字串。
 * @returns {string|null} - 編碼後的字串或 null (如果輸入為空)。
 */
function safeEncode(str) {
  if (!str) return null;
  return Buffer.from(str).toString('base64').replace(/\//g, '_');
}

// --- VAPID 金鑰初始化 (從 process.env 讀取) ---
try {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  let email = process.env.VAPID_MAILTO;
  
  if (!email) {
    console.warn("警告：VAPID_MAILTO 未設定，將使用預設郵箱。");
    email = 'mailto:your-default-email@example.com';
  } else if (!email.startsWith('mailto:')) {
    email = `mailto:${email}`;
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("啟動錯誤：VAPID_PUBLIC_KEY 或 VAPID_PRIVATE_KEY 未在環境變數中設定！");
  } else {
    // 【重要】VAPID 金鑰順序為：subject (mailto), publicKey, privateKey
    webpush.setVapidDetails(email, vapidPublicKey, vapidPrivateKey); 
    console.log("WebPush VAPID 金鑰已成功從環境變數設定。");
  }
} catch (error) {
  console.error("設定 WebPush 時發生嚴重錯誤:", error.message);
}

// 【核心輔助函數】負責發送實際的推播通知
/**
 * 向所有訂閱者發送推播通知。
 * 會自動處理失效的訂閱 (HTTP 404/410)。
 * @param {object} payload - 推播通知的內容物件 (會被 JSON.stringify 處理)。
 * @returns {Promise<object>} - 包含狀態、訊息和嘗試發送訂閱數的物件。
 */
async function sendPushNotificationsToSubscribers(payload) { // 移除 res 參數，使其更通用
  try {
    const snapshot = await db.collection('subscriptions').get();
    if (snapshot.empty) {
      console.log("沒有找到任何訂閱者。");
      return { status: 200, message: "No subscribers to notify." };
    }
    
    const subscriptions = snapshot.docs.map(doc => doc.data());
    const pushPromises = subscriptions.map(sub => 
        webpush.sendNotification(sub, JSON.stringify(payload)).catch(async (err) => { 
            if (err.statusCode === 404 || err.statusCode === 410) {
                // 偵測到失效訂閱，自動從 Firestore 刪除
                const docIdToDelete = safeEncode(err.endpoint || sub.endpoint);
                if(docIdToDelete) {
                    await db.collection('subscriptions').doc(docIdToDelete).delete();
                    console.log(`偵測並刪除了失效的訂閱: ${docIdToDelete}`);
                }
            } else {
                console.error('發送推播失敗 (非 404/410):', err.statusCode, err.body);
            }
        })
    );
    
    await Promise.all(pushPromises);
    
    const message = `推播任務完成，嘗試發送給 ${subscriptions.length} 位訂閱者。`;
    console.log(message);
    return { status: 200, message: message, count: subscriptions.length }; // 回傳訂閱數

  } catch (error) {
    console.error("處理推播通知發送時發生嚴重錯誤:", error);
    return { status: 500, message: "Failed to send notifications.", details: error.message };
  }
}

// ==========================================================
// --- API 路由 (API Endpoints) ---
// ==========================================================

// 提供公鑰給前端
app.get('/vapid-public-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(500).send("VAPID Public Key is not configured on the server.");
  }
  // 【優化】增加快取控制，讓瀏覽器快取公鑰一天
  res.set('Cache-Control', 'public, max-age=86400'); 
  res.status(200).send(publicKey);
});

// 處理新的訂閱
app.post('/subscribe', async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "無效的訂閱物件。" });
  }
  try {
    const docId = safeEncode(subscription.endpoint);
    const dataToSave = {
      ...subscription,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('subscriptions').doc(docId).set(dataToSave);
    console.log("成功儲存訂閱，文件 ID:", docId);
    res.status(201).json({ message: "Subscription added successfully." });
  } catch (error) {
    console.error("Firestore 寫入失敗:", error);
    res.status(500).json({ error: "Failed to save subscription." });
  }
});

// 處理取消訂閱
app.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "缺少訂閱的 endpoint。" });
  }
  try {
    const docId = safeEncode(endpoint);
    await db.collection('subscriptions').doc(docId).delete();
    res.status(200).json({ message: "Subscription removed successfully." });
  } catch (error) {
    console.error("Firestore 刪除失敗:", error);
    res.status(500).json({ error: "Failed to remove subscription." });
  }
});

// 處理前端的心跳回報 (用於更新 lastSeen 時間戳)
app.post('/heartbeat', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "缺少 endpoint。" });
  }
  try {
    const docId = safeEncode(endpoint);
    await db.collection('subscriptions').doc(docId).update({
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).json({ message: "Heartbeat successful." });
  } catch (error) {
    // 裝置可能已清除資料或為新的，更新失敗是正常情況，回應 200
    res.status(200).json({ message: "Heartbeat failed, device might be new or cleared." });
  }
});

// 【核心路由】接收來自 Python 或其他服務的特定推播內容並發送
app.post('/send-daily-notification', async (req, res) => {
  console.log("收到特定內容推播請求:", req.body);
  const { title, body, image, url } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "請求中缺少 'title' 或 'body'。" });
  }

  // 構建推播 payload 物件 (會在 sendPushNotificationsToSubscribers 內被 stringify)
  const payload = { 
    title: title,
    body: body,
    image: image || '',
    url: url || process.env.PWA_BASE_URL || 'https://jigong-news-test.web.app',
    icon: `${process.env.PWA_BASE_URL || 'https://jigong-news-test.web.app'}/icons/icon-192.png`,
  };

  // 呼叫核心輔助函數發送推播
  const result = await sendPushNotificationsToSubscribers(payload);
  res.status(result.status).json({ message: result.message, details: result.details, count: result.count });
});

// 手動觸發今天的最新貼文推播 API (通常用於管理介面或排程)
app.post('/manual-daily-notification', async (req, res) => {
  console.log("收到手動觸發今日最新貼文推播的請求。");

  const POSTS_JSON_URL = process.env.POSTS_JSON_URL;
  const PWA_BASE_URL = process.env.PWA_BASE_URL;

  if (!POSTS_JSON_URL || !PWA_BASE_URL) {
      console.error('錯誤：環境變數 POSTS_JSON_URL 或 PWA_BASE_URL 未設定。');
      return res.status(500).json({ error: '伺服器設定不完整，無法執行手動推播。' });
  }

  try {
      // 1. 從設定的 URL (通常是 Firebase Storage) 獲取最新的 posts.json
      const response = await axios.get(POSTS_JSON_URL, { timeout: 15000 }); // 增加超時時間以確保穩定性
      const allPosts = response.data;

      if (!Array.isArray(allPosts) || allPosts.length === 0) {
          console.log("posts.json 是空的或格式不正確，沒有文章可以推播。");
          return res.status(200).json({ message: "No posts found for push notification." });
      }

      const latestPost = allPosts[0]; // 假定最新文章是 JSON 陣列中的第一個

      // 2. 構建推播 Payload
      const pushPayload = {
          title: "✨ 濟公報：今日聖賢語錄 ✨", // 手動觸發時使用特定標題
          body: latestPost.text || "點此查看最新內容。", 
          image: latestPost.image || '',
          url: `${PWA_BASE_URL.replace(/\/+$/, '')}/?post_id=${latestPost.id}` // 確保 URL 正確拼接並移除末尾斜線
      };

      // 3. 呼叫核心推播發送輔助函數
      const result = await sendPushNotificationsToSubscribers(pushPayload);
      res.status(result.status).json({ message: result.message, details: result.details, count: result.count });

  } catch (error) {
      console.error("手動觸發推播時發生錯誤:", error);
      // 【優化】更詳細的錯誤日誌，有助於問題排查
      if (error.response) {
        console.error("錯誤回應狀態:", error.response.status);
        console.error("錯誤回應數據:", error.response.data);
      } else if (error.request) {
        console.error("錯誤請求:", error.request);
      } else {
        console.error("錯誤訊息:", error.message);
      }
      res.status(500).json({ error: `手動觸發推播失敗: ${error.message}` });
  }
});

// 【新增路由】取得推播訂閱的總數 (方便管理和監控)
app.get('/subscription-count', async (req, res) => {
  console.log("收到取得訂閱數量的請求。");
  try {
    const snapshot = await db.collection('subscriptions').get();
    const count = snapshot.size;
    console.log(`目前訂閱數為: ${count}`);
    res.status(200).json({ count: count });
  } catch (error) {
    console.error("取得訂閱數失敗:", error);
    res.status(500).json({ error: "無法取得訂閱數。", details: error.message });
  }
});

// 將 Express 應用程式導出為 HTTP 觸發的 Cloud Function
// 所有的 app.get/post 路由都會透過 exports.api 導出
exports.api = onRequest(app); 

// ==========================================================
// --- 排程函式：每天自動清理殭屍訂閱 (Cloud Scheduler 觸發) ---
// ==========================================================
exports.cleanupzombiesubscriptions = onSchedule("every day 04:00", async (event) => {
  console.log("開始執行每日殭屍訂閱清理任務...");
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 30); // 30 天前
  const threeDaysAgoTimestamp = admin.firestore.Timestamp.fromDate(threeDaysAgo);

  try {
    // 查詢 'lastSeen' 時間戳早於30天前的訂閱
    const oldSubscriptionsQuery = db.collection('subscriptions').where('lastSeen', '<', threeDaysAgoTimestamp);
    const snapshot = await oldSubscriptionsQuery.get();

    if (snapshot.empty) {
      console.log("沒有找到需要清理的過期訂閱。");
      return null;
    }
    
    // 批量刪除過期訂閱以提高效率
    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`成功刪除了 ${snapshot.size} 個過期的殭屍訂閱。`);
    return null;
  } catch (error) {
    console.error("清理殭屍訂閱任務失敗:", error);
    return null;
  }
});

// ==========================================================
// --- Cloud Run 作業觸發器 (Job Trigger Function) (Cloud Scheduler 觸發) ---
// ==========================================================
/**
 * 這個函式會被 Cloud Scheduler 呼叫，然後它再去安全地執行 Cloud Run Job。
 * 用於觸發定期的資料匯入或其他批次作業。
 */
exports.jobTriggerFunction = onRequest(async (req, res) => {
  console.log('接收到 Cloud Scheduler 的觸發請求，準備執行 telegram-importer-job...');

  // 從環境變數獲取配置，如果沒有則使用預設值
  // 確保這些值與您的專案設定一致
  const projectId = process.env.CLOUD_RUN_PROJECT_ID || 'jigong-news-test'; // 從環境變數讀取
  const region = process.env.CLOUD_RUN_REGION || 'us-central1'; 
  const jobName = process.env.CLOUD_RUN_JOB_NAME || 'telegram-importer-job';

  // 初始化 Cloud Run API 客戶端
  const client = new JobsClient();
  
  // 組合出要執行的 Job 的完整名稱
  const name = client.jobPath(projectId, region, jobName);

  try {
    // 執行 Cloud Run Job，這是一個非同步操作
    const [operation] = await client.runJob({ name });
    console.log(`成功觸發 Cloud Run Job 的執行操作: ${operation.name}`);
    
    // 立即回應給 Cloud Scheduler，告訴它觸發成功，不需要等待 Job 完成
    res.status(200).send({ message: 'Cloud Run Job 已成功觸發。' });
  } catch (error) {
    console.error('觸發 Cloud Run Job 失敗:', error);
    res.status(500).send({ error: `觸發 Job 失敗: ${error.message}` });
  }
});