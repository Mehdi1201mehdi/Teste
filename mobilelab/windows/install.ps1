<#
  MobileLab - installation Windows (depuis les sources).
  Lance par INSTALLER.bat. Ne demande PAS les droits administrateur : tout est installe
  pour l'utilisateur courant dans %LOCALAPPDATA%\MobileLab.

  Etapes : Python 3.12 (si absent) -> environnement isole -> MobileLab -> outils (ADB,
  outils Apple, avec votre accord) -> raccourcis Bureau et menu Demarrer.
#>
param(
    [switch]$Unattended,      # aucune question (pour l'automatisation)
    [switch]$WithTools,       # installe ADB sans demander
    [switch]$WithAppleTools,  # installe aussi les outils Apple sans demander
    [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # telechargements beaucoup plus rapides
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Source  = Split-Path -Parent $PSScriptRoot           # dossier "mobilelab"
$AppHome = Join-Path $env:LOCALAPPDATA 'MobileLab'
$Venv    = Join-Path $AppHome 'venv'
$Py      = Join-Path $Venv 'Scripts\python.exe'
$PyW     = Join-Path $Venv 'Scripts\pythonw.exe'
$Cli     = Join-Path $Venv 'Scripts\mobilelab-cli.exe'
$PythonVersion = '3.12.10'

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !   $text" -ForegroundColor Yellow }

function Ask($question) {
    if ($Unattended) { return $false }
    $answer = Read-Host "$question (O/N)"
    return $answer -match '^(o|oui|y|yes)$'
}

function Test-PythonExe($exe, $prefix) {
    # Verifie un interpreteur (ignore l'alias "python.exe" du Microsoft Store, qui ne fait
    # qu'ouvrir le Store) et renvoie son chemin s'il est en 3.11+.
    try {
        $pyArgs = @($prefix, '-c', 'import sys; print(sys.executable); print(sys.version_info >= (3, 11))') | Where-Object { $_ }
        $out = & $exe @pyArgs 2>$null
        if ($LASTEXITCODE -eq 0 -and $out.Count -ge 2 -and $out[1] -eq 'True') { return $out[0] }
    } catch { }
    return $null
}

function Find-Python {
    $candidates = @(
        @{ exe = 'py'; prefix = '-3.12' },
        @{ exe = 'py'; prefix = '-3' },
        @{ exe = (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'); prefix = $null },
        @{ exe = 'python'; prefix = $null }
    )
    foreach ($c in $candidates) {
        $found = Test-PythonExe $c.exe $c.prefix
        if ($found) { return $found }
    }
    return $null
}

Write-Host ""
Write-Host "  MobileLab - installation pour Windows" -ForegroundColor White
Write-Host "  Dossier d'installation : $AppHome"
if (-not (Test-Path (Join-Path $Source 'pyproject.toml'))) {
    throw "Fichiers de MobileLab introuvables a cote de ce script ($Source). Gardez le dossier 'windows' dans le dossier 'mobilelab'."
}
if (-not [Environment]::Is64BitOperatingSystem) { throw "Windows 64 bits requis." }

# 1. Python ---------------------------------------------------------------------
Step "Recherche de Python 3.11 ou plus recent"
$python = Find-Python
if (-not $python) {
    Warn "Python absent : installation de Python $PythonVersion (pour vous seul, sans droits administrateur)."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        & winget install --id Python.Python.3.12 --exact --scope user --silent `
            --accept-package-agreements --accept-source-agreements | Out-Host
    }
    $python = Find-Python
    if (-not $python) {
        $url = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
        $setup = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"
        Write-Host "    Telechargement depuis python.org..."
        Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing
        $sig = Get-AuthenticodeSignature $setup
        if ($sig.Status -ne 'Valid') { throw "Signature de l'installeur Python invalide : arret par securite." }
        Start-Process -FilePath $setup -Wait -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0'
        Remove-Item $setup -ErrorAction SilentlyContinue
        $python = Find-Python
    }
    if (-not $python) { throw "Impossible d'installer Python automatiquement. Installez Python 3.12 depuis python.org puis relancez INSTALLER.bat." }
}
Ok "Python : $python"

# 2. Environnement isole + MobileLab -------------------------------------------
Step "Installation de MobileLab (environnement isole)"
New-Item -ItemType Directory -Force -Path $AppHome | Out-Null
if (-not (Test-Path $Py)) { & $python -m venv $Venv; if ($LASTEXITCODE) { throw "Creation de l'environnement impossible." } }
& $Py -m pip install --upgrade pip --quiet --disable-pip-version-check
& $Py -m pip install --upgrade "$Source" --quiet --disable-pip-version-check
if ($LASTEXITCODE) { throw "Installation de MobileLab impossible (voir les messages ci-dessus)." }
Ok ("MobileLab " + (& $Py -c "import mobilelab; print(mobilelab.__version__)"))

# 3. Outils ------------------------------------------------------------------------
Step "Outils pour les telephones"
Write-Host "    ADB (Android) sera telecharge depuis le site officiel de Google (dl.google.com)."
Write-Host "    En l'installant, vous acceptez les conditions de licence du SDK Android."
$apple = $false
if ($WithTools -or (Ask "    Installer ADB maintenant ?")) {
    $cliArgs = @('install-tools', '--yes')
    if ($WithAppleTools -or (Ask "    Avez-vous un iPhone/iPad a connecter (installe aussi les outils Apple) ?")) {
        $cliArgs += '--apple'
        $apple = $true
    }
    & $Cli @cliArgs
    if ($LASTEXITCODE) { Warn "Installation des outils incomplete : reessayez depuis l'onglet Diagnostic de MobileLab." }
    if ($apple -and -not $Unattended) {
        Write-Host "    Pour l'iPhone, Windows a aussi besoin du pilote Apple : installez l'application"
        Write-Host "    'Appareils Apple' (ou iTunes) depuis le Microsoft Store qui va s'ouvrir."
        Start-Process "ms-windows-store://search/?query=Apple%20Devices"
    }
} else {
    Warn "Outils non installes : vous pourrez le faire plus tard (onglet Diagnostic)."
}

# 4. Raccourcis -----------------------------------------------------------------
if (-not $NoShortcuts) {
    Step "Creation des raccourcis"
    $icon = Join-Path $AppHome 'mobilelab.ico'
    & $Py -c "from mobilelab.ui.icons import write_app_icon; write_app_icon(r'$icon')" | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') (Join-Path $AppHome 'uninstall.ps1') -Force
    $shell = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'MobileLab'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    $links = @(
        @{ path = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MobileLab.lnk'); args = '-m mobilelab'; desc = 'MobileLab' },
        @{ path = (Join-Path $menu 'MobileLab.lnk'); args = '-m mobilelab'; desc = 'MobileLab' },
        @{ path = (Join-Path $menu 'MobileLab (demo sans telephone).lnk'); args = '-m mobilelab --simulation'; desc = 'MobileLab - mode simulation' }
    )
    foreach ($l in $links) {
        $s = $shell.CreateShortcut($l.path)
        $s.TargetPath = $PyW
        $s.Arguments = $l.args
        $s.WorkingDirectory = $AppHome
        $s.IconLocation = "$icon,0"
        $s.Description = $l.desc
        $s.Save()
    }
    $u = $shell.CreateShortcut((Join-Path $menu 'Desinstaller MobileLab.lnk'))
    $u.TargetPath = 'powershell.exe'
    $u.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$AppHome\uninstall.ps1`""
    $u.Save()
    Ok "Bureau et menu Demarrer > MobileLab"
}

# 5. Verification ----------------------------------------------------------------
Step "Verification"
& $Cli diagnose
Write-Host ""
Write-Host "  Installation terminee." -ForegroundColor Green
Write-Host "  Lancez MobileLab depuis l'icone du Bureau (ou 'MobileLab (demo...)' pour essayer sans telephone)."
if (-not $Unattended -and (Ask "  Lancer MobileLab maintenant ?")) { Start-Process -FilePath $PyW -ArgumentList '-m', 'mobilelab' }
