@echo off
rem Stop JobPilot AI. Your data is kept; start.bat brings it back.
cd /d "%~dp0"
docker compose stop
pause
