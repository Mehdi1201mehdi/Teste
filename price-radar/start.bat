@echo off
REM Demarrage en une commande sous Windows : start.bat
cd /d "%~dp0"

if not exist ".venv" (
  echo Creation de l'environnement virtuel...
  python -m venv .venv
)
call .venv\Scripts\activate.bat

echo Installation des dependances...
pip install -q --upgrade pip
pip install -q -r requirements.txt

if not exist ".env" (
  echo Creation du fichier .env...
  copy .env.example .env
)

if not exist "price_radar.db" (
  echo Generation des donnees de test...
  python seed.py
)

echo.
echo ======================================================
echo   Price Radar demarre sur http://localhost:8000
echo   API interactive : http://localhost:8000/docs
echo   (Ctrl+C pour arreter)
echo ======================================================
echo.
python run.py
