param(
    [string]$PrinterName = ''
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot)

if (-not (Test-Path (Join-Path $serviceRoot 'package.json'))) {
    Write-Error "Missing printer service root: $serviceRoot"
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm was not found on PATH. Install Node.js first.'
    exit 1
}

function Resolve-PrinterName {
    param(
        [string]$ExplicitName
    )

    $name = ([string]$ExplicitName).Trim()
    if ($name) {
        return $name
    }

    try {
        $printers = @(Get-CimInstance Win32_Printer | Sort-Object Name)
    } catch {
        # This API can be blocked by local WMI permissions. The .NET print API is
        # also the API used by the service, so it is the reliable fallback here.
        $printers = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object {
            [pscustomobject]@{ Name = [string]$_; Default = $false }
        })
    }

    $patterns = @('XP-58H', 'XP-58', 'XPrinter', 'Thermal', 'Receipt')
    foreach ($pattern in $patterns) {
        $match = $printers | Where-Object { $_.Name -match $pattern } | Select-Object -First 1
        if ($match) {
            return [string]$match.Name
        }
    }

    $defaultPrinter = $printers | Where-Object { $_.Default -eq $true } | Select-Object -First 1
    if ($defaultPrinter) {
        return [string]$defaultPrinter.Name
    }

    return ''
}

Set-Location $serviceRoot

$detectedPrinter = Resolve-PrinterName -ExplicitName $PrinterName
if ($detectedPrinter) {
    $env:THERMAL_PRINTER_NAME = $detectedPrinter
    Write-Host "Using printer queue: $detectedPrinter" -ForegroundColor Green
} else {
    Write-Host 'No matching printer queue was detected. The service will use the default queue configured in Windows.' -ForegroundColor Yellow
}

if (-not $env:THERMAL_PRINTER_TYPE) {
    $env:THERMAL_PRINTER_TYPE = 'EPSON'
}

if (-not $env:THERMAL_PRINTER_WIDTH_CHARS) {
    $env:THERMAL_PRINTER_WIDTH_CHARS = '30'
}

Write-Host 'Starting receipt printer service...' -ForegroundColor Cyan
# Use the Windows command shim so PowerShell execution-policy settings cannot
# prevent npm.ps1 from launching the service.
npm.cmd start
