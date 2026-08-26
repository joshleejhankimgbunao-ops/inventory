<#
Start-All.ps1

Opens backend and frontend PowerShell windows. The backend first verifies the
configured MongoDB Windows service and `inventory-rs` replica set through `mongo:ensure`.

Usage:
  From project root:
    pwsh -ExecutionPolicy Bypass -File .\scripts\start-all.ps1

If you prefer Atlas (remote DB), run without starting local Mongo: add the -UseAtlas switch:
    pwsh -ExecutionPolicy Bypass -File .\scripts\start-all.ps1 -UseAtlas
#>

param(
    [switch]$UseAtlas
)

# Resolve root and paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..'))
$projectRoot = $projectRoot.ProviderPath
$backendDir = Join-Path $projectRoot 'server'
$printerServiceDir = Join-Path $projectRoot 'printer-service'
$printerServiceLauncher = Join-Path $printerServiceDir 'Start_Printer_Service.bat'
$frontendDir = $projectRoot

Write-Host "Project root: $projectRoot"

if (-not $UseAtlas) {
    Write-Host "The backend will verify the configured MongoDB Windows service and inventory-rs replica set."
} else {
    Write-Host "Skipping local Mongo startup because -UseAtlas was provided. Ensure MONGO_URI in server/.env points to Atlas."
}

if (Test-Path $printerServiceLauncher) {
    Write-Host "Starting receipt printer service in a new PowerShell window..."
    Start-Process -FilePath $printerServiceLauncher -WorkingDirectory $printerServiceDir
    Start-Sleep -Seconds 1
} else {
    Write-Warning "Printer service launcher not found at: $printerServiceLauncher. Receipt printing will fail until the local printer service is started."
}

# Start backend in a new PowerShell window
if (Test-Path $backendDir) {
    Write-Host "Starting backend (server) in a new PowerShell window..."
    $backendCmd = "Set-Location -LiteralPath '$backendDir'; npm run dev"
    Start-Process -FilePath pwsh -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command',$backendCmd)
    Start-Sleep -Seconds 1
} else {
    Write-Warning "Backend directory not found: $backendDir"
}

# Start frontend in a new PowerShell window
Write-Host "Starting frontend (Vite) in a new PowerShell window..."
$frontendCmd = "Set-Location -LiteralPath '$frontendDir'; npm run dev"
Start-Process -FilePath pwsh -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-Command',$frontendCmd)

Write-Host "All start commands issued. Check the new PowerShell windows for logs."
Write-Host "Frontend: http://localhost:5173/  |  Backend health: http://127.0.0.1:5000/api/health"
