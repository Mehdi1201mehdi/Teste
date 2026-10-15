@echo off
rem MobileLab - installation en un double-clic (aucun droit administrateur requis).
title Installation de MobileLab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
