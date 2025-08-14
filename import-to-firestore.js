// import-to-firestore.js (修正版 - ID 規格統一為 日期_5位ID)

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 確保您的服務帳戶金鑰檔案路徑正確
const serviceAccount = require('./my-sa-key.json');

// 初始化 Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const postsFilePath = path.join(__dirname, 'public', 'posts.json');
const postsCollection = db.collection('posts');

// 定義批次提交的大小
const BATCH_SIZE = 500;
// 定義原始 ID 的補零長度，與 everypy.py 中的 RAW_ID_PAD_LENGTH 保持一致。
const RAW_ID_PAD_LENGTH = 5; 
const ID_PAD_CHAR = '0'; // 補零字符

/**
 * 將原始 ID 轉換為固定長度、左側補零的字串。
 * @param {*} rawIdValue 原始的文章ID (通常是數字)
 * @returns {string} 補零後的原始ID字串
 */
function normalizeRawIdString(rawIdValue) {
  return String(rawIdValue).padStart(RAW_ID_PAD_LENGTH, ID_PAD_CHAR);
}

/**
 * 根據日期字串和原始 ID 創建複合 ID 字串 (YYYY-MM-DD_XXXXX)。
 * @param {string} dateStr 日期字串 (YYYY-MM-DD)
 * @param {*} rawId 原始的文章ID
 * @returns {string} 複合 ID 字串
 */
function createCompositeId(dateStr, rawId) {
    const normalizedRawId = normalizeRawIdString(rawId);
    return `${dateStr}_${normalizedRawId}`;
}

async function importPosts() {
  try {
    console.log('正在讀取 posts.json...');
    const postsData = fs.readFileSync(postsFilePath, 'utf8');
    const posts = JSON.parse(postsData);

    if (!Array.isArray(posts) || posts.length === 0) {
      console.log('posts.json 是空的或格式不正確，沒有文章可以匯入。');
      return;
    }

    console.log(`找到了 ${posts.length} 篇文章，準備寫入 Firestore...`);

    let batch = db.batch(); // 初始化 Firestore 批次物件
    let writeCount = 0; // 成功加入批次的文章數量
    let skippedCount = 0; // 因缺少或無效 'id' 字段而被跳過的文章數量

    for (const post of posts) {
      // 檢查 post.id 和 post.date 的有效性
      if (post.id === undefined || post.id === null || String(post.id).trim() === '' ||
          post.date === undefined || post.date === null || String(post.date).trim() === '') {
        console.warn(`跳過文章 (ID 或 Date 缺失/為空):`, post);
        skippedCount++;
      } else {
        // 使用新的 createCompositeId 函數生成複合 ID
        const compositeId = createCompositeId(post.date, post.id);

        // 準備要寫入 Firestore 的數據，確保每個字段都存在
        const post_data = {
          "id": compositeId, // 這裡的 id 欄位就是複合 ID 字串
          "date": post.date, // 保持日期字串，確保與複合 ID 的日期部分一致
          "text": post.text || "",
          "image": post.image || ""
        };

        // 使用複合 ID 作為 Firestore 文件 ID
        const docRef = postsCollection.doc(compositeId);
        batch.set(docRef, post_data);
        writeCount++;

        // 當達到批次大小時，提交當前批次並啟動一個新的批次
        if (writeCount % BATCH_SIZE === 0) {
          await batch.commit();
          console.log(`已提交 ${writeCount} 篇文章到 Firestore。`);
          batch = db.batch(); // 重置並開始新的批次
        }
      }
    }

    // 提交循環結束後所有剩餘的批次（如果有）
    if (writeCount > 0 && (writeCount % BATCH_SIZE !== 0 || writeCount === posts.length)) {
        await batch.commit();
        console.log(`最終提交了所有 ${writeCount} 篇文章到 Firestore。`);
    } else if (writeCount === 0 && posts.length > 0 && skippedCount === posts.length) {
        console.log('所有文章因缺少有效ID而被跳過，沒有文章寫入Firestore。');
    } else if (writeCount === 0 && posts.length === 0) {
        console.log('posts.json 是空的，沒有文章可以處理。');
    }

    console.log(`\n--- 匯入摘要 ---`);
    console.log(`總共處理了 ${posts.length} 篇文章。`);
    console.log(`成功嘗試寫入 ${writeCount} 篇文章到 Firestore。`);
    if (skippedCount > 0) {
        console.log(`有 ${skippedCount} 篇文章因缺少或無效 'id' 字段而被跳過。`);
    }
    console.log('文章匯入過程完成。');

  } catch (error) {
    console.error('匯入過程中發生錯誤:', error);
  }
}

importPosts();