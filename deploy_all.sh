#!/bin/bash

# 當任何命令失敗時，腳本會立即退出
set -e

# --- 0. 配置變數 (請替換為您的實際值) ---
# --- 這裡的變數將用於設定所有服務 ---

# 您的新專案 ID (必須與您在 Google Cloud Console 中建立的 Project ID 完全一致)
NEW_PROJECT_ID="jigong-news-test"

# 您的 Telegram 和 ImgBB API Keys
YOUR_TELEGRAM_API_ID="24497815"
YOUR_TELEGRAM_API_HASH="a97f0ae369dae84561e49303c377ced5"
YOUR_IMGBB_API_KEY="58342c11a0848b6e2ae760743bd54b44"
YOUR_CHANNEL_USERNAME="jigongnews" # 您的 Telegram 頻道用戶名

# 您的 WebPush VAPID 金鑰
# 注意：這些金鑰必須是單一行，不含空格或換行
YOUR_VAPID_PUBLIC_KEY="BDPg6TWD3x3u1dAV_xVTui_bFoVWJUGyPoGOMEms-JQuABxuYduW2apwUIsB_FXfKadEWEvI-FNQUk2I6CPTBZk"
YOUR_VAPID_PRIVATE_KEY="PiO0-R-dI_UsXXdkVEHRbLYTpXRjmSPRJEETijNC5rQ" # <-- 保持已移除空格的版本

YOUR_VAPID_MAILTO="fycd.tc.jigong.news@gmail.com" # 聯絡郵箱

# --- 獲取動態生成的專案編號和預設服務帳號 ---
# 這些變數會在腳本執行時自動獲取，您無需修改
echo "--- 資訊獲取中 ---"
NEW_PROJECT_NUMBER=$(gcloud projects describe ${NEW_PROJECT_ID} --format="value(projectNumber)" || { echo "ERROR: 無法獲取專案編號。請確認專案ID '${NEW_PROJECT_ID}' 正確且您有權限。"; exit 1; })
COMPUTE_SA_EMAIL="${NEW_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
FIREBASE_APP_SPOT_BUCKET="${NEW_PROJECT_ID}.firebasestorage.app" # Firebase Storage 的預設 Bucket 通常是 appspot.com 結尾

# 推播 URL 和 PWA 基礎 URL
# 這些將根據新專案自動生成
# 注意: Cloud Function URL 在函數部署成功後才能確定，這裡只是預期格式
CLOUD_FUNCTION_BASE_URL="https://us-central1-${NEW_PROJECT_ID}.cloudfunctions.net/api"
PWA_BASE_URL="https://${NEW_PROJECT_ID}.web.app" # Firebase Hosting 的預設 URL

# Cloud Run Job 的名稱和區域 (保持不變)
CLOUD_RUN_JOB_NAME="telegram-importer-job"
REGION="us-central1"

# --- Telethon Session String (【非常重要】請手動將您的 Session 字串貼到這裡) ---
# 您需要運行 generate_session.py 腳本，獲取並貼上實際的 Session 字串
# 注意：請將這行替換為您從 generate_session.py 獲取到的實際字串！
YOUR_TELEGRAM_SESSION_STRING="1BVtsOGwBu2fVtBZ5q6i1QAt3Jvksf07Hf2SEWdQsVAd4tBjHYgvoXALqg_RXTnXkjfuEmiFf_XEK5SAJKlxkzU9egEpnsd9cw6Rj7xGHTTyeUr_zWtebM1wbcsIJYpDhC2cVchQ69vUxC6XWtoohNVWrPP3mSe2XmKNpWM5lXWzh_481soMhqiUQ-AFsleVbWXxmiJu3ESsZIhmlv2ekA_x9dQPAtWDtDrM_gRxGgPlUZ9SJFdchxh8bp7D7gks0hg05sRBdzVZqEREXlRqDQtR6nTsCILtT4yu71hOsT1QAmRaPy_9FAFOZwcdQPCuZ2i76hDCEppbToXXV91gDs4THyXWEY5Q="
echo "✅ 變數準備完成。"

