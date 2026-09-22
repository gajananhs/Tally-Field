// ============================================================
// TallyField — service worker
// Caches the app shell for offline load. API calls are handled by the
// app's own IndexedDB queue (see queue.js), not by the service worker —
// POSTs need idempotency keys and business-logic retry, which belongs
// in application code, not a generic fetch-intercept.
// ============================================================

const CACHE_NAME = 'tallyfield-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — they carry auth tokens and must always hit
  // the network (or fail explicitly so the app's own queue can handle it).
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: cache-first, so the app still opens with no signal.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
