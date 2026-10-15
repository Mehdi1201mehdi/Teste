#!/usr/bin/env bash
# Lance MobileLab (Linux/macOS). Crée l'environnement virtuel au premier lancement.
# Usage : scripts/run.sh [--simulation]
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
if [ ! -d .venv ]; then
  echo "Création de l'environnement virtuel…"
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -e . >/dev/null
fi
exec .venv/bin/python -m mobilelab "$@"
