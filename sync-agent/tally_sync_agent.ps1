<#
.SYNOPSIS
  TallyField desktop sync agent. Pulls pending orders/collections from
  the TallyField API, posts them into Tally as vouchers, and pushes
  ledger balances back so the app's "Outstanding" figures reflect real
  Tally data.

.DESCRIPTION
  Run via -Once (default; intended for Windows Task Scheduler, one pass
  per invocation) or -Loop (keeps running, polling every
  PollIntervalSeconds — useful for manual testing on the console).

  Requires tallyfield-agent.config.json next to this script — created
  by install.ps1. See README-AGENT.md before running this for the
  first time; the ledger-name mappings in the config MUST match your
  actual Tally chart of accounts or vouchers will fail to import.

.NOTES
  KNOWN HISTORICAL BUG THIS SCRIPT DELIBERATELY AVOIDS:
  Tally's XML response ALWAYS includes an <ERRORS>N</ERRORS> tag, with
  N=0 on success. Checking only for the tag's presence — not its value
  — misreads every successful import as a failure. Parse-TallyResponse
  below reads the actual integer.
#>

param(
    [switch]$Loop,
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'tallyfield-agent.config.json')
)

$ErrorActionPreference = 'Stop'
$LogPath = Join-Path $PSScriptRoot 'tallyfield-agent.log'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $LogPath -Value $line
    Write-Host $line
}

function Load-Config {
    if (-not (Test-Path $ConfigPath)) {
        Write-Log "Config file not found at $ConfigPath — run install.ps1 first." 'ERROR'
        exit 1
    }
    try {
        return Get-Content $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        Write-Log "Config file at $ConfigPath is not valid JSON: $($_.Exception.Message)" 'ERROR'
        exit 1
    }
}

# ---------------------------------------------------------------------
# TallyField API calls — X-Agent-Key header first; falls back to a
# ?key= query param if the header never reaches PHP (some shared-hosting
# configs strip custom headers before the app sees them).
# ---------------------------------------------------------------------
function Invoke-Api {
    param([string]$Method, [string]$Path, $Body = $null)
    $base = $Config.ApiBase.TrimEnd('/')
    $uri = "$base$Path"
    $headers = @{ 'X-Agent-Key' = $Config.AgentKey }
    $params = @{ Method = $Method; Uri = $uri; Headers = $headers; TimeoutSec = 20 }
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
        $params.ContentType = 'application/json'
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $resp = $_.Exception.Response
        if ($resp -and $resp.StatusCode.value__ -eq 401) {
            # Retry once with the key as a query param instead of a header.
            $sep = if ($uri.Contains('?')) { '&' } else { '?' }
            $params.Uri = "$uri$sep" + "key=$($Config.AgentKey)"
            $params.Headers = @{}
            try { return Invoke-RestMethod @params }
            catch { Write-Log "API call failed (after key-param fallback): $Method $Path — $($_.Exception.Message)" 'ERROR'; throw }
        }
        Write-Log "API call failed: $Method $Path — $($_.Exception.Message)" 'ERROR'
        throw
    }
}

# ---------------------------------------------------------------------
# Tally XML/HTTP calls
# ---------------------------------------------------------------------
function Invoke-TallyXml {
    param([string]$XmlBody)
    $uri = "http://$($Config.TallyHost):$($Config.TallyPort)"
    try {
        return Invoke-RestMethod -Method Post -Uri $uri -Body $XmlBody -ContentType 'text/xml' -TimeoutSec 30
    } catch {
        Write-Log "Could not reach Tally at $uri — $($_.Exception.Message)" 'ERROR'
        throw
    }
}