echo ""
echo "--- 1. 確保專案已設定 ---"
echo "當前 gcloud 專案: $(gcloud config get-value project)"
# 檢查 Firebase 專案是否存在且為當前專案
if ! firebase projects:list --project=${NEW_PROJECT_ID} | grep -q "${NEW_PROJECT_ID}"; then
  echo "ERROR: Firebase 專案 '${NEW_PROJECT_ID}' 不存在或未正確關聯。請在 Firebase Console 中建立專案並使用 'firebase use ${NEW_PROJECT_ID}' 設定。"
  exit 1
fi
echo "當前 firebase 專案: ${NEW_PROJECT_ID}"
echo "✅ 專案設定檢查完成。"

echo ""
echo "--- 2. 啟用所有必要 API ---"
gcloud services enable compute.googleapis.com \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  --project=${NEW_PROJECT_ID} || { echo "ERROR: 啟用必要 API 失敗。"; exit 1; }
echo "✅ 必要 API 已啟用。"

echo ""
echo "--- 3. 建立 Secret Manager 中的 Telegram Session ---"
# 檢查 Secret 是否已存在
if gcloud secrets describe telegram-session-string --project=${NEW_PROJECT_ID} &>/dev/null; then
  echo "ℹ️ Secret 'telegram-session-string' 已存在。跳過創建。"
else
  echo "ℹ️ Secret 'telegram-session-string' 不存在，正在創建..."
  gcloud secrets create telegram-session-string --data-file=<(echo "${YOUR_TELEGRAM_SESSION_STRING}") \
    --project=${NEW_PROJECT_ID} || { echo "ERROR: 創建 Secret 'telegram-session-string' 失敗。"; exit 1; }
fi

# 授予 Cloud Compute 預設服務帳號讀取 Secret 的權限 (此操作是冪等的，即使已存在也會成功)
gcloud secrets add-iam-policy-binding telegram-session-string \
  --member="serviceAccount:${COMPUTE_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project=${NEW_PROJECT_ID} || { echo "ERROR: 授予 Secret Accessor 權限失敗。"; exit 1; }
echo "✅ Telegram Session 已安全設定。"

echo ""
echo "--- 4. 授予必要 IAM 權限 (給預設 Compute SA 和您的使用者帳號) ---"
# 給 Compute 預設服務帳號 Cloud Build Builder 角色 (部署 Functions 和 Jobs 需要)
# 注意：這些是專案層級的權限，通常只需執行一次或確認已存在
gcloud projects add-iam-policy-binding ${NEW_PROJECT_ID} \
  --member="serviceAccount:${COMPUTE_SA_EMAIL}" \
  --role="roles/cloudbuild.builds.builder" || { echo "ERROR: 授予 Compute SA Cloud Build Builder 權限失敗。"; exit 1; }

echo "✅ 必要 IAM 權限已授予 (專案層級)。Cloud Run Job 的執行權限將在該服務部署後授予。"

echo ""
# --- 5. 設定 Firebase Functions 環境變數 ---
echo "--- 5. 設定 Firebase Functions 環境變數 ---"
echo "ℹ️  進入 functions 目錄並安裝/更新依賴、修復npm漏洞..."
(cd functions && \
  npm install || { echo "ERROR: functions 目錄 npm install 失敗。"; exit 1; }
  npm audit fix --force || { echo "WARNING: functions 目錄 npm audit fix --force 執行失敗或存在未修復漏洞。"; }
  # 由於 firebase-functions@latest 可能要求 Node 22，這裡暫時不強制更新，以免引入新的本地環境問題
  # 但 Cloud Functions 部署時會自動使用 package.json 中定義的 Node 版本。
  # npm install --save firebase-functions@latest || { echo "WARNING: functions 目錄 firebase-functions 更新失敗。"; }
) || { echo "ERROR: 無法進入 functions 目錄或執行npm操作。"; exit 1; }

