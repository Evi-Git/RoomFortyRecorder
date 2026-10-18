@echo off
rem Room Forty guild server updater. Double-click to install the latest
rem published release of the server files. See docs\GuildCloudServer.md.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-server.ps1" %*
