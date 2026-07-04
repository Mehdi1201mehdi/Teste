# Demarrage en une commande sous Windows (PowerShell) : .\start.ps1
# Cree l'environnement virtuel, installe les dependances, copie .env,
# genere les donnees de test au premier lancement, puis demarre le serveur.
#
# Si Windows bloque l'execution du script, lancez d'abord (une seule fois) :
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- Trouver Python ---
$python = $null
foreach ($cmd in @("python", "py", "python3")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $python = $cmd; break }
}
if (-not $python) {
    Write-Host "Python introuvable. Installez-le depuis https://www.python.org/downloads/ (cochez 'Add to PATH')." -ForegroundColor Red
    exit 1
}

# --- Environnement virtuel ---
if (-not (Test-Path ".venv")) {
    Write-Host "-> Creation de l'environnement virtuel..." -ForegroundColor Cyan
    & $python -m venv .venv
}
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

# --- Dependances ---
Write-Host "-> Installation des dependances..." -ForegroundColor Cyan
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r requirements.txt

# --- Fichier .env ---
if (-not (Test-Path ".env")) {
    Write-Host "-> Creation du fichier .env (copie de .env.example)..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
}

# --- Donnees de test au premier lancement ---
if (-not (Test-Path "price_radar.db")) {
    Write-Host "-> Base absente : generation des donnees de test..." -ForegroundColor Cyan
    & $venvPython seed.py
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  Price Radar demarre sur http://localhost:8000"       -ForegroundColor Green
Write-Host "  API interactive : http://localhost:8000/docs"          -ForegroundColor Green
Write-Host "  (Ctrl+C pour arreter)"                                 -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""

# --- Ouvre le navigateur puis demarre le serveur ---
Start-Process "http://localhost:8000"
& $venvPython run.py
