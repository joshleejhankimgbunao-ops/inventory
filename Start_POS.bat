@echo off
echo Starting POS System with Direct Printing (Silent Mode)...
echo.
echo IMPORTANT: Make sure your Thermal Printer is set as the "Default Printer" in Windows Settings.
echo.

REM Check for Edge (Most common on Windows)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    echo Opening in Microsoft Edge...
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing http://localhost:5173/point-of-sale
    goto END
)

REM Check for Chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo Opening in Google Chrome...
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing http://localhost:5173/point-of-sale
    goto END
)

echo Error: Could not find Edge or Chrome standard installations.
echo Please create a shortcut manually with --kiosk-printing flag.
pause

:END
exit