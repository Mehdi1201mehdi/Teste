# Demarrage en une commande sous Windows (PowerShell) : .\start.ps1
# Cree l'environnement virtuel, installe les dependances, copie .env,
# genere les donnees de test au premier lancement, puis demarre le serveur.
#
# Si Windows bloque l'execution du script, lancez d'abord (une seule fois) :
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

$ErrorActionPreference = "Stop"

# Dossier du script : $PSScriptRoot quand on execute le .ps1, sinon le
# dossier courant (cas ou le contenu est colle a la main dans la console).
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location -Path $scriptDir

# Verifie qu'on est bien dans le dossier du projet.
if (-not (Test-Path "requirements.txt")) {
    Write-Host "requirements.txt introuvable dans '$scriptDir'." -ForegroundColor Red
    Write-Host "Placez-vous dans le dossier price-radar, puis lancez : .\start.ps1" -ForegroundColor Yellow
    exit 1
}

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
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "L'environnement virtuel n'a pas pu etre cree." -ForegroundColor Red
    Write-Host "Supprimez le dossier .venv puis relancez le script." -ForegroundColor Yellow
    exit 1
}

# --- Dependances ---
Write-Host "-> Installation des dependances..." -ForegroundColor Cyan
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r requirements.txt

# --- Fichier .env ---
if (-not (Test-Path ".env")) {
    Write-Host "-> Creation du fichier .env (copie de .env.example)..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
}

# Pas de donnees fictives : l'app demarre vide et synchronise les vrais
# sites e-commerce (connecteurs) automatiquement au lancement.

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
