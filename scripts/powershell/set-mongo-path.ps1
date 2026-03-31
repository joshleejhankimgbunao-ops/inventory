param(
    [string]$Version = '7.0'
)

$ErrorActionPreference = 'Stop'

$candidate = "C:\Program Files\MongoDB\Server\$Version\bin\mongod.exe"

if (-not (Test-Path $candidate)) {
    Write-Error "mongod.exe not found for version $Version at: $candidate"
    Write-Host 'Install that MongoDB version first, or pass another version:' -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\powershell\set-mongo-path.ps1 -Version 8.2'
    exit 1
}

$env:MONGOD_PATH = $candidate
Write-Host "MONGOD_PATH set for current terminal:" -ForegroundColor Green
Write-Host "  $env:MONGOD_PATH"
Write-Host ''
Write-Host 'Run in this same terminal:' -ForegroundColor Cyan
Write-Host '  npm run dev:server'
Write-Host ''
Write-Host 'If you run this via npm script, the env var will not persist to your other terminal sessions.' -ForegroundColor Yellow
