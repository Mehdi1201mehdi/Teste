@echo off
REM Demarrage en une commande sous Windows : start.bat
cd /d "%~dp0"

if not exist ".venv" (
  echo Creation de l'environnement virtuel...
  python -m venv .venv
)

REM On utilise directement le python du venv (evite les soucis d'activation)
set "VENV_PY=.venv\Scripts\python.exe"

echo Installation des dependances...
"%VENV_PY%" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo.
  echo ERREUR: l'installation des dependances a echoue. Verifiez votre connexion.
  pause
  exit /b 1
)

if not exist ".env" (
  echo Creation du fichier .env...
  copy .env.example .env
)

if not exist "price_radar.db" (
  echo Generation des donnees de test...
  "%VENV_PY%" seed.py
)

echo.
echo ======================================================
echo   Price Radar demarre sur http://localhost:8000
echo   API interactive : http://localhost:8000/docs
echo   (Ctrl+C pour arreter)
echo ======================================================
echo.
python run.py
