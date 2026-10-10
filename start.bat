@echo off
setlocal
title OFFGRID
cd /d "%~dp0"
set PORT=8000
set MODEL=qwen2.5:3b
if not "%BB_MODEL%"=="" set MODEL=%BB_MODEL%

echo === OFFGRID ===

if not exist ".venv\Scripts\python.exe" (
  echo [X] Python environment not found. Run:
  echo     python -m venv .venv
  echo     .venv\Scripts\python -m pip install -r requirements.txt
  goto :fail
)

where ollama >nul 2>nul
if errorlevel 1 (
  echo [X] Ollama is not installed or not on PATH.
  goto :fail
)

curl -s -o nul http://127.0.0.1:11434/api/tags
if errorlevel 1 (
  echo [..] Starting Ollama...
  start "Ollama" /min ollama serve
  for /l %%i in (1,1,20) do (
    ping -n 2 127.0.0.1 >nul
    curl -s -o nul http://127.0.0.1:11434/api/tags && goto :ollama_ok
  )
  echo [X] Ollama did not start.
  goto :fail
)
:ollama_ok
echo [OK] Ollama is running.

ollama list | findstr /b /c:"%MODEL%" >nul
if errorlevel 1 (
  echo [X] Model %MODEL% is not installed. While online, run:  ollama pull %MODEL%
  goto :fail
)
echo [OK] Model %MODEL% is installed.

curl -s -o nul http://127.0.0.1:%PORT%/api/health
if not errorlevel 1 (
  echo [OK] Server already running.
  goto :open
)

echo [..] Starting server on http://127.0.0.1:%PORT% ...
rem cmd /k keeps the window open if the server crashes, so the error stays visible.
start "OFFGRID server" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port %PORT%"
for /l %%i in (1,1,30) do (
  ping -n 2 127.0.0.1 >nul
  curl -s -o nul http://127.0.0.1:%PORT%/api/health && goto :open
)
echo [X] Server did not start. Check the "OFFGRID server" window for errors.
goto :fail

:open
echo [OK] Opening the app. Close the "OFFGRID server" window to stop it.
start "" http://127.0.0.1:%PORT%
ping -n 4 127.0.0.1 >nul
exit /b 0

:fail
echo.
pause
exit /b 1
