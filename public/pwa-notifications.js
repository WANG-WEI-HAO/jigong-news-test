// public/pwa-notifications.js

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/**
 * 初始化所有 PWA 相關的功能，包含 Service Worker 註冊、推播通知、
 * 主題切換、以及自定義的安裝提示。
 * 此函數設計為在 DOM 完全載入後調用，並傳入所有必要的 DOM 元素。
 *
 * @param {object} domElements - 一個包含所有必要 DOM 元素引用的物件。
 * @param {HTMLElement} domElements.settingsBtn - 設定按鈕。
 * @param {HTMLElement} domElements.settingsPanel - 設定面板。
 * @param {HTMLElement} domElements.closeSettingsBtn - 關閉設定面板的按鈕。
 * @param {HTMLInputElement} domElements.notificationToggleSwitch - 推播通知的切換開關。
 * @param {HTMLElement} domElements.notificationLabel - 推播開關旁的文字標籤。
 * @param {HTMLInputElement} domElements.themeToggleSwitch - 主題切換的開關。
 * @param {HTMLElement} domElements.clearCacheBtn - 清除快取按鈕。
 * @param {HTMLElement} domElements.overlay - 灰色背景遮罩。
 * @param {HTMLElement} domElements.customInstallPromptOverlay - PWA 安裝提示的遮罩層。
 * @param {HTMLElement} domElements.notificationConfirmationModalOverlay - 通知確認模態框的遮罩層。
 * @param {HTMLElement} domElements.notificationConfirmationModal - 通知確認模態框。
 * @param {HTMLElement} domElements.permissionDeniedModalOverlay - 權限被拒絕提示的遮罩層。
 * @param {HTMLElement} domElements.permissionDeniedModal - 權限被拒絕提示框。
 * @param {HTMLElement} domElements.customConfirmModalOverlay - 通用確認模態框的遮罩層。
 * @param {HTMLElement} domElements.customConfirmModal - 通用確認模態框的內容元素。
 * @param {HTMLElement} domElements.customAlertModalOverlay - 通用提示模態框的遮罩層。
 * @param {HTMLElement} domElements.customAlertModal - 通用提示模態框的內容元素。
 * @param {string} domElements.PWA_SUB_PATH - PWA 的子路徑 (例如 '/', '/myapp/').
 */
