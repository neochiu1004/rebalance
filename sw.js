// Service Worker：App Shell 快取（同源 GET 才處理，API 請求不快取）
const CACHE_NAME = 'rebalance-shell-v3';
const SHELL_FILES = [
    './',
    './index.html',
    './state.js',
    './core.js',
    './api.js',
    './assets.js',
    './transactions.js',
    './trade.js',
    './waterlevel.js',
    './rebalance.js',
    './watch.js',
    './market.js',
    './reports.js',
    './advanced.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
            .catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    // 網路優先，失敗才用快取：確保平常拿到最新版，離線時仍可開啟
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 只快取成功回應，避免把 404/500 錯誤頁存進 App Shell 快取造成離線時拿到壞頁面
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
