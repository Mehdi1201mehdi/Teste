<#
  MobileLab - desinstallation. Vos sauvegardes (Documents\..\MobileLab\Sauvegardes ou le
  dossier que vous avez choisi) ne sont JAMAIS supprimees par ce script.
#>
$ErrorActionPreference = 'Continue'
$AppHome = Join-Path $env:LOCALAPPDATA 'MobileLab'

Write-Host "Desinstallation de MobileLab" -ForegroundColor Cyan
Get-Process -Name adb -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$AppHome*" } | Stop-Process -Force
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MobileLab.lnk'
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'MobileLab'
Remove-Item $desktop -ErrorAction SilentlyContinue
Remove-Item $menu -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $AppHome 'venv') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Programme et raccourcis supprimes."

$answer = Read-Host "Supprimer aussi les reglages, journaux et outils telecharges ($AppHome) ? Vos sauvegardes ne sont pas concernees. (O/N)"
if ($answer -match '^(o|oui|y|yes)$') {
    Remove-Item $AppHome -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Donnees de l'application supprimees."
}
Write-Host "Termine. Python reste installe (il peut servir a d'autres programmes)."
Read-Host "Appuyez sur Entree pour fermer"
