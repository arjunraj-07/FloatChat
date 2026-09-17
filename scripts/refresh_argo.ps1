<#
.SYNOPSIS
    Retrieve a recent Argo extract and activate it as the served dataset.

.DESCRIPTION
    Downloads the last N UTC days for the configured search region, processes
    it with the same QC policy as the January 2024 extract, validates it, and
    only then activates it. A failed or partial download changes nothing: the
    dataset currently being served stays in place.

    This is a bounded extract, not a live feed. "Recent" refers to observation
    dates, not the download time.

    Retrieval happens here, never inside a request handler: opening the site or
    moving a filter downloads nothing.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\refresh_argo.ps1
    powershell -ExecutionPolicy Bypass -File scripts\refresh_argo.ps1 -Days 60
#>
param(
    [int]$Days = 30,
    [double]$West = 60,
    [double]$East = 65,
    [double]$South = 15,
    [double]$North = 20,
    [double]$MaxDepthM = 500,
    [int]$MaxRows = 400000,
    [double]$TimeoutS = 600,
    [int]$Retries = 3
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$env:FLOATCHAT_REFRESH_DAYS = $Days
$env:FLOATCHAT_REFRESH_WEST = $West
$env:FLOATCHAT_REFRESH_EAST = $East
$env:FLOATCHAT_REFRESH_SOUTH = $South
$env:FLOATCHAT_REFRESH_NORTH = $North
$env:FLOATCHAT_REFRESH_MAX_DEPTH_M = $MaxDepthM
$env:FLOATCHAT_REFRESH_MAX_ROWS = $MaxRows
$env:FLOATCHAT_REFRESH_TIMEOUT_S = $TimeoutS
$env:FLOATCHAT_REFRESH_RETRIES = $Retries

# The climatology cache stays cache-only here too: a refresh must never start
# the remote WOA reads that were observed to end the API process.
if ([string]::IsNullOrWhiteSpace($env:FLOATCHAT_WOA_ALLOW_NETWORK)) {
    $env:FLOATCHAT_WOA_ALLOW_NETWORK = '0'
}

$python = Join-Path $repo 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python not found at $python" }

Write-Host "Refreshing Argo data: last $Days UTC days, $West-$East E, $South-$North N" -ForegroundColor Cyan
& $python (Join-Path $repo 'scripts\data_feasibility\refresh_recent.py')
$code = $LASTEXITCODE
if ($code -eq 0) {
    Write-Host 'Refresh complete. Restart the API to serve the new snapshot.' -ForegroundColor Green
} else {
    Write-Warning 'Refresh did not complete. The previous dataset is still being served.'
}
exit $code
