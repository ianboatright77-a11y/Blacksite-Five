@echo off
setlocal
pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Blacksite Five needs Node.js 20 or newer.
  echo Download it from: https://nodejs.org/en/download
  echo.
  pause
  popd
  exit /b 1
)

echo Starting Blacksite Five...
echo Keep this window open for the entire game.
echo.
start "" /min powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:4173'"
set "OPEN_BROWSER=0"
node server.js

echo.
echo The Blacksite Five server has stopped.
echo If you did not close it intentionally, copy any error shown above.
pause

popd
endlocal
