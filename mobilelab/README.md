# MobileLab

Boîte à outils desktop **open source** pour vos appareils mobiles : détection Android et
Apple, sauvegarde vérifiable, analyse de sauvegardes et diagnostic. Tout se fait en local, avec
les mécanismes officiels des plateformes (ADB, libimobiledevice), et sans contourner aucune
protection.

> MobileLab est une alternative indépendante à des suites commerciales comme Dr.Fone. Il n'en
> reprend ni le code, ni les ressources, ni l'interface. Voir
> [`docs/analysis-report.md`](docs/analysis-report.md) pour l'analyse et ses limites.

## Fonctionnalités

| Domaine | Disponible |
|---|---|
| Appareils | Détection automatique Android (ADB) et Apple (libimobiledevice), état de connexion, modèle, version, aide pas à pas (débogage USB, autorisation, appairage, udev) |
| Sauvegarde | Android : dossiers du stockage partagé, estimation, contrôle d'espace, SHA-256 par fichier, manifeste scellé, annulation. iOS : sauvegarde complète officielle (`idevicebackup2`) |
| Analyse | Sauvegardes MobileLab, iOS (Finder/iTunes, non chiffrées), Android `.ab`, dossiers : inventaire, types par signature, filtres, inspecteur SQLite en lecture seule, extraction, rapports HTML/JSON/CSV avec provenance |
| Récupération | Extraction depuis sauvegardes et fichiers existants, avec ses limites expliquées ; aucune promesse de récupération de fichiers supprimés |
| Diagnostic | Outils, serveur ADB, usbmuxd, espace disque ; redémarrage ADB ; pack de support ZIP |
| Journal | Journal en direct, filtrable, exportable (secrets masqués) |
| Modules | Comparaison de sauvegardes et ALEAPP/iLEAPP (expérimental) ; migration et analyse de médias prévues |
| Simulation | Appareils factices clairement signalés pour découvrir l'interface sans matériel |

## Installation

Prérequis : **Python 3.11 ou plus récent** (3.12 recommandé), puis, selon vos appareils :

| Système | Android | Apple |
|---|---|---|
| Windows | [Platform-Tools](https://developer.android.com/tools/releases/platform-tools) (+ pilote USB du fabricant) | Apple Mobile Device Support (fourni avec iTunes / Appareils Apple) + [libimobiledevice pour Windows](https://github.com/libimobiledevice-win32) |
| macOS | `brew install android-platform-tools` | `brew install libimobiledevice` |
| Debian/Ubuntu | `sudo apt install adb` (+ groupe `plugdev`, règles udev) | `sudo apt install libimobiledevice-utils usbmuxd` |

Les outils doivent être dans le `PATH`. L'onglet **Diagnostic** indique ce qui manque.

```bash
cd mobilelab
python -m venv .venv
source .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -e .
mobilelab                          # interface graphique
mobilelab --simulation             # démo sans appareil
```

Ou directement avec les scripts : `scripts/run.sh` (Linux/macOS), `scripts\run.bat` (Windows).

### Ligne de commande

```bash
mobilelab-cli devices
mobilelab-cli diagnose
mobilelab-cli backup <serial> ~/Sauvegardes --path /sdcard/DCIM
mobilelab-cli verify ~/Sauvegardes/<dossier>
mobilelab-cli inventory <sauvegarde|dossier|fichier.ab> --report rapport.html
mobilelab-cli compare <ancienne> <nouvelle>
```

## Créer un exécutable

```bash
pip install -e ".[build]"
python scripts/build_exe.py            # dossier dist/MobileLab/
python scripts/build_exe.py --onefile  # fichier unique (démarrage plus lent)
```

Construisez sur le système cible (PyInstaller ne fait pas de compilation croisée) :
Windows → `dist\MobileLab\MobileLab.exe`, macOS → `dist/MobileLab.app`, Linux →
`dist/MobileLab/MobileLab`. ADB et libimobiledevice restent à installer séparément.
Signature de code (Windows Authenticode, macOS notarisation) recommandée avant distribution.

## Développement

```bash
pip install -e ".[dev]"
pytest                 # tests unitaires, intégration (si adb/libimobiledevice présents) et UI
ruff check src tests
```

Sous Linux sans écran : `QT_QPA_PLATFORM=offscreen pytest` (bibliothèques `libegl1`,
`libxkbcommon0`, `libfontconfig1` requises par Qt). Thème forcé : `MOBILELAB_THEME=dark|light`.

Documentation : [architecture](docs/architecture.md) · [sécurité](docs/security.md) ·
[rapport d'analyse](docs/analysis-report.md).

## Cadre d'utilisation

À utiliser uniquement sur vos appareils ou avec une autorisation explicite. MobileLab ne
contourne ni verrouillage, ni FRP, ni verrouillage d'activation, ni chiffrement, et
n'envoie aucune donnée sur Internet. Détails : [`docs/security.md`](docs/security.md).

Licence : MIT.
