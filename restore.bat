@echo off
rem Load your account and data from data-sync\latest into JobPilot on this Windows computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-windows.ps1"
