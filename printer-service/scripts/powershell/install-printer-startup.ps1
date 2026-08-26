param(
    [switch]$Uninstall,
    [string]$PrinterName = ''
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot)
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'Receipt Printer Service.lnk'
$launcherPath = Join-Path $serviceRoot 'Start_Printer_Service.bat'

if ($Uninstall) {
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Host "Removed startup shortcut: $shortcutPath" -ForegroundColor Green
    } else {
        Write-Host 'No startup shortcut was found.' -ForegroundColor Yellow
    }

    exit 0
}

if (-not (Test-Path $launcherPath)) {
    Write-Error "Missing launcher file: $launcherPath"
    exit 1
}

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $serviceRoot
$shortcut.WindowStyle = 1
$shortcut.Description = 'Start the receipt printer service on Windows login.'

$arguments = @()
if ($PrinterName) {
    $arguments += "`"$PrinterName`""
}

$shortcut.Arguments = $arguments -join ' '
$shortcut.Save()

Write-Host "Created startup shortcut: $shortcutPath" -ForegroundColor Green
Write-Host 'The printer service will now launch automatically when this Windows account signs in.' -ForegroundColor Cyan
