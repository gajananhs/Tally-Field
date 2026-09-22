// ============================================================
// TallyField — service worker (Workbox, backend-connected build)
// Registered as ./service-worker.js (relative) so it works whether this
// is deployed at a domain root or a subpath. API calls under /api/ are
// explicitly excluded from every cache — they carry session tokens and
// must always reach the real PHP backend, or fail so the app's own
// IndexedDB queue (queue.js) can take over. Nothing about the database
// or server-side behavior changes here; this file only affects what the
// browser caches.
// ============================================================

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js');

const VERSION = 'v2';

if (workbox) {
  workbox.setConfig({ debug: false });
  workbox.core.skipWaiting();
  workbox.core.clientsClaim();

  workbox.precaching.precacheAndRoute([
    { url: './', revision: VERSION },
    { url: './index.html', revision: VERSION },
    { url: './app.js', revision: VERSION },
    { url: './queue.js', revision: VERSION },
    { url: './manifest.json', revision: VERSION },
    { url: './icons/icon-192.png', revision: VERSION },
    { url: './icons/icon-512.png', revision: VERSION },
    { url: './icons/icon-maskable-192.png', revision: VERSION },
    { url: './icons/icon-maskable-512.png', revision: VERSION },
    { url: './icons/icon.svg', revision: VERSION },
    { url: './icons/apple-touch-icon.png', revision: VERSION },
  ]);

  // Never cache the API — always hit the network, and let a failure
  // surface to the app's own queue/error handling instead of serving a
  // stale cached response for a POST that changes data.
  workbox.routing.registerRoute(
    ({ url }) => url.pathname.includes('/api/'),
    new workbox.strategies.NetworkOnly()
  );

  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
      cacheName: 'tallyfield-pages',
      networkTimeoutSeconds: 3,
      plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 10 })],
    })
  );

  workbox.routing.registerRoute(
    ({ url }) => url.origin === 'https://fonts.googleapis.com',
    new workbox.strategies.StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' })
  );
  workbox.routing.registerRoute(
    ({ url }) => url.origin === 'https://fonts.gstatic.com',
    new workbox.strategies.CacheFirst({
      cacheName: 'google-fonts-webfonts',
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
        new workbox.expiration.ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 }),
      ],
    })
  );

  workbox.routing.registerRoute(
    ({ request, url }) => !url.pathname.includes('/api/') && ['image', 'font'].includes(request.destination),
    new workbox.strategies.CacheFirst({
      cacheName: 'tallyfield-assets',
      plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 })],
    })
  );
} else {
  const CACHE_NAME = 'tallyfield-shell-fallback';
  const SHELL = ['./', './index.html', './app.js', './queue.js', './manifest.json'];
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
    self.skipWaiting();
  });
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
    e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request).catch(() => caches.match('./index.html'))));
  });
}
