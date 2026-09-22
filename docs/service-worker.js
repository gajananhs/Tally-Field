// ============================================================
// TallyField — service worker (GitHub Pages / static build)
// Registered with a relative path (./service-worker.js) so its scope
// resolves correctly under a project subpath like
// https://<user>.github.io/<repo>/ — an absolute "/service-worker.js"
// registration would scope to the domain root and fail on Pages.
// All cached URLs below are resolved relative to this file's own
// location for the same reason.
// ============================================================

const CACHE_NAME = 'tallyfield-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './queue.js',
  './mock.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
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
  if (event.request.method !== 'GET') return;

  // Cache-first for the app shell so it still opens with no signal;
  // this demo build has no real API calls to exclude (see mock.js).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
