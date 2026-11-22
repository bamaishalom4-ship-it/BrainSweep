/**
 * BrainSweep Service Worker — 100% Offline PWA Cache
 * Includes clean un-redirected response handling for Android WebAPK / Chrome PWA
 */

const CACHE_NAME = 'brainsweep-pwa-v26';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './analytics.js',
  './game.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './fonts/press-start-2p-latin.woff2',
  './fonts/vt323-latin.woff2',
];

function cleanRedirectedResponse(response) {
  if (!response || !response.redirected) {
    return Promise.resolve(response);
  }
  return response.blob().then(
    (bodyBlob) =>
      new Response(bodyBlob, {
        status: response.status || 200,
        statusText: response.statusText || 'OK',
        headers: response.headers,
      })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache live Google Apps Script Leaderboard API requests
  if (request.url && request.url.includes('script.google')) {
    return;
  }

  // For document navigation requests (e.g. Android PWA launch to / or /index.html):
  // Use redirect: 'follow' and strip any redirected flag so Chrome never throws ERR_FAILED
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request.url, { redirect: 'follow' })
        .then((networkResponse) => cleanRedirectedResponse(networkResponse))
        .then((cleanResp) => {
          if (cleanResp && cleanResp.status === 200) {
            const clone = cleanResp.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('./', clone.clone());
              cache.put('./index.html', clone);
            });
          }
          return cleanResp;
        })
        .catch(() =>
          caches
            .match('./')
            .then((r) => r || caches.match('./index.html'))
            .then((r) => cleanRedirectedResponse(r))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => cleanRedirectedResponse(networkResponse))
        .then((cleanResp) => {
          if (
            cleanResp &&
            (cleanResp.status === 200 || cleanResp.type === 'opaque')
          ) {
            const responseClone = cleanResp.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return cleanResp;
        })
        .catch(() => cleanRedirectedResponse(cachedResponse));

      if (cachedResponse) {
        return cleanRedirectedResponse(cachedResponse);
      }
      return fetchPromise;
    })
  );
});