# Parses a Tally import RESPONSE, correctly distinguishing a genuine
# error (ERRORS > 0) from a normal success response that merely CONTAINS
# an <ERRORS>0</ERRORS> tag — see the header comment.
function Parse-TallyResponse {
    param($RawResponse)
    try {
        [xml]$xml = $RawResponse
    } catch {
        return @{ Success = $false; ErrorMessage = "Tally response wasn't valid XML: $RawResponse" }
    }
    $resp = $xml.ENVELOPE.RESPONSE
    if (-not $resp) { $resp = $xml.RESPONSE }
    if (-not $resp) {
        return @{ Success = $false; ErrorMessage = "No <RESPONSE> in Tally's reply: $RawResponse" }
    }
    $errorCount = 0
    if ($resp.ERRORS) { [int]::TryParse([string]$resp.ERRORS, [ref]$errorCount) | Out-Null }
    $created = 0
    if ($resp.CREATED) { [int]::TryParse([string]$resp.CREATED, [ref]$created) | Out-Null }
    if ($errorCount -gt 0) {
        return @{ Success = $false; ErrorMessage = "Tally reported $errorCount error(s) — check LINEERROR in the raw response, or that ledger/stock-item names match exactly." }
    }
    if ($created -lt 1) {
        return @{ Success = $false; ErrorMessage = "Tally accepted the request but created 0 vouchers — usually a ledger name mismatch." }
    }
    $voucherId = ''
    if ($resp.LASTVCHID) { $voucherId = [string]$resp.LASTVCHID }
    return @{ Success = $true; VoucherId = $voucherId }
}

# ---------------------------------------------------------------------
# Ledger balances — pull direction. Uses an inline TDL Collection over
# Tally's built-in "Ledger" object type; this is the standard documented
# way to fetch NAME + CLOSINGBALANCE via the XML/HTTP gateway.
# ---------------------------------------------------------------------
function Get-LedgerBalances {
    $xml = @"
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>COLLECTION</TYPE>
    <ID>TallyFieldLedgerBalances</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>$($Config.TallyCompanyName)</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="TallyFieldLedgerBalances" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME,CLOSINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"@
    $raw = Invoke-TallyXml -XmlBody $xml
    [xml]$parsed = $raw
    $ledgerNodes = $parsed.ENVELOPE.COLLECTION.LEDGER
    if (-not $ledgerNodes) { return @() }

    $invert = [bool]$Config.InvertBalanceSign
    $results = @()
    foreach ($node in $ledgerNodes) {
        $name = [string]$node.NAME
        $balRaw = [string]$node.CLOSINGBALANCE
        if (-not $name -or $balRaw -eq '') { continue }
        $bal = 0.0
        if (-not [double]::TryParse($balRaw, [ref]$bal)) { continue }
        if ($invert) { $bal = -$bal }
        $results += @{ ledger_name = $name; balance = $bal }
    }
    return $results
}

# ---------------------------------------------------------------------
# Voucher builders
# ---------------------------------------------------------------------
function Get-PaymentLedger {
    param([string]$PaymentMode)
    switch ($PaymentMode) {
        'Cash' { return $Config.LedgerMap.Cash }
        'UPI' { return $Config.LedgerMap.UPI }
        'Cheque' { return $Config.LedgerMap.Cheque }
        default { return $Config.LedgerMap.Bank }
    }
}

function Build-ReceiptVoucherXml {
    param($Tx)
    $date = Get-Date -Format 'yyyyMMdd'
    $partyLedger = [System.Security.SecurityElement]::Escape($Tx.ledger_name)
    $paymentLedger = [System.Security.SecurityElement]::Escape((Get-PaymentLedger $Tx.payment_mode))
    $amount = [double]$Tx.amount
    $narration = [System.Security.SecurityElement]::Escape("Collected via TallyField — $($Tx.customer_name)" + $(if ($Tx.reference_no) { " (Ref: $($Tx.reference_no))" } else { '' }))

    return @"
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>$($Config.TallyCompanyName)</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Receipt" ACTION="Create">
            <DATE>$date</DATE>
            <NARRATION>$narration</NARRATION>
            <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>$partyLedger</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>$partyLedger</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>$amount</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>$paymentLedger</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-$amount</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"@
}

