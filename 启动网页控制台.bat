@echo off
setlocal

cd /d "%~dp0"

echo.
echo ========================================
echo  Qianwen Audio Transcription Console
echo ========================================
echo.
echo Project folder:
echo %cd%
echo.

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Please unzip the GitHub ZIP file first, then run this launcher from the extracted project folder.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install the Node.js LTS version first:
  echo https://nodejs.org/
  echo.
  echo After installing Node.js, close this window and run this launcher again.
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found.
  echo Please reinstall the Node.js LTS version:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\playwright-core" (
  echo First run: installing dependencies. This may take a few minutes.
  echo Running: npm.cmd install
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    echo Please check your network connection, or send the error text above to the maintainer.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting the local web console...
echo If the browser does not open automatically, visit:
echo http://127.0.0.1:4317/
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-web-ui.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] The web console failed to start.
  echo Please check these files in the logs folder:
  echo - web-ui-launcher.log
  echo - web-ui.out.log
  echo - web-ui.err.log
  echo.
  pause
  exit /b 1
)

echo.
echo Started successfully.
echo Browser URL:
echo http://127.0.0.1:4317/
echo.
echo You can close this window. The web service will keep running in the background.
echo.
pause
