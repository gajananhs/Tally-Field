<#
.SYNOPSIS
  Removes the TallyField Scheduled Task. Config and log files are left
  in place unless -RemoveConfig is passed, so a reinstall doesn't lose
  your ledger-name mappings.
#>
param([switch]$RemoveConfig)

$taskName = 'TallyField Sync Agent'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed the '$taskName' scheduled task." -ForegroundColor Green
} else {
    Write-Host "No '$taskName' scheduled task was found — nothing to remove."
}

if ($RemoveConfig) {
    $configPath = Join-Path $PSScriptRoot 'tallyfield-agent.config.json'
    if (Test-Path $configPath) { Remove-Item $configPath; Write-Host "Removed $configPath" }
}
