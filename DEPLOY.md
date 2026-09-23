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

## 10. Real OTP login (SMS gateway + JWT)

Login now talks to a real backend — `api/auth/send-otp.php` and
`api/auth/verify-otp.php` — instead of the local, hardcoded demo lookup.
The rest of the app (customers, visits, transactions, reports) is
unchanged and still runs on local mock data in every build; **only
authentication is real now.**

### Setup

1. Copy `api/.env.example` to `api/.env` and fill in real values — never
   commit the real `.env`.
2. Generate a JWT secret: `php -r "echo bin2hex(random_bytes(32));"` —
   paste the output as `JWT_SECRET`. A short or missing secret makes
   `issueJwt()` throw on purpose rather than sign with something guessable.
3. Pick one SMS provider and set `SMS_PROVIDER` to `msg91`, `twilio`, or
   `fast2sms`, then fill in that provider's credentials only:
   - **MSG91** (default, India-focused) needs `MSG91_AUTH_KEY` and a
     **DLT-registered** `MSG91_TEMPLATE_ID` — Indian carriers reject
     transactional SMS without one; MSG91's dashboard walks through
     template registration.
   - **Twilio** needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
     `TWILIO_FROM_NUMBER` — works outside India too, no DLT template needed.
   - **Fast2SMS** needs only `FAST2SMS_API_KEY` — simplest to set up for
     an India-only pilot, no template pre-registration for its `otp` route.
4. Run the updated `schema.sql` (adds the `revoked_tokens` table used for
   logout) against your database if you already ran an earlier version.
5. If the frontend is hosted separately from this API (see below), set
   `ALLOWED_ORIGINS` to that frontend's exact origin.

### Wiring the root/`docs/` GitHub Pages build to this API

GitHub Pages only serves static files — it cannot run `api/*.php` itself.
So the root and `docs/` builds' `index.html` now points its login calls
at an `API_BASE` constant near the top of the script:

```js
const API_BASE = 'https://your-api-domain.example.com/api';
```

Deploy the `api/` folder somewhere that runs PHP (the same Hostinger
subdomain used for the `public/` build works fine) and change
`API_BASE` to that URL before publishing. Until you do, the login
screen will show "Couldn't reach the server — check your connection and
API_BASE" — that message is doing its job, not a bug. Once it's set,
also add the GitHub Pages URL to `ALLOWED_ORIGINS` in `api/.env` so the
browser's CORS preflight succeeds.

The `public/` build doesn't need any of this — it already shares an
origin with `api/` (same Hostinger deployment), so `ALLOWED_ORIGINS`
can stay empty for it.

### What changed under the hood

- **Real SMS delivery** — `send-otp.php` calls the configured provider
  and only stores the OTP hash once the gateway confirms it accepted
  the message; a gateway failure returns `502 sms_send_failed` with a
  message the frontend shows verbatim, rather than pretending an SMS
  that was never sent is on its way.
- **Distinct verify errors** — `verify-otp.php` now tells `otp_expired`
  apart from `otp_mismatch` and `otp_not_requested`, so the frontend can
  say "request a new one" instead of a generic "wrong code" when that's
  not actually what happened.
- **JWT sessions** — `verify-otp.php` issues a signed JWT (hand-rolled
  HS256 in `config.php`, no Composer dependency) instead of the earlier
  opaque-token-in-a-`sessions`-row scheme. `requireAuth()` in every
  other endpoint verifies the signature and expiry directly — same
  return shape as before, so nothing else in `api/` needed to change.
- **Real logout** — since JWTs are stateless, `logout.php` records the
  token's `jti` in `revoked_tokens` so `requireAuth()` rejects it
  immediately instead of waiting out its natural expiry.
- **No more identity-switcher shortcut** — the previous build's top-bar
  "switch to any seeded user instantly" convenience is gone; with real
  OTP behind it, that would have been a login bypass. The Account modal
  is now just the current user's info and a real Log Out.
- **Settings' rep management is explicitly local-only now** — adding a
  rep there updates the mock `db` so the rest of the demo reflects it,
  but doesn't create a row in the real `users` table, so that person
  couldn't actually sign in. The screen says so.

## 11. Desktop sync agent

`sync-agent/` is a Windows PowerShell agent — install it on whichever
office machine keeps Tally open — plus three new API endpoints it talks
to (`api/agent/pull.php`, `result.php`, `balances.php`), authenticated
with the per-tenant `agent_key` from `tally_connections`, not a user
JWT. Full setup is in `sync-agent/README-AGENT.md`.

### Deploy

1. Upload the new `api/agent/` folder and the updated `api/config.php`
   (adds `requireAgent()`) to the same place `api/` already lives.
2. Upload `api/downloads/tallyfield-sync-agent.zip` too — the
   Settings screen's "Download Sync Agent" button now links directly to
   `${API_BASE}/downloads/tallyfield-sync-agent.zip`, so this file has
   to actually be there or the button 404s.
3. Run the new `CREATE TABLE tally_connections` statement from
   `schema.sql` — skip this if it's the one you already added by hand
   in phpMyAdmin.
4. On the office machine: unzip `tallyfield-sync-agent.zip`, get the
   agent key from Settings, and follow `README-AGENT.md`.

### What it actually does

- **Pull direction** (real balances into the app): reads every ledger's
  closing balance from Tally via an inline TDL Collection request, and
  pushes them to `agent/balances.php`, which upserts `tally_parties` by
  `ledger_name` — this is what makes "Outstanding" in the app reflect
  real Tally data instead of seed values.
- **Push direction** (orders/collections into Tally): pulls pending
  `field_transactions` from `agent/pull.php` (which atomically claims
  them so two agent runs can't double-process the same row), posts a
  real **Receipt voucher** for each Collection, and reports success or
  failure back to `agent/result.php`.
- **Orders are a known limitation, not an oversight** — the Log Outcome
  form never captured a price, so a balanced Sales Invoice isn't
  possible without inventing one. Orders post as a **Sales Order**
  voucher (quantity only) instead, for the office to price and convert
  manually. See `README-AGENT.md` for what it'd take to change this.
- **The `<ERRORS>0</ERRORS>` gotcha is handled correctly** — Tally's
  success response still contains an `<ERRORS>` tag, just with value 0;
  the agent parses the actual count rather than treating the tag's mere
  presence as a failure (a real bug from an earlier Tally integration
  this project's memory notes, deliberately avoided here).

## 12. Temporary OTP bypass (while MSG91's DLT template is pending)

Set `OTP_BYPASS_CODE` in `api/.env` to a 6-digit code — `send-otp.php`
then skips the real SMS gateway and stores that fixed code as if it had
been sent, for any registered phone number. `verify-otp.php` needed no
changes at all; it's still just comparing against whatever's in
`otp_codes`, which now happens to be a known value instead of a random
one. Every use gets logged (`otp_bypass_used` in the PHP error log) so
it's not something that fades into the background unnoticed.

**Remove `OTP_BYPASS_CODE` from `.env` the moment MSG91's template is
approved and real SMS is confirmed working.** While it's set, that one
code signs in as *any* registered user — fine for your own testing,
a real problem if it's ever live at the same time as real users.