# 重新使用 firebase functions:config:set
firebase functions:config:set \
  vapid.public_key="${YOUR_VAPID_PUBLIC_KEY}" \
  vapid.private_key="${YOUR_VAPID_PRIVATE_KEY}" \
  vapid.mailto="${YOUR_VAPID_MAILTO}" \
  pwa.base_url="${PWA_BASE_URL}" \
  posts.json_url="https://storage.googleapis.com/${FIREBASE_APP_SPOT_BUCKET}/posts.json" \
  --project=${NEW_PROJECT_ID} || { echo "ERROR: 設定 Firebase Functions 環境變數失敗。"; exit 1; }

echo "✅ Firebase Functions 環境變數已設定。"
echo "⚠️  DEPRECATION NOTICE: Firebase Functions functions.config() API 將於 2025 年 12 月 31 日廢棄。"
echo "⚠️  請考慮將環境變數遷移到 .env 文件或其他推薦方式：https://firebase.google.com/docs/functions/config-env#migrate-to-dotenv"


echo ""
echo "--- 6. 部署 Firebase Hosting (PWA 前端) ---"
firebase deploy --only hosting --project=${NEW_PROJECT_ID} || { echo "ERROR: 部署 Firebase Hosting 失敗。"; exit 1; }
echo "✅ Firebase Hosting 已部署。"

echo ""
echo "--- 7. 部署 Firebase Functions (API 和 Job Trigger) ---"
echo "嘗試刪除舊的 Cloud Functions (如果存在)..."
# 使用 2>/dev/null 隱藏 404 錯誤，但保留 || true 確保即使命令返回非零狀態碼也不會退出
gcloud functions delete api --region=${REGION} --project=${NEW_PROJECT_ID} --quiet 2>/dev/null || true
gcloud functions delete cleanupzombiesubscriptions --region=${REGION} --project=${NEW_PROJECT_ID} --quiet 2>/dev/null || true
gcloud functions delete jobTriggerFunction --region=${REGION} --project=${NEW_PROJECT_ID} --quiet 2>/dev/null || true
echo "開始部署新的 Cloud Functions..."

# 執行 Firebase Functions 部署並捕獲輸出
FUNCTIONS_DEPLOY_OUTPUT=$(firebase deploy --only functions --project=${NEW_PROJECT_ID} 2>&1 || { echo "ERROR: 部署 Firebase Functions 失敗。請檢查上方的錯誤訊息，可能是Node.js版本、依賴問題或代碼錯誤。"; exit 1; })

echo "${FUNCTIONS_DEPLOY_OUTPUT}" # 重新打印部署輸出到控制台

# 從 Firebase deploy 的輸出中解析 jobTriggerFunction 的 URL
JOB_TRIGGER_FUNCTION_URL=$(echo "${FUNCTIONS_DEPLOY_OUTPUT}" | grep "Function URL (jobTriggerFunction(us-central1)):" | awk '{print $NF}')

if [ -z "${JOB_TRIGGER_FUNCTION_URL}" ]; then
    echo "ERROR: 無法從 Firebase Deploy 輸出中解析 jobTriggerFunction 的 URL。"
    echo "請手動從以下連結查詢並驗證 jobTriggerFunction 的 URL："
    echo "Cloud Functions 控制台: https://console.cloud.google.com/functions/list?project=${NEW_PROJECT_ID}®ion=${REGION}"
    echo "或者直接訪問：https://console.cloud.google.com/run/detail/us-central1/jobtriggerfunction/metrics?project=${NEW_PROJECT_ID}"
    echo "如果找到 URL，請將其手動填入腳本的 JOB_TRIGGER_FUNCTION_URL 變數中，然後重試。"
    exit 1
fi

echo "✅ Firebase Functions 已部署。"
echo "⚠️  注意：functions.config() API 已被廢棄。請及時規劃環境變數遷移。"


