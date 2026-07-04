#!/usr/bin/env bash
# Démarrage en une commande : ./start.sh
# Crée l'environnement, installe les dépendances, initialise les données de
# test au premier lancement, puis démarre le serveur.
set -e
cd "$(dirname "$0")"

PY=${PYTHON:-python3}

if [ ! -d ".venv" ]; then
  echo "→ Création de l'environnement virtuel…"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "→ Installation des dépendances…"
pip install -q --upgrade pip
pip install -q -r requirements.txt

if [ ! -f ".env" ]; then
  echo "→ Création du fichier .env (copie de .env.example)…"
  cp .env.example .env
fi

if [ ! -f "price_radar.db" ]; then
  echo "→ Base absente : génération des données de test…"
  python seed.py
fi

echo ""
echo "======================================================"
echo "  Price Radar démarre sur http://localhost:8000"
echo "  API interactive : http://localhost:8000/docs"
echo "  (Ctrl+C pour arrêter)"
echo "======================================================"
echo ""
python run.py
