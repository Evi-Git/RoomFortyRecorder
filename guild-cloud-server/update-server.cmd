@echo off
rem Room Forty guild server updater. Double-click to install the latest
rem published release of the server files. See docs\GuildCloudServer.md.

rem Ask for administrator rights first, so everything runs in this one window.
net session 1>NUL 2>NUL
if errorlevel 1 (
  echo Asking for administrator rights...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-server.ps1" %*
if errorlevel 1 (
  echo.
  echo The updater stopped with an error. Details are in update-server.log.
  pause
)