echo ""
echo "--- 8. 部署 Cloud Run Job (everypy.py) ---"
# 這裡我們選擇在腳本中動態生成一個臨時的 job.yaml
TEMP_JOB_YAML_PATH="temp_job_deploy.yaml"
cat <<EOF > "${TEMP_JOB_YAML_PATH}"
apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: ${CLOUD_RUN_JOB_NAME}
  namespace: ${NEW_PROJECT_ID} # 確保在正確的命名空間
spec:
  template:
    spec:
      template:
        spec:
          containers:
          - image: gcr.io/${NEW_PROJECT_ID}/telegram-importer:latest # 使用新專案的映像檔路徑
            env:
            - name: TELEGRAM_API_ID
              value: '${YOUR_TELEGRAM_API_ID}'
            - name: TELEGRAM_API_HASH
              value: '${YOUR_TELEGRAM_API_HASH}'
            - name: IMGBB_API_KEY
              value: '${YOUR_IMGBB_API_KEY}'
            - name: CHANNEL_USERNAME
              value: '${YOUR_CHANNEL_USERNAME}'
            - name: STORAGE_BUCKET_NAME
              value: '${FIREBASE_APP_SPOT_BUCKET}' # 使用新專案的預設 Storage Bucket
            - name: CLOUD_FUNCTION_BASE_URL
              value: '${CLOUD_FUNCTION_BASE_URL}'
            - name: PWA_BASE_URL
              value: '${PWA_BASE_URL}'
            volumeMounts:
            - name: secrets
              mountPath: /secrets
              readOnly: true
          volumes:
          - name: secrets
            secret:
              secretName: telegram-session-string
              items:
              - key: latest
                path: telegram-session
EOF

echo "建置 Cloud Run Job 映像檔..."
gcloud builds submit --tag gcr.io/${NEW_PROJECT_ID}/telegram-importer:latest \
  --project=${NEW_PROJECT_ID} || { echo "ERROR: 建置 Cloud Run Job 映像檔失敗。請檢查 Dockerfile 或源碼。"; exit 1; }

echo "部署 Cloud Run Job..."
gcloud run jobs replace "${TEMP_JOB_YAML_PATH}" --region=${REGION} --project=${NEW_PROJECT_ID} || { echo "ERROR: 部署 Cloud Run Job 失敗。"; exit 1; }
rm "${TEMP_JOB_YAML_PATH}" # 清理臨時文件

# 在 Cloud Run Job 部署成功後，授予 Scheduler 觸發 Job 的權限
echo "授予 Cloud Run Job 的 Invoker 權限給 Compute 服務帳號..."
gcloud run jobs add-iam-policy-binding ${CLOUD_RUN_JOB_NAME} \
  --region=${REGION} \
  --member="serviceAccount:${COMPUTE_SA_EMAIL}" \
  --role="roles/run.invoker" || { echo "ERROR: 授予 Cloud Run Job Invoker 權限失敗。"; exit 1; }

echo "✅ Cloud Run Job 已部署。"

echo ""
echo "--- 9. 設定 Cloud Scheduler 觸發 Job Trigger Function ---"

# 現在 JOB_TRIGGER_FUNCTION_URL 應該已經在步驟 7 中被解析出來了
echo "ℹ️  jobTriggerFunction URL: ${JOB_TRIGGER_FUNCTION_URL}"

# 定義共同的 Cloud Scheduler 參數
# 這樣可以避免在 create 和 update 命令中重複寫多個參數
COMMON_SCHEDULER_ARGS=(
  --schedule="35 6 * * *"
  --time-zone="Asia/Taipei"
  --location="${REGION}"
  --uri="${JOB_TRIGGER_FUNCTION_URL}"
  --http-method="POST"
  --oidc-service-account-email="${COMPUTE_SA_EMAIL}"
  --oidc-token-audience="${JOB_TRIGGER_FUNCTION_URL}"
  --description="自動觸發 telegram-importer-job。"
  --project="${NEW_PROJECT_ID}"
)

