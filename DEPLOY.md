# Deploying TallyField to GitHub Pages

The published app now lives at **the repository root** (`index.html`,
`app.js`, `mock.js`, `manifest.json`, `service-worker.js`, `icons/`,
`splash/`) — this is a complete duplicate of `docs/`, kept in sync so
the app opens correctly whichever GitHub Pages source setting you pick.
If you were still seeing the README instead of the app, it's almost
always because Pages was set to publish from the root but there was no
`index.html` there yet — that's now fixed.

## 1. Push the repo as-is

Root-level app files, `docs/` (identical copy), `api/`, `public/`,
`schema.sql`, `seed.sql`, `README.md`, `DEPLOY.md` — commit all of it
together, nothing needs separating out.

## 2. Turn on Pages

Repo → **Settings → Pages** → **Source: Deploy from a branch**:
- **Simplest:** Branch `main`, folder **`/ (root)`** — works immediately, no extra choice needed, since the app is now the thing sitting at the root.
- **Alternative:** Branch `main`, folder **`/docs`** — identical app, if you'd rather keep the repo root looking like a typical project (README first) in GitHub's own file browser and publish from `/docs` instead.

Either one now opens the actual TallyField login screen at the Pages
URL. Save, wait a minute or two for the first build.

## 3. Why the README won't show up

- `index.html` exists at whichever path you publish from, and GitHub
  Pages always serves `index.html` over a README when both are present.
- `.nojekyll` (at the root and in `docs/`) disables Jekyll entirely, so
  GitHub never tries to render the README into a themed homepage.

`README.md` and `DEPLOY.md` stay at the repo root as documentation —
they're just never what Pages resolves `/` to, because `index.html`
takes priority.

## 4. Why this works under a repo subpath

A project page publishes at `https://<user>.github.io/<repo>/`, not the
domain root — every asset reference in `docs/` is written to survive
that:
- `index.html` links `./manifest.json`, `./icons/...`, `./app.js` — all
  relative, never a leading `/`
- `manifest.json`'s `start_url` and `scope` are `"."`, not `"/"`
- `service-worker.js` is registered as `./service-worker.js` (not
  `/service-worker.js`) so its scope resolves under the repo subpath,
  and every file it caches is a relative path resolved from its own
  location
- `docs/404.html` is a safety net: TallyField has no URL-based routing
  (screens live in memory, not in the address bar), so a plain refresh
  never breaks it — this file only matters if someone hits a stray or
  mistyped deep link, and it bounces back to the app's actual base path
  whether that's a project subpath or a root domain

## 5. No PHP, by design (root and docs/ builds)

`mock.js` stands in for the entire `api/` folder — same call shape
(`apiJson(method, path, body)`), same response shape, but backed by
`localStorage` instead of MySQL. `app.js` is the same UI code as the
backend-connected `public/app.js`, with only the transport layer
swapped. No screen was stubbed out or left blank — every one from the
original build (login, rep home, customer detail, check-in, log
outcome, sync status, owner dashboard) is fully wired, just against
mock data.

**Demo login:** any 10-digit number plus any 4–6 digit code signs in.
`9000000001` loads the seeded Rep identity (Suresh K.); `9000000000`
loads the seeded Owner identity; any other number gets a fresh demo Rep
sharing the same seeded customer list. The login screen states this on
screen so a visitor isn't left guessing.

## 6. What "synced to Tally" means in this build

There's no real Tally connection here — logging an order or collection
sets `sync_status: pending`, then `mock.js` flips it to `synced` about
two seconds later on a timer, so the Sync Status screen's pending →
synced transition is demonstrated faithfully without a live backend.
Data persists in the browser's `localStorage` (per-browser, per-device
— not shared between visitors), so a refresh keeps whatever a demo
session logged.

## 7. PWA implementation, stack, and dependencies

Kept in the existing stack throughout — **no React, no Next.js, no
Node build step, no bundler.** Everything below is either plain
browser-native APIs or Workbox loaded straight off its CDN inside the
service worker (`importScripts(...)`), the same way a `<script>` tag
would be used anywhere else in this project. There is nothing to `npm
install`; the only "dependency" is the pinned Workbox CDN URL
(`workbox-sw.js` release `7.1.0`) referenced at the top of each
`service-worker.js`.

- **Manifest** (`manifest.json`, root/`docs/`/`public/`) — installable
  name, `start_url`/`scope` set to `"."` so it resolves correctly under
  a GitHub Pages subpath, `standalone` display, navy `theme_color`/
  `background_color` matching the app's own design system, and both
  `any` and `maskable` PNG icons (192/512) plus an SVG fallback.
