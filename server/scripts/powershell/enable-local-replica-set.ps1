[CmdletBinding()]
param(
    [string]$ServiceName = 'MongoDB',
    [string]$ReplicaSetName = 'inventory-rs',
    [string]$ConfigPath = '',
    [string]$ConfigBackupPath = ''
)

$ErrorActionPreference = 'Stop'

function Get-ServiceMongoConfigPath {
    param([string]$TargetServiceName)

    $service = Get-Service -Name $TargetServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "MongoDB Windows service '$TargetServiceName' was not found. Install MongoDB as a Windows service before configuring the replica set."
    }

    $serviceConfig = (& sc.exe qc $TargetServiceName | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect MongoDB Windows service '$TargetServiceName'. Pass -ConfigPath explicitly after verifying the service installation."
    }

    $match = [regex]::Match($serviceConfig, '--config\s+(?:"(?<quoted>[^"]+)"|(?<bare>\S+))')
    if (-not $match.Success) {
        throw "MongoDB Windows service '$TargetServiceName' does not expose a --config path. Pass -ConfigPath explicitly; no configuration was changed."
    }

    $resolvedConfigPath = $match.Groups['quoted'].Value
    if ([string]::IsNullOrWhiteSpace($resolvedConfigPath)) {
        $resolvedConfigPath = $match.Groups['bare'].Value
    }

    if ([string]::IsNullOrWhiteSpace($resolvedConfigPath)) {
        throw "MongoDB Windows service '$TargetServiceName' does not expose a usable --config path. Pass -ConfigPath explicitly; no configuration was changed."
    }

    return $resolvedConfigPath
}

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this replica-set setup script in an Administrator PowerShell window. No configuration was changed.'
}

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Get-ServiceMongoConfigPath -TargetServiceName $ServiceName
}

if (-not (Test-Path $ConfigPath)) {
    throw "MongoDB configuration file not found: $ConfigPath"
}

if ([string]::IsNullOrWhiteSpace($ConfigBackupPath)) {
    $ConfigBackupPath = "$ConfigPath.pre-replset-backup"
}

$originalConfig = Get-Content -Raw -LiteralPath $ConfigPath
if ($originalConfig -match "(?m)^\s*replSetName:\s*$([regex]::Escape($ReplicaSetName))\s*$") {
    Write-Host "MongoDB is already configured for replica set $ReplicaSetName." -ForegroundColor Green
    exit 0
}

if ($originalConfig -match '(?m)^\s*replSetName:\s*(?<configuredName>\S+)\s*$') {
    throw "MongoDB is already configured for replica set $($Matches.configuredName), not $ReplicaSetName. No configuration was changed."
}

$updatedConfig = $originalConfig -replace '(?m)^#replication:\s*\r?\n', "replication:`r`n  replSetName: $ReplicaSetName`r`n"
if ($updatedConfig -eq $originalConfig) {
    $updatedConfig = "$originalConfig`r`nreplication:`r`n  replSetName: $ReplicaSetName`r`n"
}

Copy-Item -LiteralPath $ConfigPath -Destination $ConfigBackupPath -Force
$serviceWasStopped = $false

function Get-MongoshPath {
    $command = Get-Command mongosh -ErrorAction SilentlyContinue
    if ($command) {
        $commandPath = if ($command.Source) { $command.Source } else { $command.Path }
        if ($commandPath -and (Test-Path $commandPath)) {
            return $commandPath
        }
    }

    foreach ($candidate in @(
        'C:\Program Files\MongoDB\mongosh\current\bin\mongosh.exe',
        'C:\Program Files\MongoDB\Server\8.3\bin\mongosh.exe'
    )) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw 'mongosh.exe was not found. The service configuration was rolled back to avoid leaving an uninitialized replica set.'
}

function Initialize-ReplicaSet {
    $mongoShell = Get-MongoshPath
    $initScript = @'
const admin = db.getSiblingDB('admin');
try {
  const status = admin.runCommand({ replSetGetStatus: 1 });
  if (status.ok !== 1) throw new Error('Replica set status is not healthy.');
} catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
  const result = rs.initiate({ _id: 'inventory-rs', members: [{ _id: 0, host: '127.0.0.1:27017' }] });
  if (result.ok !== 1) throw new Error('Replica set initialization failed.');
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  const readiness = db.getSiblingDB('admin').runCommand({ hello: 1 });
  if (readiness.isWritablePrimary) {
    print('Replica set is initialized and primary: ' + readiness.setName);
    quit(0);
  }
  sleep(1000);
}
throw new Error('Replica set did not become primary.');
'@

    & $mongoShell --quiet --host 127.0.0.1 --port 27017 --eval $initScript
    if ($LASTEXITCODE -ne 0) {
        throw 'MongoDB replica set initialization failed.'
    }
}

try {
    Stop-Service -Name $ServiceName -Force
    $serviceWasStopped = $true
    Set-Content -LiteralPath $ConfigPath -Value $updatedConfig -Encoding UTF8 -NoNewline
    Start-Service -Name $ServiceName

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        if (Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue) {
            Initialize-ReplicaSet
            Write-Host "MongoDB restarted with replica set $ReplicaSetName configured and initialized." -ForegroundColor Green
            exit 0
        }
    }

    throw 'MongoDB did not reopen port 27017 after the replica-set configuration change.'
} catch {
    Copy-Item -LiteralPath $ConfigBackupPath -Destination $ConfigPath -Force
    if ($serviceWasStopped) {
        Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    }
    throw
}
