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

The root and `docs/` builds are a **single self-contained `index.html`**
— every table (`tenants`, `users`, `tally_parties`, `customers`,
`visits`, `field_transactions`, `attendance`, `sync_log`) simulated as
arrays in `localStorage` (`tallyfield_v2_db`), no separate `app.js` to
keep in sync. All 10 screens from the spec are fully built, not
stubbed: Login (phone + OTP), Rep Home, Customer Detail, Check-in, Log
Outcome, Sync Status, Owner Dashboard, Rep Drilldown, Reports, and
Settings.

**Login:** phone number must match a seeded user, then any 6-digit code
signs in — a real login *screen* with real state transitions (Send OTP
→ 30s resend countdown → Verify), just without a real SMS gateway
behind it. Demo numbers: `9000000001` (Suresh K., Field Rep),
`9000000000` (Gajanan, Owner) — shown on screen so a visitor isn't left
guessing. The session persists across a reload (`localStorage`,
`tallyfield_v2_session`); a fresh browser profile starts at Login. The
user chip in the top bar doubles as a fast switcher between the 4
seeded identities without re-entering an OTP, and includes Log Out.

Adding a rep, logging a visit outcome, or retrying a sync updates
`localStorage` immediately and re-renders — the Owner Dashboard's KPI
tiles and activity feed reflect it live.

## 6. What "synced to Tally" means in this build

There's no real Tally connection — logging an Order or Collection sets
`sync_status: pending`, then the app flips it to `synced` (with a
generated `RCPT-####` voucher number) about two seconds later on a
timer, so the Sync Status screen's pending → synced transition is
demonstrated faithfully. The seeded Failed transaction
("Ledger name mismatch in Tally") stays failed until you tap Retry.
Data persists per-browser, per-device — clear the site's storage (or
open a private window) to reset to the original seed data.

## 7. Reports export

**CSV export is real** — clicking it in the Reports screen generates
an actual `.csv` file client-side (`Blob` + `URL.createObjectURL`) for
whichever tab and rep filter is active, and downloads it. PDF export is
a labeled stub (a toast, no library pulled in for a prototype) rather
than a fake download — honest about what does and doesn't work yet.

## 8. PWA implementation, stack, and dependencies

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
  mean a newly installed service worker takes over immediately; the inline script in `index.html`
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
  real time, plus a toast on each transition. The root/`docs/` build writes
  straight to `localStorage` either way — there's no real network
  round-trip to queue — so a check-in or outcome saves instantly
  online or offline alike; the `public/` (backend-connected) build
  still uses `queue.js`'s IndexedDB queue for real API calls.
- **Responsive layout** — unchanged mobile-first CSS, with one
  addition: the section tab bar sits in a sticky strip directly under the top
  bar and scrolls horizontally on narrow screens rather than wrapping
  or overflowing, so the same markup works from phone to desktop
  without a breakpoint swap.
- **HTTPS** — GitHub Pages serves HTTPS automatically for both root and
  project pages, which is a hard requirement for service workers to
  register at all; for the `public/` build on Hostinger, this is the
  same Let's Encrypt SSL step already covered in the Launch Checklist —
  nothing new required, just confirm it's issued before relying on the
  service worker there.

Nothing in `api/*.php`, `schema.sql`, or the app's screen logic changed
— every file touched here is manifest/service-worker/icon/meta-tag/CSS,
or an additive block in the app's own script (install prompt, update
listener, connection chip); the root/`docs/` `index.html` itself was
rebuilt in full to match the current app specification (see sections
5–7).

## 9. Pre-publish test pass

Before calling it done, click through once against the published URL,
not just `file://`:

- [ ] Root Pages URL opens the Login screen directly, not README or a 404
- [ ] Entering an invalid phone (not 10 digits) shows an inline error without leaving the screen
- [ ] Entering a valid but unknown phone shows "Number not recognized" with the demo numbers as the fix
- [ ] Entering `9000000001` shows the OTP field with a 30s resend countdown; any 6-digit code signs in as Suresh K. (Field Rep) and lands on Rep Home
- [ ] Rep Home shows the seeded visits with distance, balance, and correct status chips ("+ Add Visit" opens a customer search modal)
- [ ] Tap a not-yet-visited customer's Check In — Customer Detail renders with Call/Get Directions links, then Check-in captures GPS/photo (or shows the "couldn't get exact location" fallback and still lets you continue) and Confirm Check-In moves to Log Outcome
- [ ] Log Outcome: toggle through Order / Collection / Note — each shows its own fields; a Note with "needs follow-up" checked reveals a follow-up date field; submitting a Collection reduces that customer's balance and appears in Sync Status as Pending, then flips to Synced with a generated voucher number within a few seconds
- [ ] Sync Status's seeded Failed item shows its error reason and a Retry button; Retry (and Retry All) move it to Pending then Synced; "Details" opens the full transaction modal
- [ ] Tap the user chip in the top bar — switches identity instantly between all 4 seeded users without re-entering an OTP; Log Out returns to the Login screen
- [ ] Switched to Gajanan (Owner) — Dashboard shows 4 KPI tiles with non-zero values and a rep map; clicking a KPI opens Reports with that context; clicking a rep pin or feed row opens Rep Drilldown
- [ ] Rep Drilldown: Today / This Week / Custom range all filter the visit log and totals correctly; Custom shows date pickers
- [ ] Reports: switching tabs (Visit Log / Collections / Outstanding by Rep) and the rep filter both update the table; Export CSV actually downloads a `.csv` file matching the current view; Export PDF shows the "would download here" toast
- [ ] Settings shows the Tally connection card, install key (Copy Install Key works), Test Connection flips the status chip, and the rep table lists all 3 reps; Add Rep and Remove both update the list and persist
- [ ] Reload the page mid-session — you land back on the same screen's role, not logged out, and every change made (new rep, new transactions, updated balances) persists
- [ ] The top bar shows a live Online/Offline chip and a Sync Queue badge with the correct pending count; toggling devtools' Network to Offline flips the chip within a second or two
- [ ] Resize the window across phone/tablet/desktop widths — tabs stay usable (horizontally scrollable on narrow screens) at every size
- [ ] Install the app (native prompt or browser menu) and open it standalone — icon, name, theme color, and splash screen (mobile) all read "TallyField"
- [ ] Go offline and reload — the app still loads fully from the Workbox-precached service worker
- [ ] Push a small change, redeploy, reopen the app with it already running in a tab — it reloads itself once and picks up the new version
- [ ] Visit a nonsense sub-path of the Pages URL directly — `404.html` bounces you back to the app
- [ ] Run Chrome DevTools → Lighthouse → PWA audit against the published URL — installability and service-worker checks should pass