- **Icons & splash screens** — real PNGs, not placeholders, generated
  from the app's own navy/blue mark by `tools/generate-icons.py`
  (`pip install pillow`, then `python3 tools/generate-icons.py --out
  <public|docs>`). Produces `icons/icon-192.png`, `icon-512.png`, their
  maskable variants, `apple-touch-icon.png`, and four common iOS splash
  sizes under `splash/`. Android/Chrome generates its own splash screen
  automatically from the manifest icon + `background_color` — no splash
  files or meta tags needed there; iOS needs the explicit
  `apple-touch-startup-image` links, which are already in both
  `index.html`s.
- **Service worker** (Workbox) — precaches the app shell so it opens
  with zero network; `NetworkFirst` for navigations (fast when online,
  falls back to cache within 3s when not); `CacheFirst` for Google
  Fonts and images; and, in the `public/` (backend-connected) build
  specifically, an explicit `NetworkOnly` route for anything under
  `/api/` so session-bearing requests are never cached or served stale
  — this is the one place the two service workers differ, and it's
  exactly the boundary requested: server-side behavior stays untouched.
- **Automatic updates** — Workbox's `skipWaiting()` + `clientsClaim()`
  mean a newly installed service worker takes over immediately; `app.js`
  listens for `controllerchange` and reloads the page once so the new
  assets actually get used, and re-checks for updates whenever the tab
  regains focus (`visibilitychange`) rather than waiting on the
  browser's own ~24h check.
- **Installability** — the native `beforeinstallprompt` event is
  captured and surfaced as an "Install App" button in the top bar
  (browsers hide their own install affordance in places people don't
  reliably notice); `appinstalled` clears it once installed.
- **Online/offline detection** — a persistent status chip in the top
  bar (not just a per-screen banner) reflects `navigator.onLine` in
  real time, plus a toast on each transition; reconnecting triggers an
  immediate flush of the offline queue (`queue.js`, unchanged).
- **Responsive layout** — unchanged mobile-first CSS, with one
  addition: at ≥900px the bottom tab bar becomes a static row directly
  under the top bar instead of staying pinned to the bottom of a
  suddenly-wide screen, so desktop/tablet gets a layout suited to the
  space rather than a stretched phone UI.
- **HTTPS** — GitHub Pages serves HTTPS automatically for both root and
  project pages, which is a hard requirement for service workers to
  register at all; for the `public/` build on Hostinger, this is the
  same Let's Encrypt SSL step already covered in the Launch Checklist —
  nothing new required, just confirm it's issued before relying on the
  service worker there.

Nothing in `api/*.php`, `schema.sql`, or the app's screen logic changed
— every file touched here is manifest/service-worker/icon/meta-tag/CSS,
or an additive block in `app.js` (install prompt, update listener,
connection chip), exactly the "PWA layer only" scope this update was
about.

## 8. Pre-publish test pass

Before calling it done, click through once against the published URL,
not just `file://`:

- [ ] Root Pages URL opens the login screen directly, not README or a 404
- [ ] Log in as `9000000001` (Rep) — Rep Home loads the three seeded customers
- [ ] Open a customer, check in (allow location if prompted, or deny it and confirm the "couldn't get exact location" state still lets you continue)
- [ ] Log an Order, a Collection, and a Note across different visits — confirm each save toasts correctly and the outcome form's fields (item/qty, amount/payment mode/reference, note/follow-up) all persist
- [ ] Sync Status shows the logged items as Pending, then flips to Synced within a few seconds without a manual refresh
- [ ] Log out (or clear storage) and log back in as `9000000000` (Owner) — Dashboard shows non-zero KPIs and the activity feed from the Rep session above
- [ ] Reload the page mid-session — you land back on the same role's home screen, not logged out or stuck
- [ ] The top bar shows a live Online/Offline chip; toggling devtools' Network to Offline flips it within a second or two, with a toast on each transition
- [ ] Install the app (browser's native prompt, or the in-app "Install App" button that appears once `beforeinstallprompt` fires) and open it standalone — icon, name, theme color, and splash screen (mobile) should all read "TallyField", not a bare URL
- [ ] Go offline and reload — the app shell still loads from the Workbox-precached service worker
- [ ] Resize the window across phone/tablet/desktop widths — at ≥900px the tab bar moves to a static row under the top bar instead of staying pinned to the bottom
- [ ] Push a small change, redeploy, reopen the app with it already running in a tab — it reloads itself once and picks up the new version without needing a manual hard refresh
- [ ] Visit a nonsense sub-path of the Pages URL directly — `404.html` bounces you back to the app rather than showing GitHub's default 404
- [ ] Run Chrome DevTools → Lighthouse → PWA audit against the published URL — installability and service-worker checks should pass
