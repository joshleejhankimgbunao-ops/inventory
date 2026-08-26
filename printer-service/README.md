# Receipt Printer Service

This is the local Windows companion service that receives receipt payloads from the web app and sends them to the USB thermal printer through the installed Windows printer queue.

## Why this is needed

The web app is deployed separately on Vercel and Render. Those hosted environments cannot talk directly to a USB printer attached to the cashier's Windows PC. This service runs locally on that PC and bridges the browser to the printer.

## Quick Setup

Run these commands once on the cashier PC:

```powershell
cd <project-folder>\printer-service
npm install
```

If you want to override the detected printer queue manually, set the environment variables in the current PowerShell session before starting:

```powershell
$env:THERMAL_PRINTER_NAME = 'XP-58H'
$env:THERMAL_PRINTER_TYPE = 'EPSON'
$env:THERMAL_PRINTER_WIDTH_CHARS = '30'
```

## Start the service

### One-click launcher

Double-click [Start_Printer_Service.bat](Start_Printer_Service.bat) to launch the service.

### Auto-start on Windows login

Run this once to create a Startup shortcut:

```powershell
cd <project-folder>\printer-service
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\install-printer-startup.ps1
```

To remove it later:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\install-printer-startup.ps1 -Uninstall
```

### PowerShell

```powershell
cd <project-folder>\printer-service
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-printer-service.ps1
```

## Web app setting

Set `VITE_RECEIPT_PRINTER_URL` in the web app to `http://127.0.0.1:8787` if you want to override the default.

## Environment variables

- `PORT` - service port, defaults to `8787`.
- `THERMAL_PRINTER_NAME` - Windows printer queue name.
- `THERMAL_PRINTER_TYPE` - printer type, defaults to `EPSON`.
- `THERMAL_PRINTER_WIDTH_CHARS` - characters per line, defaults to `30` for closer but dynamically centered content inside the XP-58H 48mm printable area (accepted range: `24` to `30`).

The launcher auto-detects the XP-58H queue from the installed Windows printers. If the detection result is wrong, pass `-PrinterName "Exact Queue Name"` to the PowerShell script.

## Endpoints

- `GET /health` - health check; reports the selected Windows queue.
- `POST /print` - prints a receipt payload.

## Verify the service

After starting it, confirm that the queue is `XP-58H`:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

To send a direct test without creating a POS sale:

```powershell
@{ lines = @('DIRECT PRINTER TEST', 'Target queue: XP-58H', '', '') } |
  ConvertTo-Json |
  Invoke-RestMethod http://127.0.0.1:8787/print -Method Post -ContentType 'application/json'
```
