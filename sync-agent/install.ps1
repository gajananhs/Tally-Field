<#
.SYNOPSIS
  Installs the TallyField sync agent as a Windows Scheduled Task.

.EXAMPLE
  .\install.ps1 -ApiBase "https://your-api-domain.example.com/api" `
                -AgentKey "paste-the-key-from-Settings" `
                -TallyCompanyName "Canares Engineering Co Kumta 2025-26"

  Uses default Tally host/port (localhost:9000) and a 60-second poll
  interval. Add -TallyHost / -TallyPort / -PollIntervalSeconds to
  override, and -CashLedger / -UPILedger / -ChequeLedger / -BankLedger
  if your Tally chart of accounts uses different ledger names than the
  defaults below — get these wrong and Receipt vouchers will fail to
  import even though everything else works.
#>

param(
    [Parameter(Mandatory = $true)][string]$ApiBase,
    [Parameter(Mandatory = $true)][string]$AgentKey,
    [Parameter(Mandatory = $true)][string]$TallyCompanyName,
    [string]$TallyHost = 'localhost',
    [int]$TallyPort = 9000,
    [int]$PollIntervalSeconds = 60,
    [bool]$InvertBalanceSign = $true,
    [string]$CashLedger = 'Cash',
    [string]$BankLedger = 'Bank',
    [string]$UPILedger = 'Bank',
    [string]$ChequeLedger = 'Bank'
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$configPath = Join-Path $scriptDir 'tallyfield-agent.config.json'
$agentScript = Join-Path $scriptDir 'tally_sync_agent.ps1'

if (-not (Test-Path $agentScript)) {
    Write-Error "tally_sync_agent.ps1 not found next to install.ps1 — keep both files in the same folder."
    exit 1
}

$config = @{
    ApiBase              = $ApiBase
    AgentKey             = $AgentKey
    TallyHost            = $TallyHost
    TallyPort            = $TallyPort
    TallyCompanyName     = $TallyCompanyName
    PollIntervalSeconds  = $PollIntervalSeconds
    InvertBalanceSign    = $InvertBalanceSign
    LedgerMap            = @{ Cash = $CashLedger; Bank = $BankLedger; UPI = $UPILedger; Cheque = $ChequeLedger }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
Write-Host "Wrote config to $configPath"

# Quick self-test before registering the task, so a typo in ApiBase or
# AgentKey is caught here rather than silently failing every 60s forever.
Write-Host "Testing the connection to the TallyField API..."
try {
    $testUri = "$($ApiBase.TrimEnd('/'))/agent/pull.php?hostname=install-test"
    Invoke-RestMethod -Method Get -Uri $testUri -Headers @{ 'X-Agent-Key' = $AgentKey } -TimeoutSec 15 | Out-Null
    Write-Host "API reachable and agent key accepted." -ForegroundColor Green
} catch {
    Write-Warning "Could not verify the API/agent key right now: $($_.Exception.Message)"
    Write-Warning "Installing anyway — check tallyfield-agent.log after the first run if syncing doesn't start."
}

$taskName = 'TallyField Sync Agent'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentScript`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Seconds $PollIntervalSeconds) `
    -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing '$taskName' task before re-registering."
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Syncs TallyField field-sales data with Tally. See README-AGENT.md.' | Out-Null

Write-Host ""
Write-Host "Installed. '$taskName' will run every $PollIntervalSeconds seconds." -ForegroundColor Green
Write-Host "This only runs while a user is logged into this Windows session (the default Scheduled Task mode)."
Write-Host "For an unattended machine, open Task Scheduler, find '$taskName', and change 'Run whether user is logged on or not' under its Properties — you'll be prompted for that Windows account's password."
Write-Host ""
Write-Host "To run one pass right now instead of waiting: powershell -File `"$agentScript`""
Write-Host "Logs: $(Join-Path $scriptDir 'tallyfield-agent.log')"
