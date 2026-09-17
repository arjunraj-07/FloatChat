<#
.SYNOPSIS
    Run the bounded real-model evaluation.

.DESCRIPTION
    Applies the same non-secret provider settings as scripts\run_api.ps1 and
    inherits the API key from the environment, so the evaluation exercises the
    provider the application is configured with. Nothing about that
    configuration is changed here.

    This is the only path that makes real model requests. It is never run by
    the test suite. The request ceiling is enforced inside the harness.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\evaluate_gemini.ps1
    powershell -ExecutionPolicy Bypass -File scripts\evaluate_gemini.ps1 -MaxRequests 6
#>
param(
    [int]$MaxRequests = 12,
    [ValidateSet('json_object', 'json_schema', 'none')]
    [string]$ResponseFormat = 'json_object'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# The same settings the API runs with; the key is inherited, never written.
$env:FLOATCHAT_NL_PROVIDER        = 'openai_compatible'
$env:FLOATCHAT_NL_BASE_URL        = 'https://generativelanguage.googleapis.com/v1beta/openai/'
$env:FLOATCHAT_NL_MODEL           = 'gemini-3.1-flash-lite'
$env:FLOATCHAT_NL_RESPONSE_FORMAT = $ResponseFormat
$env:FLOATCHAT_NL_TIMEOUT_S       = '30'
$env:FLOATCHAT_EVAL_MAX_REQUESTS  = $MaxRequests

# Climatology stays cache-only, as everywhere else.
if ([string]::IsNullOrWhiteSpace($env:FLOATCHAT_WOA_ALLOW_NETWORK)) {
    $env:FLOATCHAT_WOA_ALLOW_NETWORK = '0'
}

if ([string]::IsNullOrWhiteSpace($env:FLOATCHAT_NL_API_KEY)) {
    throw 'FLOATCHAT_NL_API_KEY is not set in this process; nothing would be evaluated.'
}
Write-Host "Evaluating $($env:FLOATCHAT_NL_MODEL), budget $MaxRequests requests" -ForegroundColor Cyan

$python = Join-Path $repo 'venv\Scripts\python.exe'
& $python (Join-Path $repo 'scripts\evaluate_gemini.py')
exit $LASTEXITCODE