# 首先嘗試更新排程作業
# 將 stderr 導向 stdout，然後用 grep 檢查特定的「找不到資源」錯誤
# 如果更新失敗（通常是因為不存在），則執行創建
echo "ℹ️ 嘗試更新 Cloud Scheduler Job 'daily-job-trigger-function'..."
if ! UPDATE_RESULT=$(gcloud scheduler jobs update http daily-job-trigger-function "${COMMON_SCHEDULER_ARGS[@]}" 2>&1); then
  # 檢查錯誤訊息中是否包含 "Resource not found"
  if echo "${UPDATE_RESULT}" | grep -q "NOT_FOUND"; then
    echo "ℹ️ Cloud Scheduler Job 'daily-job-trigger-function' 不存在，正在創建..."
    gcloud scheduler jobs create http daily-job-trigger-function "${COMMON_SCHEDULER_ARGS[@]}" \
      || { echo "ERROR: 創建 Cloud Scheduler Job 失敗。詳細：${UPDATE_RESULT}"; exit 1; }
  else
    # 如果不是「找不到資源」的錯誤，那就是其他更新失敗的原因
    echo "ERROR: 更新 Cloud Scheduler Job 失敗。詳細：${UPDATE_RESULT}"; exit 1;
  fi
else
  echo "✅ Cloud Scheduler Job 'daily-job-trigger-function' 已更新。"
fi
echo "✅ Cloud Scheduler 已設定。"

echo ""
echo "--- 部署完成！請手動驗證 ---"
echo "PWA 網址: ${PWA_BASE_URL}"
echo "Cloud Run Job 控制台: https://console.cloud.google.com/run/jobs?project=${NEW_PROJECT_ID}®ion=${REGION}"
echo "Cloud Functions 控制台: https://console.cloud.google.com/functions/list?project=${NEW_PROJECT_ID}®ion=${REGION}"
echo "Cloud Scheduler 控制台: https://console.cloud.google.com/cloudscheduler?project=${NEW_PROJECT_ID}®ion=${REGION}"
echo ""
echo "重要：請檢查上述控制台連結，確認所有服務都已成功部署並運行！"

echo ""
echo "--- 成本管理與資源清理建議 ---"
echo "您頻繁執行此部署腳本可能會導致以下資源累積並產生額外費用："
echo "1. Artifact Registry (或 Container Registry) 中的 Docker 容器映像檔：每次部署 Functions 和 Cloud Run Job 都會創建新的映像檔版本。"
echo "2. Firebase Hosting 的網站版本：每次部署前端都會創建新的網站版本。"
echo ""
echo "強烈建議您設定這些服務的「生命週期政策」來自動清理舊版本，以控制成本並保持整潔。"
echo ""
echo "【如何設定 Artifact Registry (或 Container Registry) 的生命週期政策】"
echo "   這是最重要的成本控制點，請務必設定！"
echo "   1. 前往 Google Cloud Console -> Artifact Registry (或 Container Registry)。"
echo "      網址：https://console.cloud.google.com/artifacts?project=${NEW_PROJECT_ID}"
echo "   2. 找到您的映像檔倉庫 (例如：us.gcr.io/${NEW_PROJECT_ID} 或 gcr.io/${NEW_PROJECT_ID}/telegram-importer)。"
echo "   3. 點擊進入每個倉庫，然後點擊上方菜單的「設定」或「生命週期政策」選項。"
echo "   4. 設定規則，例如：「保留最新 5 個版本」或「刪除超過 30 天的映像檔版本」。"
echo "      推薦策略：設定一個基於「版本數」的規則（例如保留每個 tag 下最新的 5 個映像檔）。"
echo ""
echo "【如何手動清理 Firebase Hosting 舊版本】"
echo "   1. 前往 Firebase Console -> Hosting。"
echo "      網址：https://console.firebase.google.com/project/${NEW_PROJECT_ID}/hosting/main"
echo "   2. 在「版本歷史」部分，您可以查看所有部署版本，並選擇「復原」或「刪除」不需要的舊版本。"
echo ""
echo "設定這些自動化清理規則後，即使您頻繁部署，也能有效管理累積的資源和潛在費用。"
echo "如有任何疑問，請參考 Google Cloud 和 Firebase 的官方文件。"