// public/service-worker.js (最終結合版)

// === PWA 設定常數 (與 pwa-notifications.js 保持一致) ===
// 如果你的 PWA 部署在子路徑下 (例如: https://yourusername.github.io/your-repo-name/)
// 則 PWA_SUB_PATH 應該是 /your-repo-name。如果直接部署在根目錄，則為 '' (空字串)。
// !!! 本地開發時，請將此處設為 '' (空字串) !!!
// !!! 部署到 GitHub Pages 等子路徑時，請設為 '/your-repo-name'，例如 '/jigong-news' !!!
const PWA_SUB_PATH = ""; // 部署到 Firebase Hosting 根目錄，此設定正確

// !!! 新專案 'jigong-news-test' 的後端 URL !!!
const BACKEND_BASE_URL = 'https://us-central1-jigong-news-test.cloudfunctions.net/api';

// 每次更新預緩存資源時，請務必更新版本號以強制 Service Worker 更新
const CACHE_NAME = 'jigong-pwa-cache-v2.0.6'; // <--- 已更新版本號

// 需要預緩存的資源列表 (已修正為相對路徑)
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './posts.json',
  './pwa-notifications.js',
  './service-worker.js',
  './zh-tw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/濟公報logo.png',
  './icons/ios分享icon.jpg',
  './icons/ios加到主畫面icon.jpg',
  './ICON/facebook.png',
  './ICON/line.png',
  './ICON/link.png',
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js',
];


self.addEventListener('install', event => {
  console.log('[Service Worker] Installing Service Worker ...', event);
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log(`[Service Worker] Opened cache: ${CACHE_NAME}. Starting to add URLs.`);
      try {
        await cache.addAll(urlsToCache);
        console.log('[Service Worker] All specified URLs were successfully cached.');
      } catch (error) {
        console.error('[Service Worker] Pre-caching failed:', error);
        // 即使 addAll 失敗，也嘗試逐個緩存，增加成功率
        for (const url of urlsToCache) {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn(`[Service Worker] Failed to cache individual URL: ${url}`, err);
          }
        }
      }
      console.log('[Service Worker] Install complete. Activating immediately...');
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating Service Worker ....', event);
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      console.log('[Service Worker] Found caches:', cacheNames);
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log(`[Service Worker] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Old caches cleaned up. Claiming clients...');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // --- 最終優化：過濾掉所有不應被快取的請求 ---
  if (
    event.request.method !== 'GET' || // 只處理 GET 請求
    !requestUrl.protocol.startsWith('http') || // 只處理 http/https 請求
    event.request.url.startsWith(BACKEND_BASE_URL) || // 忽略後端 API
    requestUrl.hostname.includes('google-analytics.com') || // 忽略 GA
    requestUrl.hostname.includes('googletagmanager.com') // 忽略 GTM
  ) {
    return; // 讓瀏覽器自己處理這些請求
  }

  // 對於 posts.json，採用 Network First (網路優先) 策略
  if (requestUrl.pathname.endsWith('/posts.json')) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          console.warn('[Service Worker] Network for posts.json failed, falling back to cache.');
          return caches.match(event.request);
        })
    );
    return;
  }

  // 對於所有其他資源，採用 Cache First (快取優先) 策略
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(error => {
          console.error(`[Service Worker] Network fetch failed for ${event.request.url}:`, error);
          // 在這裡可以返回一個預先快取的離線頁面
        });
      })
  );
});


// === 推播通知相關事件處理 (保留您原有的詳細邏輯) ===

self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  const data = event.data ? event.data.json() : {};

  console.log('[Service Worker] Push data:', data);

  const title = data.title || '濟公報';
  const body = data.body || '您有新的濟公報更新，請點擊查看！';
  const icon = data.icon || './icons/icon-192.png';
  const badge = data.badge || './icons/濟公報logo.png';
  const url = data.url || './';

  const options = {
    body: body,
    icon: icon,
    badge: badge,
    image: data.image,
    tag: data.tag || 'jigong-news-push',
    renotify: data.renotify || true,
    vibrate: [200, 100, 200],
    data: {
      url: url,
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();

  const urlToOpen = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url, self.location.origin).pathname === new URL(urlToOpen, self.location.origin).pathname && 'focus' in client) {
          console.log(`[Service Worker] Focusing existing window: ${client.url}`);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        console.log(`[Service Worker] Opening new window: ${urlToOpen}`);
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SEND_WELCOME_NOTIFICATION') {
    console.log('[Service Worker] Received SEND_WELCOME_NOTIFICATION message from frontend.');
    const { title, body } = event.data;
    
    const icon = './icons/icon-192.png';
    const badge = './icons/濟公報logo.png';
    const url = './';

    self.registration.showNotification(title, {
      body: body,
      icon: icon,
      badge: badge,
      tag: 'welcome-notification',
      renotify: false,
      data: { url: url }
    });
  }
});


// === 後台定期同步 (保留您原有的詳細邏輯) ===
self.addEventListener('periodicsync', event => {
  if (event.tag === 'content-check') {
    console.log('[Service Worker] 執行背景內容檢查...');
    event.waitUntil(checkForUpdatesAndNotify());
  }
});

async function checkForUpdatesAndNotify() {
  try {
    console.log('[Service Worker] 背景同步：正在檢查 posts.json 更新...');
    const cache = await caches.open(CACHE_NAME);
    const postsJsonFullPath = new URL('./posts.json', self.location.origin).href;

    const networkResponse = await fetch(postsJsonFullPath, { cache: 'no-store' });
    if (!networkResponse.ok) {
      console.error('[Service Worker] 背景同步失敗：無法從網路獲取 posts.json。', networkResponse.statusText);
      return;
    }

    const cachedResponse = await cache.match(postsJsonFullPath);

    if (cachedResponse) {
      const networkText = await networkResponse.clone().text();
      const cachedText = await cachedResponse.text();

      if (networkText !== cachedText) {
        console.log('[Service Worker] 背景檢查發現新內容，發送推通知播。');
        await cache.put(postsJsonFullPath, networkResponse.clone());
        self.registration.showNotification('濟公報有新內容！', {
          body: '點擊查看最新聖賢語錄。',
          icon: './icons/icon-192.png',
          badge: './icons/濟公報logo.png',
          tag: 'jigongbao-content-update',
          data: {
            url: './index.html?source=periodicsync'
          }
        });
      } else {
        console.log('[Service Worker] 背景同步：內容無更新。');
      }
    } else {
      console.log('[Service Worker] 背景同步：無快取版本，正在快取新內容。');
      await cache.put(postsJsonFullPath, networkResponse.clone());
    }
  } catch (error) {
    console.error('[Service Worker] 背景內容檢查出錯：', error);
  }
}