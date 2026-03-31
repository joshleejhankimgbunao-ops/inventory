$ErrorActionPreference = 'Stop'

$mongodPath = if ($env:MONGOD_PATH) { $env:MONGOD_PATH } else { 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe' }
$dbPath = Join-Path $env:TEMP 'inventory-mongo-data'

try {
    $existing = Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($existing) {
        Write-Host 'MongoDB is already running on 127.0.0.1:27017' -ForegroundColor Green
        exit 0
    }
} catch {
    # no listener found, continue
}

if (-not (Test-Path $mongodPath)) {
    Write-Error "mongod.exe not found at: $mongodPath"
    exit 1
}

New-Item -ItemType Directory -Path $dbPath -Force | Out-Null

Write-Host "Starting MongoDB..." -ForegroundColor Cyan
Write-Host "Binary: $mongodPath"
Write-Host "DB Path: $dbPath"
Write-Host "Host: 127.0.0.1"
Write-Host "Port: 27017"
Write-Host ''
Write-Host 'Keep this terminal open while backend is running.' -ForegroundColor Yellow
Write-Host ''

& $mongodPath --dbpath $dbPath --bind_ip 127.0.0.1 --port 27017
