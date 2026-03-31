$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error 'Run this script in an Administrator PowerShell window.'
    exit 1
}

$downloadUrl = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.17-signed.msi'
$tempMsi = Join-Path $env:TEMP 'mongodb-7.0.17-signed.msi'

Write-Host 'Downloading MongoDB 7.0 installer...' -ForegroundColor Cyan
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempMsi

Write-Host 'Installing MongoDB 7.0 service...' -ForegroundColor Cyan
$msiArgs = @(
    '/i',
    "`"$tempMsi`"",
    'ADDLOCAL="ServerService"',
    'SHOULD_INSTALL_COMPASS="0"',
    '/qn',
    '/norestart'
)

$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
if ($process.ExitCode -ne 0) {
    Write-Error "MongoDB installation failed. Exit code: $($process.ExitCode)"
    exit 1
}

Write-Host 'Setting MongoDB service startup to Automatic...' -ForegroundColor Cyan
Set-Service MongoDB -StartupType Automatic
Start-Service MongoDB

Write-Host 'MongoDB 7 installation complete and service started.' -ForegroundColor Green
Write-Host 'Verify with: Get-Service MongoDB'
