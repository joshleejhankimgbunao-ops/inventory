<#
Start-All.ps1

Opens three separate PowerShell windows to run:
 - MongoDB (using scripts/powershell/start-mongo.ps1)
 - Backend (server) with `npm run dev`
 - Frontend (root) with `npm run dev`

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
$mongoScript = Join-Path $projectRoot 'scripts\powershell\start-mongo.ps1'
$backendDir = Join-Path $projectRoot 'server'
$frontendDir = $projectRoot

Write-Host "Project root: $projectRoot"

if (-not $UseAtlas) {
    if (Test-Path $mongoScript) {
        Write-Host "Starting local MongoDB in a new PowerShell window..."
        Start-Process -FilePath pwsh -ArgumentList @('-NoExit','-ExecutionPolicy','Bypass','-File',"$mongoScript")
        Start-Sleep -Seconds 2
    } else {
        Write-Warning "Mongo start script not found at: $mongoScript. If you use Atlas, run with -UseAtlas or provide your own mongod." 
    }
} else {
    Write-Host "Skipping local Mongo startup because -UseAtlas was provided. Ensure MONGO_URI in server/.env points to Atlas."
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
