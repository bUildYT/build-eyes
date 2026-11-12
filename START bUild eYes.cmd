@echo off
rem bUild eYes: one living table world for headset + phones + PC/tablet cameras.
rem  Headset (Quest browser):  https://192.168.0.11:8897   (accept the certificate once) -> ENTER
rem  Phones (Chrome Android):  same address -> type the 4-letter code -> Be an EYE (phone AR)
rem  This PC (cameras):        opens below -> type the code -> Camera EYEs
cd /d "%~dp0"
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 8897 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -WindowStyle Minimized -FilePath cmd -ArgumentList '/c npx vite' -WorkingDirectory '%~dp0.' }"
timeout /t 4 /nobreak >nul
start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --user-data-dir="%LOCALAPPDATA%\bUild eYes chrome" --no-first-run --no-default-browser-check --start-maximized --ignore-certificate-errors --autoplay-policy=no-user-gesture-required --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows --app=https://localhost:8897/?role=pc
