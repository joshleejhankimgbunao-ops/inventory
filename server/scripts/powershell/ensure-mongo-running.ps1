[CmdletBinding()]
param(
    [string]$ServiceName = 'MongoDB',
    [string]$ReplicaSetName = 'inventory-rs'
)

$ErrorActionPreference = 'Stop'

function Test-MongoReady {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connectTask = $client.ConnectAsync('127.0.0.1', 27017)
        if (-not $connectTask.Wait(1000)) {
            return $false
        }

        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-MongoReady {
    param([int]$MaxTries = 30)

    for ($attempt = 1; $attempt -le $MaxTries; $attempt++) {
        if (Test-MongoReady) {
            return $true
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

function Get-MongoshPath {
    $fromPath = Get-Command mongosh -ErrorAction SilentlyContinue
    if ($fromPath) {
        $resolvedPath = if ($fromPath.Source) { $fromPath.Source } else { $fromPath.Path }
        if ($resolvedPath -and (Test-Path $resolvedPath)) {
            return $resolvedPath
        }
    }

    throw 'mongosh.exe was not found. Install MongoDB Shell, then run the explicit replica-set setup step before starting the application.'
}

function Assert-ExpectedReplicaSet {
    param([string]$ExpectedReplicaSetName)

    $mongoShell = Get-MongoshPath
    $verificationScript = @"
const admin = db.getSiblingDB('admin');
const hello = admin.runCommand({ hello: 1 });
if (hello.ok !== 1) throw new Error('MongoDB hello check failed.');
if (hello.setName !== '$ExpectedReplicaSetName') {
  throw new Error('Expected replica set $ExpectedReplicaSetName, found ' + (hello.setName || 'standalone') + '.');
}
if (!hello.isWritablePrimary) {
  throw new Error('Replica set $ExpectedReplicaSetName is not PRIMARY.');
}
const status = admin.runCommand({ replSetGetStatus: 1 });
if (status.ok !== 1) throw new Error('Replica set status is not healthy.');
print('MongoDB replica set is ready: ' + hello.setName + ' (PRIMARY)');
"@

    & $mongoShell --quiet --host 127.0.0.1 --port 27017 --eval $verificationScript
    if ($LASTEXITCODE -ne 0) {
        throw "MongoDB must be configured as replica set '$ExpectedReplicaSetName' and be PRIMARY. Run server\\scripts\\powershell\\enable-local-replica-set.ps1 in an Administrator PowerShell window, then start the application again."
    }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    throw "MongoDB Windows service '$ServiceName' was not found. Install and configure MongoDB for this project, then run server\\scripts\\powershell\\enable-local-replica-set.ps1 in an Administrator PowerShell window. No fallback database was started."
}

if ($service.Status -ne 'Running') {
    try {
        Start-Service -Name $ServiceName -ErrorAction Stop
    } catch {
        throw "MongoDB Windows service '$ServiceName' could not be started. Fix the configured service/data path, then try again. No fallback database was started. Details: $($_.Exception.Message)"
    }
}

if (-not (Wait-MongoReady -MaxTries 30)) {
    throw "MongoDB Windows service '$ServiceName' did not open 127.0.0.1:27017. Check its configured service/data path and logs, then try again. No fallback database was started."
}

Assert-ExpectedReplicaSet -ExpectedReplicaSetName $ReplicaSetName
Write-Verbose "MongoDB Windows service '$ServiceName' is ready on 127.0.0.1:27017 as replica set '$ReplicaSetName'."