# LIMITATION (read before relying on this): TallyField's Log Outcome
# form only captures item name + quantity for an Order — no unit price.
# A real Sales Invoice must balance to a specific amount, which we
# don't have, so posting one here would mean inventing a price — never
# do that against a real set of books. Instead this posts a Sales
# ORDER voucher (quantity only, no accounting effect) so the order is
# visible in Tally for the office to convert into an invoice manually
# once pricing is confirmed. This also means the item NAME must exactly
# match an existing Stock Item in Tally, or the import will fail.
function Build-SalesOrderVoucherXml {
    param($Tx)
    $date = Get-Date -Format 'yyyyMMdd'
    $partyLedger = [System.Security.SecurityElement]::Escape($Tx.ledger_name)
    $narration = [System.Security.SecurityElement]::Escape("Order logged via TallyField — $($Tx.customer_name)")
    $itemEntries = ''
    foreach ($item in $Tx.items_json) {
        $itemName = [System.Security.SecurityElement]::Escape([string]$item.item)
        $qty = [double]$item.qty
        $itemEntries += @"
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>$itemName</STOCKITEMNAME>
              <ACTUALQTY>$qty Nos</ACTUALQTY>
              <BILLEDQTY>$qty Nos</BILLEDQTY>
              <RATE>0.00/Nos</RATE>
              <AMOUNT>0.00</AMOUNT>
            </ALLINVENTORYENTRIES.LIST>
"@
    }
    return @"
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>$($Config.TallyCompanyName)</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales Order" ACTION="Create">
            <DATE>$date</DATE>
            <NARRATION>$narration</NARRATION>
            <VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>$partyLedger</PARTYLEDGERNAME>
$itemEntries
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"@
}

# ---------------------------------------------------------------------
# Main pass
# ---------------------------------------------------------------------
function Invoke-SyncPass {
    Write-Log "Starting sync pass"

    # 1. Pull direction: ledger balances. Also doubles as the Tally
    #    connectivity check the app's Settings screen displays.
    $tallyOk = $true
    $tallyError = $null
    $balances = @()
    try {
        $balances = Get-LedgerBalances
        Write-Log "Read $($balances.Count) ledger balances from Tally"
    } catch {
        $tallyOk = $false
        $tallyError = $_.Exception.Message
    }

    try {
        Invoke-Api -Method Post -Path '/agent/balances.php' -Body @{
            tally_status = $(if ($tallyOk) { 'connected' } else { 'error' })
            error_message = $tallyError
            parties = $balances
        } | Out-Null
        Write-Log "Pushed balances to TallyField API"
    } catch {
        Write-Log "Could not push balances to the API — will retry next pass" 'ERROR'
    }

    if (-not $tallyOk) {
        Write-Log "Skipping voucher push this pass — Tally wasn't reachable" 'WARN'
        return
    }

    # 2. Push direction: pending orders/collections.
    try {
        $pending = Invoke-Api -Method Get -Path "/agent/pull.php?hostname=$($env:COMPUTERNAME)"
    } catch {
        Write-Log "Could not pull pending transactions from the API" 'ERROR'
        return
    }

    foreach ($tx in $pending.transactions) {
        Write-Log "Processing $($tx.type) for $($tx.customer_name) (id=$($tx.id))"
        try {
            $xml = if ($tx.type -eq 'collection') { Build-ReceiptVoucherXml $tx } else { Build-SalesOrderVoucherXml $tx }
            $raw = Invoke-TallyXml -XmlBody $xml
            $result = Parse-TallyResponse $raw

            if ($result.Success) {
                Write-Log "Synced $($tx.id) — Tally voucher $($result.VoucherId)"
                Invoke-Api -Method Post -Path '/agent/result.php' -Body @{ id = $tx.id; status = 'synced'; tally_voucher_id = $result.VoucherId } | Out-Null
            } else {
                Write-Log "Failed to sync $($tx.id): $($result.ErrorMessage)" 'ERROR'
                Invoke-Api -Method Post -Path '/agent/result.php' -Body @{ id = $tx.id; status = 'failed'; error_message = $result.ErrorMessage } | Out-Null
            }
        } catch {
            Write-Log "Unexpected error processing $($tx.id): $($_.Exception.Message)" 'ERROR'
            try { Invoke-Api -Method Post -Path '/agent/result.php' -Body @{ id = $tx.id; status = 'failed'; error_message = $_.Exception.Message } | Out-Null } catch {}
        }
    }

    Write-Log "Sync pass complete"
}

# ---------------------------------------------------------------------
$Config = Load-Config

if ($Loop) {
    Write-Log "Starting in loop mode — polling every $($Config.PollIntervalSeconds)s (Ctrl+C to stop)"
    while ($true) {
        try { Invoke-SyncPass } catch { Write-Log "Unhandled error in sync pass: $($_.Exception.Message)" 'ERROR' }
        Start-Sleep -Seconds $Config.PollIntervalSeconds
    }
} else {
    try { Invoke-SyncPass } catch { Write-Log "Unhandled error in sync pass: $($_.Exception.Message)" 'ERROR'; exit 1 }
}
