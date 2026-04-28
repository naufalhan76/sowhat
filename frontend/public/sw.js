const CACHE_VERSION = 2;
const STATIC_CACHE = 'sowhat-static-v' + CACHE_VERSION;
const API_CACHE = 'sowhat-api-v' + CACHE_VERSION;
const FONT_CACHE = 'sowhat-fonts-v' + CACHE_VERSION;

const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
];

const MAX_API_CACHE_ITEMS = 50;

// --- Install: pre-cache app shell ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => null)
  );
  self.skipWaiting();
});

// --- Activate: purge old caches ---
self.addEventListener('activate', (event) => {
  const keep = new Set([STATIC_CACHE, API_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// --- Fetch strategies ---
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Navigation: Network-First (offline fallback to cached shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // 2) API routes: Stale-While-Revalidate
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(API_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
                // Trim cache to prevent storage bloat
                trimCache(cache, MAX_API_CACHE_ITEMS);
              }
              return response;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // 3) Google Fonts: Cache-First (long-lived)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // 4) Static assets (same-origin JS/CSS/images): Cache-First
  if (url.origin === self.location.origin) {
    const isHashedAsset = url.pathname.includes('/assets/') && /\.[a-f0-9]{8,}\./i.test(url.pathname);
    const isStaticAsset = /\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|webp|avif|ico)$/i.test(url.pathname);

    if (isHashedAsset || isStaticAsset) {
      event.respondWith(
        caches.open(STATIC_CACHE).then((cache) =>
          cache.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }).catch(() => cached);
          })
        )
      );
      return;
    }
  }

  // 5) Everything else: Network-only (no caching)
});

// --- Utility: trim cache to max entries ---
function trimCache(cache, maxItems) {
  cache.keys().then((keys) => {
    if (keys.length > maxItems) {
      cache.delete(keys[0]).then(() => trimCache(cache, maxItems));
    }
  });
}
