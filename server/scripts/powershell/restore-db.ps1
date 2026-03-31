param(
    [string]$DbName = 'inventory-dev',
    [string]$MongoUri = 'mongodb://127.0.0.1:27017',
    [string]$BackupPath = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-MongoRestorePath {
    if ($env:MONGORESTORE_PATH -and (Test-Path $env:MONGORESTORE_PATH)) {
        return $env:MONGORESTORE_PATH
    }

    $fromPath = Get-Command mongorestore -ErrorAction SilentlyContinue
    if ($fromPath -and $fromPath.Source) {
        return $fromPath.Source
    }

    $workspaceParent = Resolve-Path (Join-Path $serverDir '..\..')
    $workspaceParent = $workspaceParent.ProviderPath

    $commonCandidates = @(
        (Join-Path $workspaceParent 'mongodb-database-tools-windows-x86_64-100.15.0\bin\mongorestore.exe'),
        (Join-Path $workspaceParent 'mongodb-database-tools-windows-x86_64-100.15.0\mongodb-database-tools-windows-x86_64-100.15.0\bin\mongorestore.exe'),
        'C:\Program Files\MongoDB\Tools\100\bin\mongorestore.exe',
        'C:\Program Files\MongoDB\Server\8.0\bin\mongorestore.exe',
        'C:\Program Files\MongoDB\Server\7.0\bin\mongorestore.exe'
    )

    foreach ($candidate in $commonCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "mongorestore not found. Install MongoDB Database Tools or set MONGORESTORE_PATH env var."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$serverDir = Resolve-Path (Join-Path $scriptDir '..\..')
$serverDir = $serverDir.ProviderPath
$backupRoot = Join-Path $serverDir 'backups'

if ([string]::IsNullOrWhiteSpace($BackupPath)) {
    if (-not (Test-Path $backupRoot)) {
        throw "No backups directory found at: $backupRoot"
    }

    $latest = Get-ChildItem -Path $backupRoot -Directory |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latest) {
        throw "No backup folders found in: $backupRoot"
    }

    $BackupPath = $latest.FullName
}

if (-not (Test-Path $BackupPath)) {
    throw "Backup path not found: $BackupPath"
}

$dumpRoot = Join-Path $BackupPath 'dump'
if (-not (Test-Path $dumpRoot)) {
    # Legacy backup layout fallback: use root backup path as dump root
    $dumpRoot = $BackupPath
}

$mongoRestoreCommand = Resolve-MongoRestorePath

Write-Host "Restoring MongoDB backup..." -ForegroundColor Yellow
Write-Host "Database: $DbName"
Write-Host "Mongo URI: $MongoUri"
Write-Host "Backup path: $BackupPath"
Write-Host "mongorestore: $mongoRestoreCommand"

& $mongoRestoreCommand --uri "$MongoUri" --nsInclude "$DbName.*" --drop "$dumpRoot"
if ($LASTEXITCODE -ne 0) {
    throw "mongorestore failed with exit code $LASTEXITCODE"
}

Write-Host "Restore completed successfully." -ForegroundColor Green
