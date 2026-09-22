# Deploying TallyField to GitHub Pages

`docs/` is a **separate, static-only build** of the app, kept apart from
the real backend in `api/` and `public/` (which needs PHP/MySQL and
can't run on Pages). Opening the Pages URL opens the TallyField app
directly — never this repo's README.

## 1. Push `docs/` to your repo

Commit the whole `docs/` folder as-is, at the repo root, alongside
(not replacing) `api/`, `public/`, `schema.sql`, and `README.md`.

## 2. Turn on Pages

Repo → **Settings → Pages**:
- **Source:** Deploy from a branch
- **Branch:** `main` (or whichever branch you pushed to), folder **`/docs`**
- Save. GitHub builds and publishes in a minute or two.

That's the whole setup — no build step, no Actions workflow needed,
because `docs/` is already the final static output.

## 3. Why the README won't show up

Two things prevent it, independently:
- `docs/index.html` exists, and GitHub Pages always serves `index.html`
  over any README when both are present in the published folder.
- `docs/.nojekyll` disables Jekyll processing entirely, so GitHub never
  tries to render the README into a themed homepage in the first place.

`README.md` stays at the repo root, outside `docs/`, so it's simply
never part of what Pages publishes.

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

## 5. No PHP, by design

`docs/mock.js` stands in for the entire `api/` folder — same call
shape (`apiJson(method, path, body)`), same response shape, but backed
by `localStorage` instead of MySQL. `docs/app.js` is the same UI code
as the backend-connected `public/app.js`, with only the transport layer
swapped (see the diff: `api()` calls `window.TallyFieldMockApi(...)`
instead of `fetch()`). No screen was stubbed out or left blank — every
one from the original build (login, rep home, customer detail,
check-in, log outcome, sync status, owner dashboard) is fully wired,
just against mock data.

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

## 7. Pre-publish test pass

Before calling it done, click through once against the published URL,
not just `file://`:

- [ ] Root Pages URL opens the login screen directly, not README or a 404
- [ ] Log in as `9000000001` (Rep) — Rep Home loads the three seeded customers
- [ ] Open a customer, check in (allow location if prompted, or deny it and confirm the "couldn't get exact location" state still lets you continue)
- [ ] Log an Order, a Collection, and a Note across different visits — confirm each save toasts correctly and the outcome form's fields (item/qty, amount/payment mode/reference, note/follow-up) all persist
- [ ] Sync Status shows the logged items as Pending, then flips to Synced within a few seconds without a manual refresh
- [ ] Log out (or clear storage) and log back in as `9000000000` (Owner) — Dashboard shows non-zero KPIs and the activity feed from the Rep session above
- [ ] Reload the page mid-session — you land back on the same role's home screen, not logged out or stuck
- [ ] Install the app (browser's "Install app" / "Add to Home Screen" prompt) and open it standalone — icon, name, and standalone window chrome should all read "TallyField", not a bare URL
- [ ] Go offline (devtools → Network → Offline) and reload — the app shell still loads from the service worker cache
- [ ] Visit a nonsense sub-path of the Pages URL directly — `404.html` bounces you back to the app rather than showing GitHub's default 404
