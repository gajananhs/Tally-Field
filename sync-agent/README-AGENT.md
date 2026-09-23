# TallyField Sync Agent

Runs on the Windows machine that has Tally open. Pulls pending orders
and collections from TallyField, posts them into Tally as vouchers, and
pushes ledger balances back so the app's "Outstanding" figures reflect
real Tally data.

## Before you install

1. Tally itself must already be reachable — if you haven't confirmed
   this yet, work through the earlier connectivity checklist first
   (company name matches exactly, ODBC/HTTP server enabled in
   Connectivity Settings, correct port, company actually open).
2. Get the **agent key** from the TallyField Settings screen. If
   "Download Sync Agent" previously did nothing, that's because this
   installer didn't exist on the server yet — it does now (see the main
   reply for where it's hosted).
3. Confirm PowerShell is available: open PowerShell and run
   `$PSVersionTable.PSVersion` — 5.1 (built into Windows 10/11) is fine,
   this script doesn't require PowerShell 7.

## Install

Open PowerShell **as the user who'll be logged into this machine
day to day** (not elevated/Administrator — the default Scheduled Task
mode only needs a normal logged-in session), `cd` into this folder, then:

```powershell
.\install.ps1 -ApiBase "https://your-api-domain.example.com/api" `
              -AgentKey "the-key-from-Settings" `
              -TallyCompanyName "Canares Engineering Co Kumta 2025-26"
```

Use the **exact** company name as it appears in Tally (see the earlier
troubleshooting — this is the single most common setup mistake).

If your Tally chart of accounts uses different ledger names for cash
and bank than the defaults, also pass `-CashLedger`, `-BankLedger`,
`-UPILedger`, `-ChequeLedger` — collections will fail to import into
Tally if these don't match a real ledger name exactly.

The installer runs a quick connection test and then registers a
Scheduled Task ("TallyField Sync Agent") that runs every 60 seconds by
default (`-PollIntervalSeconds` to change it).

## Verify it's working

- Check `tallyfield-agent.log` in this folder after a minute or two —
  it logs every pass, including why anything failed.
- In TallyField's Settings screen, the connection status should flip to
  Connected and "Last synced" should update.
- Log a test Collection from the Rep app — within one poll interval it
  should show as Synced in Sync Status, and a real Receipt voucher
  should appear in Tally.

## Known limitation: Orders

TallyField's Log Outcome form captures an item name and quantity for an
Order, but **no price** — so this agent can't post a real, balanced
Sales Invoice (that would mean inventing a number and writing it into
your real books, which this deliberately does not do). Instead, an
Order is posted to Tally as a **Sales Order** voucher — quantity only,
no accounting effect — so your office can see it and convert it to a
priced invoice manually. This also means the item name must exactly
match an existing Stock Item in Tally, or that one voucher will fail
(it'll show as Failed in Sync Status with the reason). If you need
Orders to post as real priced invoices, the Log Outcome form needs a
price field added first — that's a frontend change, not something this
agent can work around on its own.

## Uninstall

```powershell
.\uninstall.ps1
```

Add `-RemoveConfig` to also delete the saved ledger-name mappings.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Log says "Could not reach Tally" | Tally's HTTP server isn't enabled, wrong port, or Tally/the company isn't open — see the earlier connectivity checklist |
| Log says "Tally reported N error(s)" | A ledger or stock item name in TallyField doesn't exactly match Tally — check the specific error in the raw response |
| Balances never update in the app | Check `tallyfield-agent.log` for "Pushed balances" — if that line is missing, the API call itself is failing (check ApiBase and the agent key) |
| Everything logs success but nothing shows in Tally | Confirm `-TallyCompanyName` matches the company that's actually **open** on screen, not just a company that exists in Tally's data |
| Collections fail, Orders work (or vice versa) | Check the `LedgerMap` values in `tallyfield-agent.config.json` — Cash/Bank/UPI/Cheque must be real ledger names in your Tally |
