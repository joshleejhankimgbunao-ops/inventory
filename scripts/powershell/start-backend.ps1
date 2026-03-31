$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serverDir = Join-Path $projectRoot 'server'
$mongodPath = if ($env:MONGOD_PATH) { $env:MONGOD_PATH } else { 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe' }
$dbPath = Join-Path $env:TEMP 'inventory-mongo-data'
$logPath = Join-Path $dbPath 'mongod.log'

if (-not (Test-Path $mongodPath)) {
    Write-Error "mongod.exe not found at: $mongodPath"
    exit 1
}

if (-not (Test-Path $serverDir)) {
    Write-Error "Missing server directory: $serverDir"
    exit 1
}

New-Item -ItemType Directory -Path $dbPath -Force | Out-Null

$mongoReady = $false

try {
    $listener = Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($listener) {
        $mongoReady = $true
        Write-Host 'MongoDB already running on 127.0.0.1:27017' -ForegroundColor Green
    }
} catch {
    $mongoReady = $false
}

if (-not $mongoReady) {
    Write-Host 'MongoDB not running. Starting mongod in background...' -ForegroundColor Yellow

    $args = @(
        '--dbpath', $dbPath,
        '--bind_ip', '127.0.0.1',
        '--port', '27017',
        '--logpath', $logPath,
        '--logappend'
    )

    Start-Process -FilePath $mongodPath -ArgumentList $args -WindowStyle Hidden | Out-Null

    $maxTries = 30
    for ($i = 1; $i -le $maxTries; $i++) {
        Start-Sleep -Seconds 1
        try {
            $listener = Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction Stop | Select-Object -First 1
            if ($listener) {
                $mongoReady = $true
                break
            }
        } catch {
            $mongoReady = $false
        }
    }
}

if (-not $mongoReady) {
    Write-Error "MongoDB did not become ready on port 27017. Check log: $logPath"
    exit 1
}

Write-Host 'Starting backend dev server...' -ForegroundColor Cyan
Set-Location $serverDir
npm run dev
