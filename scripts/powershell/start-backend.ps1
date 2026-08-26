$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serverDir = Join-Path $projectRoot 'server'

$ensureMongoScript = Join-Path $serverDir 'scripts\powershell\ensure-mongo-running.ps1'

if (-not (Test-Path $serverDir)) {
    Write-Error "Missing server directory: $serverDir"
    exit 1
}

if (-not (Test-Path $ensureMongoScript)) {
    Write-Error "Missing Mongo ensure script: $ensureMongoScript"
    exit 1
}

$ensureMongoArgs = @('-ExecutionPolicy', 'Bypass', '-File', $ensureMongoScript)
if ($env:MONGO_VERBOSE -eq '1' -or $env:MONGO_VERBOSE -eq 'true') {
    $ensureMongoArgs += '-Verbose'
}

powershell @ensureMongoArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error 'MongoDB Windows service or inventory-rs prerequisite failed. Backend startup was stopped.'
    exit 1
}

Write-Host 'Starting backend dev server...' -ForegroundColor Cyan
Set-Location $serverDir
npm run dev
