<#
.SYNOPSIS
    Start the FloatChat API with natural-language drafting configured.

.DESCRIPTION
    Persists only NON-SECRET settings. The API key is never stored here: it is
    inherited from the FLOATCHAT_NL_API_KEY environment variable that you set
    yourself. If that variable is absent the API still starts and manual query
    building works normally; only natural-language drafting is disabled.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\run_api.ps1
    powershell -ExecutionPolicy Bypass -File scripts\run_api.ps1 -Port 8001
#>
param(
    [int]$Port = 8000,
    [string]$BindHost = '127.0.0.1',
    # Structured-output mode. Gemini's OpenAI-compatibility layer does not
    # document `response_format`, and states that unlisted parameters are
    # silently ignored. 'json_object' is the adapter default; switch to
    # 'json_schema' or 'none' if replies come back as prose.
    [ValidateSet('json_object', 'json_schema', 'none')]
    [string]$ResponseFormat = 'json_object'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# --- Non-secret natural-language provider settings -------------------------
$env:FLOATCHAT_NL_PROVIDER      = 'openai_compatible'
$env:FLOATCHAT_NL_BASE_URL      = 'https://generativelanguage.googleapis.com/v1beta/openai/'
$env:FLOATCHAT_NL_MODEL         = 'gemini-3.1-flash-lite'
$env:FLOATCHAT_NL_RESPONSE_FORMAT = $ResponseFormat
$env:FLOATCHAT_NL_TIMEOUT_S     = '30'

# --- Secret: inherited, never written down ---------------------------------
# $env:FLOATCHAT_NL_API_KEY is deliberately NOT set here.
if ([string]::IsNullOrWhiteSpace($env:FLOATCHAT_NL_API_KEY)) {
    Write-Warning @'
FLOATCHAT_NL_API_KEY is not present in this process.
Natural-language drafting will report "not configured"; manual query building
is unaffected. Set it for your user account, then open a NEW terminal:

    setx FLOATCHAT_NL_API_KEY "<your-key>"

(setx writes to the user environment; already-running processes, including
this shell and your editor, keep their old environment until restarted.)
'@
} else {
    Write-Host 'FLOATCHAT_NL_API_KEY: present (inherited)' -ForegroundColor Green
}

Write-Host "provider  : $env:FLOATCHAT_NL_PROVIDER"
Write-Host "base_url  : $env:FLOATCHAT_NL_BASE_URL"
Write-Host "model     : $env:FLOATCHAT_NL_MODEL"
Write-Host "format    : $env:FLOATCHAT_NL_RESPONSE_FORMAT"
Write-Host "Starting API on http://${BindHost}:${Port} ..." -ForegroundColor Cyan

$python = Join-Path $repo 'venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "Python not found at $python" }

Push-Location (Join-Path $repo 'api')
try {
    & $python -m uvicorn main:app --host $BindHost --port $Port
} finally {
    Pop-Location
}