function initializePwaLogic(domElements) {

    // --- PWA 設定常數 ---
    const BACKEND_BASE_URL = isLocalhost
        ? 'http://localhost:5001/jigong-news-test/us-central1/api' // Firebase Functions 模擬器 URL
        : 'https://us-central1-jigong-news-test.cloudfunctions.net/api';
    const OFFICIAL_PWA_ORIGIN = isLocalhost
        ? 'http://localhost:5501/' // Firebase Hosting 模擬器 URL
        : 'https://jigong-news-test.web.app/';
    const PWA_SUB_PATH = domElements.PWA_SUB_PATH || '';

    // --- 狀態變數 ---
    let swRegistration = null; // 用於保存 Service Worker 註冊的實例
    let deferredPrompt; // 用於保存 PWA 安裝提示事件
    const LOCAL_STORAGE_SUBSCRIPTION_KEY = 'userSubscribedToNotifications'; // 確認名稱
    let initialClickCount = 0; // 初始化點擊計數器
    const REQUIRED_CLICKS_FOR_PROMPT = 2; // 設定需要 2 次點擊就觸發提示
    let isInteractionPaused = false; // 控制點擊偵測的旗標

    // --- DOM 元素解構 ---
    const {
        settingsBtn,
        settingsPanel,
        closeSettingsBtn,
        notificationToggleSwitch,
        notificationLabel,
        themeToggleSwitch,
        clearCacheBtn,
        overlay,
        customInstallPromptOverlay,
        notificationConfirmationModalOverlay,
        notificationConfirmationModal,
        permissionDeniedModalOverlay,
        permissionDeniedModal,
        customConfirmModalOverlay,
        customConfirmModal,
        customAlertModalOverlay,
        customAlertModal,
    } = domElements;

    // 驗證關鍵 DOM 元素
    if (!settingsBtn || !settingsPanel || !closeSettingsBtn || !notificationToggleSwitch ||
        !notificationLabel || !themeToggleSwitch || !clearCacheBtn || !overlay ||
        !customInstallPromptOverlay || !notificationConfirmationModalOverlay ||
        !notificationConfirmationModal || !permissionDeniedModalOverlay ||
        !permissionDeniedModal || !customConfirmModalOverlay || !customConfirmModal ||
        !customAlertModalOverlay || !customAlertModal) {
        console.error("關鍵的 PWA 邏輯 DOM 元素缺失，PWA 功能可能無法正常運作。");
        if (notificationToggleSwitch) notificationToggleSwitch.disabled = true;
        return;
    }

    // --- 輔助函數定義 (按照依賴關係排序) ---

    // 1. 最基礎的 PWA 環境檢查函數
    function isPWAInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    }

    function isInIframe() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    function isSandboxed() {
        return isInIframe();
    }

    function isAppleMobileDevice() {
        const userAgent = navigator.userAgent;
        const isIOS = /iPhone|iPad|iPod/.test(userAgent);
        const isAppleDevice = /(Macintosh|MacIntel)/.test(userAgent) && navigator.maxTouchPoints > 1;
        return (isIOS || isAppleDevice) && !window.MSStream;
    }

    function isMacSafari() {
        return navigator.userAgent.includes('Macintosh') && navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome');
    }

    function isOfficialOrigin() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return true;
        }
        return window.location.href.startsWith(OFFICIAL_PWA_ORIGIN);
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // 2. UI 更新函數 (依賴 DOM 元素，不依賴複雜邏輯)
    function updateThemeToggleSwitchUI() {
        if (!themeToggleSwitch) return;
        const isDark = document.body.classList.contains("dark-mode");
        themeToggleSwitch.checked = isDark;
    }

    function updateNotificationToggleSwitchUI(isSubscribed, permissionState) {
        console.log(`[UI 更新] 更新開關狀態。 isSubscribed: ${isSubscribed}, permission: ${permissionState}`);
        const innerTextElement = notificationLabel.querySelector('.toggle-switch-inner');
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !isOfficialOrigin() || isSandboxed()) {
            notificationToggleSwitch.disabled = true;
            notificationToggleSwitch.checked = false;
            if (innerTextElement) {
                innerTextElement.setAttribute('data-on', '不可用');
                innerTextElement.setAttribute('data-off', '不可用');
            }
            console.warn('[UI 更新] 通知功能不支持或非官方來源，開關已禁用。');
            return;
        }
        if (permissionState === 'denied') {
            notificationToggleSwitch.disabled = true;
            notificationToggleSwitch.checked = false;
            if (innerTextElement) {
                innerTextElement.setAttribute('data-on', '已拒絕');
                innerTextElement.setAttribute('data-off', '已拒絕');
            }
        } else {
            notificationToggleSwitch.disabled = false;
            notificationToggleSwitch.checked = isSubscribed;
            if (innerTextElement) {
                innerTextElement.setAttribute('data-on', '已開啟');
                innerTextElement.setAttribute('data-off', '已關閉');
            }
        }
    }

    // 3. 通用模態框隱藏處理 (依賴 handleInitialScreenClick，但這裡只是設置監聽器，所以可以提前定義)
    // handleInitialScreenClick 會在後面定義，但這裡只設定監聽器，不會立即呼叫
    function hideModalAndResetClick(overlayElement, message) {
        if (!overlayElement) return;
        overlayElement.classList.remove('visible');
        overlayElement.addEventListener('transitionend', function handler() {
            this.style.display = 'none';
            this.removeEventListener('transitionend', handler);

            initialClickCount = 0; // 重置點擊次數
            isInteractionPaused = false;
            // 重新添加事件監聽器，確保它們在每次模態框關閉後都能再次工作
            document.body.addEventListener('click', handleInitialScreenClick);
            document.body.addEventListener('touchstart', handleInitialScreenClick);
            console.log(`[模態框] ${message}已隱藏，點擊偵測已重置並恢復。`);
        }, { once: true });
    }

    // 4. 通用提示/確認模態框函數 (依賴 hideModalAndResetClick，需要它們被 window 屬性訪問)
    function showCustomConfirm(message) {
        return new Promise((resolve) => {
            isInteractionPaused = true;
            document.body.removeEventListener('click', handleInitialScreenClick);
            document.body.removeEventListener('touchstart', handleInitialScreenClick);

            const okButton = customConfirmModal.querySelector('#customConfirmOkButton');
            const cancelButton = customConfirmModal.querySelector('#customConfirmCancelButton');
            const messageEl = customConfirmModal.querySelector('#customConfirmMessage');
            messageEl.textContent = message;

            okButton.removeEventListener('click', okButton._handler);
            cancelButton.removeEventListener('click', cancelButton._handler);

            const handleOk = () => { hideModalAndResetClick(customConfirmModalOverlay, '通用確認'); resolve(true); };
            const handleCancel = () => { hideModalAndResetClick(customConfirmModalOverlay, '通用確認'); resolve(false); };
            
            okButton.addEventListener('click', handleOk, { once: true });
            cancelButton.addEventListener('click', handleCancel, { once: true });
            
            okButton._handler = handleOk;
            cancelButton._handler = handleCancel;

            customConfirmModalOverlay.style.display = 'flex';
            requestAnimationFrame(() => customConfirmModalOverlay.classList.add('visible'));
        });
    }
    window.showCustomConfirm = showCustomConfirm;

    function showCustomAlert(message) {
        return new Promise((resolve) => {
            isInteractionPaused = true;
            document.body.removeEventListener('click', handleInitialScreenClick);
            document.body.removeEventListener('touchstart', handleInitialScreenClick);

            const okButton = customAlertModal.querySelector('#customAlertOkButton');
            const messageEl = customAlertModal.querySelector('#customAlertMessage');
            messageEl.textContent = message;

            okButton.removeEventListener('click', okButton._handler);

            const handleOk = () => { hideModalAndResetClick(customAlertModalOverlay, '通用提示'); resolve(); };
            okButton.addEventListener('click', handleOk, { once: true });
            okButton._handler = handleOk;

            customAlertModalOverlay.style.display = 'flex';
            requestAnimationFrame(() => customAlertModalOverlay.classList.add('visible'));
        });
    }
    window.showCustomAlert = showCustomAlert;

    // 5. 特定模態框顯示函數 (依賴基礎檢查、UI 更新、通用模態框操作)
    function showCustomInstallPrompt(type = 'default') {
        console.log(`[PWA 提示] 顯示自定義安裝提示，類型: ${type}`);
        if (!isOfficialOrigin() || isSandboxed()) {
            console.warn('[PWA 提示] 非官方網域或沙箱環境，不顯示安裝提示。');
            return;
        }

        isInteractionPaused = true;
        document.body.removeEventListener('click', handleInitialScreenClick);
        document.body.removeEventListener('touchstart', handleInitialScreenClick);

        customInstallPromptOverlay.style.display = 'flex';
        let promptDiv = customInstallPromptOverlay.querySelector('#customInstallPrompt');
        if (!promptDiv) {
            promptDiv = document.createElement('div');
            promptDiv.id = 'customInstallPrompt';
            promptDiv.classList.add('custom-prompt');
            customInstallPromptOverlay.appendChild(promptDiv);
        }
        let contentHTML = '';
        let buttonsHTML = '';
        if (type === 'ios') {
            const PWA_BASE_URL_FOR_ICONS = window.location.origin + PWA_SUB_PATH;
            const SHARE_ICON_PATH = `${PWA_BASE_URL_FOR_ICONS}/icons/ios分享icon.jpg`;
            const ADD_TO_HOMESCREEN_ICON_PATH = `${PWA_BASE_URL_FOR_ICONS}/icons/ios加到主畫面icon.jpg`;
            contentHTML = `
                <p style="margin: 0; font-weight: bold;">安裝濟公報應用程式</p>
                <p style="margin: 0; font-size: 0.95em; opacity: 0.9; white-space: pre-line;">
                1.請點擊瀏覽器的<strong style="font-size:1.1em;">「分享按鈕」</strong><img src="${SHARE_ICON_PATH}" alt="分享圖示">
                2.選擇<strong style="font-size:1.1em;">「加入主畫面」</strong><img src="${ADD_TO_HOMESCREEN_ICON_PATH}" alt="加到主畫面圖示">即可安裝應用程式。
                </p>`;
            buttonsHTML = `<div style="display: flex; justify-content: center; gap: 15px; margin-top: 10px;"><button id="iosDismissButton">了解</button></div>`;
        } else {
            contentHTML = `<p style="margin: 0;">將「濟公報」安裝到主畫面？</p><p style="margin: 0; font-size: 0.9em; opacity: 0.8;">獲取最佳體驗和訂閱推播通知！</p>`;
            buttonsHTML = `<div style="display: flex; justify-content: center; gap: 15px; margin-top: 10px;"><button id="customInstallAppButton">立即安裝</button></div>`;
        }
        promptDiv.innerHTML = `${contentHTML}${buttonsHTML}<button id="customCancelInstallButton" class="close-button">×</button>`;
        const installBtn = promptDiv.querySelector('#customInstallAppButton');
        const cancelBtn = promptDiv.querySelector('#customCancelInstallButton');
        const iosDismissBtn = promptDiv.querySelector('#iosDismissButton');

        const hideAndReset = () => hideModalAndResetClick(customInstallPromptOverlay, 'PWA安裝提示');

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                hideAndReset();
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    await deferredPrompt.userChoice;
                    deferredPrompt = null;
                }
            }, { once: true });
        }
        if (iosDismissBtn) {
            iosDismissBtn.addEventListener('click', () => {
                localStorage.setItem('hasSeenAppleInstallPrompt', 'dismissed');
                hideAndReset();
            }, { once: true });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideAndReset, { once: true });
        }
        requestAnimationFrame(() => customInstallPromptOverlay.classList.add('visible'));
    }

    function showNotificationConfirmationModal() {
        console.log('[通知模態框] 顯示確認模態框。');
        
        isInteractionPaused = true;
        document.body.removeEventListener('click', handleInitialScreenClick);
        document.body.removeEventListener('touchstart', handleInitialScreenClick);

        notificationConfirmationModalOverlay.style.display = 'flex';
        requestAnimationFrame(() => notificationConfirmationModalOverlay.classList.add('visible'));
        const confirmBtn = notificationConfirmationModal.querySelector('#confirmEnableNotificationsButton');
        const cancelBtn = notificationConfirmationModal.querySelector('#cancelEnableNotificationsButton');
        const closeXBtn = notificationConfirmationModal.querySelector('#notificationConfirmationCloseXButton');

        confirmBtn.removeEventListener('click', confirmBtn._handler);
        cancelBtn.removeEventListener('click', cancelBtn._handler);
        closeXBtn.removeEventListener('click', closeXBtn._handler);

        const handleConfirm = () => {
            hideModalAndResetClick(notificationConfirmationModalOverlay, '通知確認');
            requestPermissionAndPerformSubscription(); // 這裡呼叫 requestPermissionAndPerformSubscription
        };
        const handleCancel = () => {
            hideModalAndResetClick(notificationConfirmationModalOverlay, '通知確認');
            if (notificationToggleSwitch) {
                notificationToggleSwitch.checked = false;
                updateNotificationToggleSwitchUI(false, Notification.permission);
            }
        };
        if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm, { once: true });
        if (cancelBtn) cancelBtn.addEventListener('click', handleCancel, { once: true });
        if (closeXBtn) closeXBtn.addEventListener('click', handleCancel, { once: true });

        confirmBtn._handler = handleConfirm;
        cancelBtn._handler = handleCancel;
        closeXBtn._handler = handleCancel;
    }

    function showPermissionDeniedGuidanceModal() {
        console.log('[權限被拒模態框] 顯示指導模態框。');

        isInteractionPaused = true;
        document.body.removeEventListener('click', handleInitialScreenClick);
        document.body.removeEventListener('touchstart', handleInitialScreenClick);

        permissionDeniedModalOverlay.style.display = 'flex';
        requestAnimationFrame(() => permissionDeniedModalOverlay.classList.add('visible'));
        const closeBtn = permissionDeniedModal.querySelector('#permissionDeniedCloseButton');
        const closeXBtn = permissionDeniedModal.querySelector('#permissionDeniedCloseXButton');
        
        closeBtn.removeEventListener('click', closeBtn._handler);
        closeXBtn.removeEventListener('click', closeXBtn._handler);

        const closeHandler = () => hideModalAndResetClick(permissionDeniedModalOverlay, '權限被拒絕指導');
        if (closeBtn) closeBtn.addEventListener('click', closeHandler, { once: true });
        if (closeXBtn) closeXBtn.addEventListener('click', closeHandler, { once: true });

        closeBtn._handler = closeHandler;
        closeXBtn._handler = closeHandler;
    }


    // 6. 核心 Service Worker / 推播訂閱邏輯函數 (依賴基礎工具、UI 更新、模態框函數)
    async function sendHeartbeat() {
        if (!swRegistration) {
            console.warn('[心跳] Service Worker 尚未就緒，無法發送心跳。');
            return;
        }
        try {
            const subscription = await swRegistration.pushManager.getSubscription();
            if (subscription && subscription.endpoint) {
                fetch(`${BACKEND_BASE_URL}/heartbeat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: subscription.endpoint }),
                });
                console.log('[心跳] 已向後端發送裝置活躍信號。');
            }
        } catch (error) {
            console.error('[心跳] 發送心跳時發生錯誤:', error);
        }
    }

    async function checkSubscriptionAndUI() {
        console.log('[訂閱檢查] 開始檢查並校準訂閱狀態...');
        try {
            if (!swRegistration) {
                swRegistration = await navigator.serviceWorker.ready;
            }
            const subscription = await swRegistration.pushManager.getSubscription();
            const permissionState = Notification.permission;

            const isSubscribed = !!subscription;

            if (isSubscribed && permissionState === 'granted') {
                localStorage.setItem(LOCAL_STORAGE_SUBSCRIPTION_KEY, 'true');
                console.log('[訂閱檢查] 狀態校準：已訂閱，localStorage 標記已設定。');
            } else {
                localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
                console.log('[訂閱檢查] 狀態校準：未訂閱或權限不足，localStorage 標記已移除。');
            }

            updateNotificationToggleSwitchUI(isSubscribed, permissionState);

        } catch (error) {
            console.error('[訂閱檢查] 檢查出錯:', error);
            localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
            updateNotificationToggleSwitchUI(false, 'error');
        }
    }

    async function requestPermissionAndPerformSubscription() {
        console.log('[訂閱流程] 開始...');
        try {
            swRegistration = await navigator.serviceWorker.ready;
            console.log('[訂閱流程] Service Worker 已準備好進行訂閱。');
        } catch (error) {
            console.error('[訂閱流程] Service Worker 未能準備就緒:', error);
            await showCustomAlert('Service Worker 尚未準備好，無法訂閱。請稍後再試。');
            checkSubscriptionAndUI();
            return;
        }
        notificationToggleSwitch.disabled = true;
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('[訂閱流程] 用戶拒絕了通知權限。');
                showPermissionDeniedGuidanceModal();
                localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
                return;
            }
            const vapidPublicKeyResponse = await fetch(`${BACKEND_BASE_URL}/vapid-public-key`);
            if (!vapidPublicKeyResponse.ok) throw new Error(`無法獲取 VAPID 公鑰: ${vapidPublicKeyResponse.statusText}`);
            const VAPID_PUBLIC_KEY = await vapidPublicKeyResponse.text();
            const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            const subscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            const response = await fetch(`${BACKEND_BASE_URL}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
            if (response.ok) {
                localStorage.setItem(LOCAL_STORAGE_SUBSCRIPTION_KEY, 'true');
                console.log('[訂閱流程] 本機訂閱狀態已標記為 true。');
                await showCustomAlert('您已成功訂閱每日濟公報推播通知！');
                if (swRegistration.active) {
                    swRegistration.active.postMessage({
                        type: 'SEND_WELCOME_NOTIFICATION',
                        title: '感謝訂閱濟公報推播通知',
                        body: '明天早上將為您發出新的一則濟公報',
                    });
                }
            } else {
                localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
                throw new Error(`訂閱失敗: ${await response.text()}`);
            }
        } catch (error) {
            localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
            console.error('[訂閱流程] 訂閱失敗:', error);
            await showCustomAlert(`訂閱失敗: ${error.message}`);
            const sub = await (swRegistration ? swRegistration.pushManager.getSubscription() : null);
            if (sub) await sub.unsubscribe();
        } finally {
            checkSubscriptionAndUI();
        }
    }

    async function subscribeUser() {
        console.log('[用戶訂閱] 嘗試訂閱...');
        if (!isOfficialOrigin() || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            await showCustomAlert('此環境不支持推播通知。');
            checkSubscriptionAndUI();
            return;
        }

        const currentPermission = Notification.permission;
        console.log(`[用戶訂閱] 目前權限: ${currentPermission}`);

        if (currentPermission === 'granted') {
            const subscription = await (swRegistration ? swRegistration.pushManager.getSubscription() : null);
            if (!subscription) {
                console.log('[用戶訂閱] 權限已授予但無本地訂閱，開始訂閱...');
                await requestPermissionAndPerformSubscription();
            } else {
                console.log('[用戶訂閱] 權限已授予且已存在本地訂閱，無需操作。');
                updateNotificationToggleSwitchUI(true, 'granted');
                localStorage.setItem(LOCAL_STORAGE_SUBSCRIPTION_KEY, 'true');
            }
        } else if (currentPermission === 'denied') {
            showPermissionDeniedGuidanceModal();
        } else { // 'default'
            showNotificationConfirmationModal();
        }
    }

    async function unsubscribeUser() {
        console.log('[用戶取消訂閱] 嘗試取消訂閱...');
        try {
            swRegistration = await navigator.serviceWorker.ready;
        } catch (error) {
            await showCustomAlert('Service Worker 尚未準備好，無法取消訂閱。');
            checkSubscriptionAndUI();
            return;
        }
        notificationToggleSwitch.disabled = true;
        const confirmed = await showCustomConfirm('您確定要取消訂閱濟公報推播通知嗎？');
        if (!confirmed) {
            checkSubscriptionAndUI();
            return;
        }
        try {
            const subscription = await swRegistration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
                console.log('[用戶取消訂閱] 本機訂閱狀態標記已移除。');
                fetch(`${BACKEND_BASE_URL}/unsubscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: subscription.endpoint }),
                });
                await showCustomAlert('您已成功取消訂閱每日濟公報推播通知！');
            }
        } catch (error) {
            console.error('[用戶取消訂閱] 取消訂閱失敗:', error);
            await showCustomAlert(`取消訂閱失敗: ${error.message}`);
            const sub = await (swRegistration ? swRegistration.pushManager.getSubscription() : null);
            if (sub) await sub.unsubscribe();
        } finally {
            checkSubscriptionAndUI();
        }
    }
    
    // 7. 事件處理器 (這些函數最終會被綁定到 DOM 事件上，並呼叫前面定義的邏輯)
    function handleNotificationToggleChange(event) {
        if (event.target.checked) {
            subscribeUser();
        } else {
            unsubscribeUser();
        }
    }

    function toggleTheme() {
        document.body.classList.toggle("dark-mode");
        localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
        updateThemeToggleSwitchUI(); // 這裡呼叫 updateThemeToggleSwitchUI，它必須在此之前定義
    }

    async function handleInitialScreenClick() {
        // 如果互動已暫停（即有彈窗開啟），則不執行點擊偵測邏輯
        if (isInteractionPaused) {
            console.log('[首次點擊] 互動已暫停，跳過點擊偵測。');
            return;
        }

        // 如果在沙箱或非官方來源，則直接返回，不顯示任何通知提示
        if (isSandboxed() || !isOfficialOrigin()) {
            console.log('[首次點擊] 在沙箱或非官方網域，跳過通知提示。');
            document.body.removeEventListener('click', handleInitialScreenClick);
            document.body.removeEventListener('touchstart', handleInitialScreenClick);
            return;
        }

        initialClickCount++;
        console.log(`[首次點擊] 偵測到螢幕互動。目前點擊次數: ${initialClickCount}`);

        const isLocallySubscribed = localStorage.getItem(LOCAL_STORAGE_SUBSCRIPTION_KEY) === 'true';
        const permissionState = Notification.permission;

        if (isLocallySubscribed) {
            console.log('[首次點擊] 用戶已訂閱通知，無需彈跳提示。');
            if (permissionState === 'denied') {
                 console.warn('[首次點擊] 偵測到本地訂閱狀態與瀏覽器權限不符 (本地已訂閱但瀏覽器拒絕)，將清理本地狀態。');
                 localStorage.removeItem(LOCAL_STORAGE_SUBSCRIPTION_KEY);
            }
            return;
        }

        if (initialClickCount < REQUIRED_CLICKS_FOR_PROMPT) {
            console.log(`[首次點擊] 未達觸發次數。目前點擊次數: ${initialClickCount}/${REQUIRED_CLICKS_FOR_PROMPT}。`);
            return;
        }

        console.log(`[首次點擊] 達到觸發次數 (${initialClickCount}/${REQUIRED_CLICKS_FOR_PROMPT})。`);

        if (permissionState === 'default') {
            console.log('[首次點擊] 權限為 \'default\'，彈跳通知確認視窗。');
            try {
                await navigator.serviceWorker.ready;
                showNotificationConfirmationModal();
            } catch (e) {
                console.warn('[首次點擊] Service Worker 尚未就緒，無法自動提示:', e);
            }
        } else if (permissionState === 'denied') {
            console.log('[首次點擊] 通知權限已被用戶拒絕。彈跳引導視窗。');
            try {
                await navigator.serviceWorker.ready;
                showPermissionDeniedGuidanceModal();
            } catch (e) {
                console.warn('[首次點擊] Service Worker 尚未就緒，無法顯示拒絕提示:', e);
            }
        } else if (permissionState === 'granted') {
            console.log('[首次點擊] 瀏覽器權限已授予，但本地未標記為訂閱。正在同步本地狀態。');
            localStorage.setItem(LOCAL_STORAGE_SUBSCRIPTION_KEY, 'true');
            initialClickCount = 0;
        }
    }


    // --- 主要 PWA 初始化邏輯執行點 ---
    // 這些是 initializePwaLogic 函式開始執行時的步驟。
    // 在這裡，所有上面定義的輔助函數都應該是可用的。
    console.log('[PWA 初始化] 正在初始化 PWA 功能...');

    const isLocallySubscribed = localStorage.getItem(LOCAL_STORAGE_SUBSCRIPTION_KEY) === 'true';

    // UI 初始化 (通知開關)
    if (notificationToggleSwitch) {
        notificationToggleSwitch.checked = isLocallySubscribed;
        console.log(`[PWA 初始化] 根據 localStorage，開關初始狀態設定為: ${isLocallySubscribed}`);
        const innerTextElement = notificationLabel.querySelector('.toggle-switch-inner');
        if (innerTextElement) {
            innerTextElement.setAttribute('data-on', '已開啟');
            innerTextElement.setAttribute('data-off', '已關閉');
        }
        notificationToggleSwitch.addEventListener('change', handleNotificationToggleChange);
    } else {
        console.warn('[PWA 初始化] 未找到通知開關元素 (notificationToggleSwitch)。');
    }

    // Service Worker 註冊
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('[PWA 初始化] Service Worker 註冊成功，作用域:', registration.scope);
                swRegistration = registration;
                checkSubscriptionAndUI();
                sendHeartbeat();
            })
            .catch(error => {
                console.error('Service Worker 註冊失敗:', error);
                updateNotificationToggleSwitchUI(false, 'error');
            });
    } else {
        console.warn('[PWA 初始化] 瀏覽器不支持 Service Worker。');
        updateNotificationToggleSwitchUI(false, 'unsupported');
    }

    // 通知權限狀態變化監聽
    if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'notifications' }).then(perm => {
            perm.onchange = () => {
                console.log('[PWA 初始化] 通知權限狀態已改變。');
                checkSubscriptionAndUI();
            };
        });
    }

    // 綁定 initial screen click 事件
    document.body.addEventListener('click', handleInitialScreenClick);
    document.body.addEventListener('touchstart', handleInitialScreenClick);

    // PWA 安裝提示邏輯
    if (!isPWAInstalled() && isOfficialOrigin() && !isSandboxed()) {
        if (isAppleMobileDevice() || isMacSafari()) {
            const hasSeenPrompt = localStorage.getItem('hasSeenAppleInstallPrompt');
            if (hasSeenPrompt !== 'dismissed') {
                setTimeout(() => showCustomInstallPrompt('ios'), 3000);
            }
        } else {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredPrompt = e;
                console.log('[PWA 初始化] beforeinstallprompt 事件已捕獲。');
                showCustomInstallPrompt('default');
            });
            window.addEventListener('appinstalled', () => {
                deferredPrompt = null;
            });
        }
    }

    // 設定面板和主題切換的事件綁定
    console.log('[PWA 初始化] 正在綁定設定面板和主題切換事件...');

    // 初始化主題
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "dark") document.body.classList.add("dark-mode");
    updateThemeToggleSwitchUI(); // 確保在這裡呼叫時 updateThemeToggleSwitchUI 已經定義

    function openSettingsPanel() {
        settingsPanel.classList.add('is-open');
        overlay.classList.add('is-visible');
        checkSubscriptionAndUI();
    }
    function closeSettingsPanel() {
        settingsPanel.classList.remove('is-open');
        overlay.classList.remove('is-visible');
    }
    settingsBtn.addEventListener('click', openSettingsPanel);
    settingsBtn.addEventListener('click', openSettingsPanel); // 錯誤：這裡重複綁定了 openSettingsPanel
    closeSettingsBtn.addEventListener('click', closeSettingsPanel); // 確保這裡呼叫的是 closeSettingsPanel
    overlay.addEventListener('click', closeSettingsPanel);

    // 清除快取按鈕
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            const confirmed = await showCustomConfirm(
                '確定要重設此裝置上的應用程式嗎？這將清除快取和設定，並取消推播通知。'
            );
            if (!confirmed) return;

            clearCacheBtn.textContent = '清除中...';
            clearCacheBtn.disabled = true;

            try {
                if ('serviceWorker' in navigator) {
                    console.log('[清除快取] 正在取消註冊 Service Worker...');
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                        await registration.unregister();
                    }
                    console.log('[清除快取] 所有 Service Worker 已成功在本機取消註冊。');
                }
                if ('caches' in window) {
                    console.log('[清除快取] 正在刪除所有 Cache Storage...');
                    const keys = await caches.keys();
                    await Promise.all(keys.map(key => caches.delete(key)));
                    console.log('[清除快取] Cache Storage 已清除。');
                }
                console.log('[清除快取] 正在清除 Local/Session Storage...');
                localStorage.clear();
                sessionStorage.clear();
                console.log('[清除快取] Local/Session Storage 已清除。');

                await showCustomAlert('此裝置的快取、設定與推播訂閱皆已清除！頁面將重新載入。');
                window.location.reload(true);

            } catch (error) {
                console.error('[清除快取] 本地清除過程中發生錯誤:', error);
                await showCustomAlert(`清除失敗: ${error.message}`);
                clearCacheBtn.textContent = '立即清除';
                clearCacheBtn.disabled = false;
            }
        });
    }

    // 主題切換按鈕
    themeToggleSwitch.addEventListener('change', toggleTheme); // 這裡呼叫 toggleTheme，它必須在此之前定義
}

// 將 initializePwaLogic 暴露給全域
window.initializePwaLogic = initializePwaLogic;