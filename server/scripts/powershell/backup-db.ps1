param(
    [string]$DbName = 'inventory-dev',
    [string]$MongoUri = 'mongodb://127.0.0.1:27017',
    [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-MongoDumpPath {
    if ($env:MONGODUMP_PATH -and (Test-Path $env:MONGODUMP_PATH)) {
        return $env:MONGODUMP_PATH
    }

    $fromPath = Get-Command mongodump -ErrorAction SilentlyContinue
    if ($fromPath -and $fromPath.Source) {
        return $fromPath.Source
    }

    $workspaceParent = Resolve-Path (Join-Path $serverDir '..\..')
    $workspaceParent = $workspaceParent.ProviderPath

    $commonCandidates = @(
        (Join-Path $workspaceParent 'mongodb-database-tools-windows-x86_64-100.15.0\bin\mongodump.exe'),
        (Join-Path $workspaceParent 'mongodb-database-tools-windows-x86_64-100.15.0\mongodb-database-tools-windows-x86_64-100.15.0\bin\mongodump.exe'),
        'C:\Program Files\MongoDB\Tools\100\bin\mongodump.exe',
        'C:\Program Files\MongoDB\Server\8.0\bin\mongodump.exe',
        'C:\Program Files\MongoDB\Server\7.0\bin\mongodump.exe'
    )

    foreach ($candidate in $commonCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "mongodump not found. Install MongoDB Database Tools or set MONGODUMP_PATH env var."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$serverDir = Resolve-Path (Join-Path $scriptDir '..\..')
$serverDir = $serverDir.ProviderPath

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $serverDir 'backups'
}

if (-not (Test-Path $OutputRoot)) {
    New-Item -Path $OutputRoot -ItemType Directory -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $OutputRoot "$timestamp-$DbName"
New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
$dumpDir = Join-Path $backupDir 'dump'
New-Item -Path $dumpDir -ItemType Directory -Force | Out-Null

$mongoDumpCommand = Resolve-MongoDumpPath

Write-Host "Creating MongoDB backup..." -ForegroundColor Cyan
Write-Host "Database: $DbName"
Write-Host "Mongo URI: $MongoUri"
Write-Host "Output: $backupDir"
Write-Host "Dump path: $dumpDir"
Write-Host "mongodump: $mongoDumpCommand"

& $mongoDumpCommand --uri "$MongoUri/$DbName" --out "$dumpDir"
if ($LASTEXITCODE -ne 0) {
    throw "mongodump failed with exit code $LASTEXITCODE"
}

$meta = @{
    timestamp = (Get-Date).ToString('o')
    dbName = $DbName
    mongoUri = $MongoUri
    backupDir = $backupDir
} | ConvertTo-Json -Depth 5

$metaPath = Join-Path $backupDir 'backup-meta.json'
Set-Content -Path $metaPath -Value $meta -Encoding UTF8

Write-Host "Backup completed successfully." -ForegroundColor Green
Write-Host "Saved at: $backupDir"
