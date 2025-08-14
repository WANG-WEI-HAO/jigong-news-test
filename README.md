<<<<<<< HEAD
# 濟公報 (Ji Gong News)

## 專案介紹

這是一個旨在提供每日「濟公報」聖賢語錄的漸進式網頁應用程式 (Progressive Web App, PWA)。此專案透過自動化流程，從 Telegram 頻道匯入最新的聖賢語錄（包含文字與圖片），並將其呈現給使用者。使用者可以訂閱推播通知，以即時接收每日更新。

## 主要功能

*   **每日聖賢語錄**: 展示最新的濟公報聖賢語錄，包含文字內容及相關圖片。
*   **漸進式網頁應用程式 (PWA)**: 提供類似原生應用程式的使用體驗，支援離線瀏覽和「加入主畫面」功能。
*   **推播通知**: 使用者可以訂閱推播通知，每日接收新的語錄提醒，不錯過任何更新。
*   **自動化內容匯入**: 透過 Cloud Run Job 自動從 Telegram 頻道抓取並匯入內容到 Firestore。
*   **訂閱管理**: 後端服務支援訂閱、取消訂閱及清理失效訂閱的功能。

## 技術棧

*   **前端**: HTML, CSS, JavaScript (PWA 相關功能)
*   **後端**: Node.js (Firebase Functions), Express.js
*   **資料庫**: Google Cloud Firestore
*   **雲端服務**: Firebase Hosting, Firebase Functions, Firebase Cloud Messaging (FCM), Cloud Run, Cloud Scheduler
*   **內容來源**: Telegram

## 自動化流程

本專案的核心之一是其自動化內容匯入流程，確保每日聖賢語錄能及時更新。此流程主要透過以下 Google Cloud 服務協同完成：

1.  **Telegram 內容抓取**: 一個定時觸發的 **Cloud Run Job** 負責連接 Telegram 頻道，抓取最新的聖賢語錄（包括文字和圖片）。
2.  **資料處理與儲存**: 抓取到的內容會經過處理，包括圖片上傳至 **Firebase Storage** 並獲取可公開存取的 URL，然後將文字內容和圖片 URL 等結構化資料儲存到 **Cloud Firestore** 資料庫中。
3.  **網頁內容更新**: 儲存在 Firestore 的資料會被用於動態生成或更新 `public/posts.json` 檔案，確保 PWA 可以讀取最新的語錄。
4.  **推播通知觸發**: 在新內容匯入成功後，**Firebase Functions** 會被觸發，向已訂閱的使用者發送推播通知，提醒他們查看最新的濟公報。
5.  **排程管理**: **Cloud Scheduler** 用於設定定時任務，例如每日固定時間觸發 Cloud Run Job 執行內容匯入，以及定期清理失效的推播訂閱。

整個自動化流程旨在最大程度地減少手動干預，確保濟公報的內容更新效率和穩定性。

## 開發與部署

本專案主要使用 Firebase 平台進行部署和管理，並利用 Cloud Functions 處理後端邏輯與推播服務，以及 Cloud Run Jobs 進行定期的資料匯入。

### 環境變數

專案依賴於以下環境變數配置，請確保在部署前設定：

*   `VAPID_PUBLIC_KEY`: 用於 Web Push 通知服務的 VAPID 公鑰。
*   `VAPID_PRIVATE_KEY`: 用於 Web Push 通知服務的 VAPID 私鑰。
*   `VAPID_MAILTO`: 您的聯絡郵箱，用於 VAPID 詳細資訊。
*   `POSTS_JSON_URL`: 存放文章資料 `posts.json` 的公開 URL (通常為 Firebase Storage 或 CDN)。
*   `PWA_BASE_URL`: 您的 PWA 網站的基礎 URL (例如 `https://jigong-news-test.web.app`)。
*   `CLOUD_RUN_PROJECT_ID`: 您的 Google Cloud 專案 ID。
*   `CLOUD_RUN_REGION`: 部署 Cloud Run Job 的區域 (例如 `us-central1`)。
*   `CLOUD_RUN_JOB_NAME`: Cloud Run Job 的名稱 (例如 `telegram-importer-job`)。

### 運行與部署步驟 (簡要)

1.  **安裝依賴**: 
    ```bash
    npm install
    # 或針對 Python 依賴
    pip install -r requirements.txt
    ```
2.  **配置 Firebase**: 確保已安裝 Firebase CLI 並登入，設定您的專案。
3.  **設定環境變數**: 參考上述環境變數，在您的環境中設定。
4.  **部署**:
    *   部署 Firebase Functions: `firebase deploy --only functions`
    *   部署 Firebase Hosting: `firebase deploy --only hosting`
    *   部署 Cloud Run Job (若有修改): `gcloud run jobs deploy [JOB_NAME] --source . --region [REGION] ...`
    *   設定 Cloud Scheduler: 配置定時觸發 Cloud Functions 或 Cloud Run Job。

---
**濟公報** 旨在傳遞正能量與聖賢智慧，幫助人們在日常生活中涵養心性，獲得心靈的平靜與成長。

## 版本資訊

v2.0.0
=======
# jigong-news
濟公報每日更新
>>>>>>> 32bfb1b10967c5ba54952326d1828b3f3fae5759
