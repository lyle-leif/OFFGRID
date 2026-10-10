@echo off
setlocal
title OFFGRID hub
cd /d "%~dp0"
set MODEL=qwen2.5:3b
if not "%BB_MODEL%"=="" set MODEL=%BB_MODEL%

echo === OFFGRID hub: phones connect over this laptop's Wi-Fi ===

if not exist ".venv\Scripts\python.exe" (
  echo [X] Python environment not found. Run:
  echo     python -m venv .venv
  echo     .venv\Scripts\python -m pip install -r requirements.txt
  goto :fail
)

rem The AI is optional for phones (they work without it), so a missing Ollama is only a warning.
curl -s -o nul http://127.0.0.1:11434/api/tags
if errorlevel 1 (
  where ollama >nul 2>nul && (start "Ollama" /min ollama serve) || echo [!] Ollama not running: answers will show guide text without AI summaries.
)

echo [..] Certificates for secure phone connections...
.venv\Scripts\python.exe tools\make_certs.py --quiet
if errorlevel 1 goto :fail

if not exist "app\static\pack\version.json" (
  echo [..] Building the phone data pack...
  .venv\Scripts\python.exe tools\build_phone_pack.py
  if errorlevel 1 goto :fail
)

rem Phones: secure app on 8443. Setup page (and this laptop's own app) on 8080.
rem Windows may ask to allow Python on the network: allow it for Private networks.
start "OFFGRID hub - phones (https 8443)" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs\hub.key --ssl-certfile certs\hub.crt"
start "OFFGRID hub - setup page (8080)" cmd /k "set BB_LAN_SETUP=1&& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8080"

for /l %%i in (1,1,40) do (
  ping -n 2 127.0.0.1 >nul
  curl -s -o nul http://127.0.0.1:8080/api/health && goto :ready
)
echo [X] The hub did not start. Check the two "OFFGRID hub" windows for errors.
goto :fail

:ready
echo.
echo [OK] Hub running. On each phone, join this laptop's Wi-Fi or hotspot and open:
.venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'tools'); from make_certs import local_ips; [print('       http://%%s:8080/setup' %% ip) for ip in local_ips() if not ip.startswith('127.')]"
echo.
echo      Certificate code the phone must show (compare the first 16 characters):
.venv\Scripts\python.exe -c "import sys; sys.path.insert(0, '.'); from app.routes.setup import ca_fingerprint; f = ca_fingerprint().replace(':', ''); print('       ' + ' '.join(f[i:i+4] for i in range(0, 16, 4)))"
echo.
echo      Close the two "OFFGRID hub" windows to stop the hub.
start "" http://127.0.0.1:8080/
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
