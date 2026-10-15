@echo off
rem Lance MobileLab (Windows). Cree l'environnement virtuel au premier lancement.
rem Usage : scripts\run.bat [--simulation]
setlocal
cd /d "%~dp0\.."
if not exist .venv (
  echo Creation de l'environnement virtuel...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -e . >nul
)
.venv\Scripts\python -m mobilelab %*
