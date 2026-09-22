# TallyField — reference PWA scaffold

A working starting point, not a finished product: front end (installable
PWA), PHP/PDO/MySQL API, and a service worker, built to match the
[[tallyfield]] blueprint, screen spec, and Launch Checklist, with every
fix from the Release QA Pass already applied.

## What's here

```
index.html             Complete PWA — all 10 screens (Login, Rep Home,
                        Customer Detail, Check-in, Log Outcome, Sync Status,
                        Owner Dashboard, Rep Drilldown, Reports, Settings).
                        Login calls the real OTP backend at the API_BASE
                        constant near the top of the script — set that to
                        wherever api/ is deployed (see DEPLOY.md §10).
                        Everything else still runs on local mock data.
                        Published at the repo root so GitHub Pages works
                        with the default "/(root)" source.
manifest.json, service-worker.js, icons/, splash/, .nojekyll, 404.html
                       Supporting PWA files for the root build.
docs/                  Identical copy of the above, for the "/docs" Pages
                       source option instead, if you prefer that layout.
tools/generate-icons.py  Regenerates icons/ and splash/ (needs Pillow).
schema.sql             Production schema (scheduled_date + feed index fixes included)
seed.sql               Dev/demo data only — never run against production
api/
  .env.example           Copy to api/.env — DB, JWT_SECRET, SMS_PROVIDER, CORS
  config.php            DB connection, requireAuth() (JWT), sendOtpSms(), error logging
  auth/                 send-otp.php, verify-otp.php, logout.php
  visits/               list.php, checkin.php
  customers/             get.php
  field-transactions/   create.php, list.php, retry.php
  owner/                 dashboard.php
public/                  Backend-connected PWA build — needs api/ + a real MySQL host
  index.html             App shell (phone/OTP login, real fetch() calls to api/)
  app.js                 Router, screens, real fetch() calls to api/
  queue.js               IndexedDB offline queue for check-in / log outcome
  service-worker.js      Workbox — precaches the shell, NetworkOnly for /api/
  manifest.json           PWA installability
  icons/, splash/         Same generated icon/splash set as the root build
DEPLOY.md               GitHub Pages setup steps, PWA implementation notes, test checklist
```

## QA fixes already applied here

Everything flagged in the Release QA Pass is fixed in this scaffold, not
just documented:

- **Defect 1** (OTP brute-force) — `send-otp.php` rate-limits to 5 sends/hour per user before generating a new code
- **Defect 2** (Order submission contract) — `create.php` validates Orders on `items_json`, not `amount`; the front end collects the right fields per type
- **Defect 3** (visit date logic) — `visits.scheduled_date` replaces the broken `COALESCE(checkin_time, NOW())` filter
- **Defect 4** (phone enumeration) — `send-otp.php` returns the same response whether or not the phone is registered
- **Defect 5** (XSS) — every dynamic value in `app.js` goes through `esc()` before hitting `innerHTML`
- **Defect 6** (stale UI state) — `checkinPhoto`, `checkinGpsState`, and `outcomeType` are reset at the top of their `wire*()` functions on every screen entry
- **Defect 7** (dropped form fields) — the Log Outcome submit handler now reads every field per type into the actual payload
- **Defect 8** (missing index) — `idx_ft_tenant_created` added; the dashboard feed query is also bounded to the last 7 days
- **Defect 9** (duplicate check-in / upload size) — `checkin.php` returns the existing visit instead of creating a duplicate, and rejects a `photo_base64` over ~4 MB
- **Defect 10** (no current-user concept) — the front end now authenticates for real; every screen's data comes from the session-scoped API, not a hardcoded mock user

## What's stubbed, on purpose

This is a reference scaffold, not the full app — it covers the core loop
(login → check-in → log outcome → sync) end to end. Not yet built, but
following the exact same `config.php` + `requireAuth()` + `esc()`
patterns already in place:

- Rep Drilldown, Reports, and Settings screens/endpoints
- Real SMS sending in `send-otp.php` (the `// BACKEND:` comment marks where)
- Photo upload to real storage in `checkin.php` (same marker)
- The Windows desktop Tally sync agent itself — this scaffold's API writes
  `field_transactions` rows for the agent to pick up; the agent is the
  existing one from [[capl-mobile-apps]], reused as-is per the blueprint

## Deploying, per the Launch Checklist

1. Run `schema.sql` against a fresh production MySQL database — **do not** run `seed.sql` there
2. Set `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` as environment variables on the Hostinger PHP runtime; confirm `config.php` never falls back to its empty defaults
3. Upload `api/` and the contents of `public/` to the subdomain's web root (`public/index.html` becomes the site's `index.html`)
4. Confirm HTTPS is issued for the exact subdomain before go-live
5. Insert the real `tenants` and `users` rows (owner + first rep, real phone numbers) — replace, don't append to, any test rows
6. Point the existing desktop Tally sync agent at this tenant's `field_transactions` queue
7. Run the Go-Live Sequence's T-15-minute smoke test (login, check-in, log a real collection, confirm it reaches `sync_status = synced` and appears correctly in Tally) before inviting the first real rep

## Local development

Any PHP 8+ / MySQL setup works. Quick start:

```bash
mysql -u root -p tallyfield < schema.sql
mysql -u root -p tallyfield < seed.sql   # dev only
php -S localhost:8080 -t public
```

Point `api/config.php`'s defaults at your local MySQL, or export the four
`DB_*` environment variables before starting PHP's built-in server. The
API isn't reachable at `localhost:8080/api/...` this way unless you also
serve `api/` from the same document root — for local testing, symlink or
copy `api/` into `public/api/`, or run a second `php -S` instance for it
and adjust `API_BASE` in `app.js` accordingly.
