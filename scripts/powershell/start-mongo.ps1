$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ensureScript = Join-Path $projectRoot 'server\scripts\powershell\ensure-mongo-running.ps1'

if (-not (Test-Path $ensureScript)) {
    throw "MongoDB ensure script not found: $ensureScript"
}

Write-Host 'Verifying the configured MongoDB Windows service and inventory-rs replica set...' -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $ensureScript
if ($LASTEXITCODE -ne 0) {
    throw 'MongoDB Windows service or inventory-rs prerequisite failed. The application was not started; follow the setup guidance above.'
}
