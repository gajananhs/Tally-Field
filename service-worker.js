// ============================================================
// TallyField — service worker (Workbox, GitHub Pages / static build)
// Registered with a relative path (./service-worker.js) so its scope
// resolves correctly under a project subpath like
// https://<user>.github.io/<repo>/ — an absolute "/service-worker.js"
// registration would scope to the domain root and fail on Pages.
// ============================================================

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js');

const VERSION = 'v2';

if (workbox) {
  workbox.setConfig({ debug: false });

  // Take over immediately on install/activate so updates apply without
  // needing every tab closed — paired with the page-side reload-once
  // listener in app.js for a fully automatic update flow.
  workbox.core.skipWaiting();
  workbox.core.clientsClaim();

  // --- App shell: precached so the whole app opens with zero network ---
  workbox.precaching.precacheAndRoute([
    { url: './', revision: VERSION },
    { url: './index.html', revision: VERSION },
    { url: './app.js', revision: VERSION },
    { url: './queue.js', revision: VERSION },
    { url: './mock.js', revision: VERSION },
    { url: './manifest.json', revision: VERSION },
    { url: './icons/icon-192.png', revision: VERSION },
    { url: './icons/icon-512.png', revision: VERSION },
    { url: './icons/icon-maskable-192.png', revision: VERSION },
    { url: './icons/icon-maskable-512.png', revision: VERSION },
    { url: './icons/icon.svg', revision: VERSION },
    { url: './icons/apple-touch-icon.png', revision: VERSION },
  ]);

  // Any other same-origin navigation falls back to the app shell instead
  // of a network error — this app has no server-side routes to miss.
  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
      cacheName: 'tallyfield-pages',
      networkTimeoutSeconds: 3,
      plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 10 })],
    })
  );

  // Google Fonts: stylesheet revalidates in the background, font files
  // are cached long-term once fetched — standard Workbox recipe.
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

  // Any other static asset under this scope (images, icons added later):
  // cache-first, since this build has no real API calls to worry about
  // excluding (see mock.js — it never touches the network at all).
  workbox.routing.registerRoute(
    ({ request }) => ['image', 'font'].includes(request.destination),
    new workbox.strategies.CacheFirst({
      cacheName: 'tallyfield-assets',
      plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 })],
    })
  );
} else {
  // Workbox failed to load (offline on first install, CDN unreachable):
  // fall back to a minimal hand-rolled cache so the app still installs.
  const CACHE_NAME = 'tallyfield-shell-fallback';
  const SHELL = ['./', './index.html', './app.js', './queue.js', './mock.js', './manifest.json'];
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
    self.skipWaiting();
  });
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request).catch(() => caches.match('./index.html'))));
  });
}
