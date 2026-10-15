# Architecture de MobileLab

## Principes

- **Trois couches** : interface (Qt) → services (logique métier, sans Qt) → adaptateurs
  (outils système). L'interface ne lance jamais d'outil directement.
- **Testabilité** : tout ce qui n'est pas Qt se teste sans écran ni appareil (`FakeRunner`,
  adaptateurs simulés). L'interface est testée hors écran (`QT_QPA_PLATFORM=offscreen`).
- **Lecture seule par défaut** : l'analyse ne modifie jamais une source.
- **Échec explicite** : chaque erreur porte un message et une piste d'action (`MobileLabError`).

## Arborescence

```
mobilelab/
├── pyproject.toml            dépendances, scripts, configuration pytest/ruff
├── scripts/                  run.sh, run.bat, build_exe.py (PyInstaller)
├── windows/                  INSTALLER.bat, install.ps1, DESINSTALLER.bat, LISEZMOI.txt
├── docs/                     analysis-report.md, architecture.md, security.md
├── tests/                    pytest (unitaires, intégration outils réels, UI hors écran)
└── src/mobilelab/
    ├── app.py                point d'entrée graphique (mobilelab)
    ├── cli.py                point d'entrée CLI (mobilelab-cli)
    ├── context.py            racine de composition (assemble services et adaptateurs)
    ├── core/
    │   ├── models.py         Device, ConnectionState, RemoteFile, BackupEntry…
    │   ├── errors.py         hiérarchie d'exceptions avec message + piste
    │   ├── paths.py          dossiers privés, validation des chemins, safe_join
    │   ├── runner.py         exécution contrôlée des outils (liste blanche, sans shell)
    │   ├── logging_setup.py  journal avec rotation, masquage des secrets, tampon UI
    │   ├── db.py             SQLite : opérations et catalogue des sauvegardes
    │   ├── settings.py       préférences (chemins d'outils, dossier de sauvegarde)
    │   └── modules.py        registre des modules (point d'extension)
    ├── adapters/
    │   ├── base.py           contrats DeviceAdapter / FileTransferAdapter / FullBackupAdapter
    │   ├── adb.py            Android via ADB
    │   ├── ios.py            Apple via libimobiledevice
    │   ├── simulated.py      appareils simulés (mode démo, clairement marqués)
    │   └── leapp.py          ALEAPP / iLEAPP (facultatifs)
    ├── services/
    │   ├── devices.py        agrégation, aide contextuelle
    │   ├── backup.py         sauvegardes, contrôle d'espace, suppression confirmée
    │   ├── integrity.py      SHA-256, manifeste mobilelab-backup/1, vérification
    │   ├── analysis.py       détection de type, inventaire, SQLite, iOS, .ab
    │   ├── compare.py        comparaison de sauvegardes
    │   ├── manager.py        applications, capture, envoi, restauration / migration
    │   ├── media.py          doublons (SHA-256), résumé photo (EXIF, GPS)
    │   ├── tools_install.py  téléchargement consenti d'ADB / outils Apple
    │   ├── report.py         rapports JSON / CSV / HTML avec provenance
    │   └── diagnostics.py    vérifications d'environnement, pack de support
    └── ui/
        ├── theme.py          jetons de couleur, thèmes clair/sombre, QSS
        ├── icons.py          icônes SVG originales
        ├── widgets.py        Card, Page, Pill, confirmations
        ├── workers.py        tâches longues dans le QThreadPool
        ├── state.py          état partagé, détection périodique
        ├── main_window.py    navigation, bandeau simulation, raccourcis
        └── pages/            devices, backup, manager, analysis, misc (récupération,
                              diagnostic, journal, modules)
```

## Flux de données

```
Page Qt ──(Worker / QThreadPool)──► Service ──► Adaptateur ──► CommandRunner ──► adb / idevice*
   ▲                                   │
   └──────── signaux Qt ◄──────────────┴──► MetadataStore (SQLite) · Journal · Manifeste
```

## Format de sauvegarde `mobilelab-backup/1`

```
<serial>_<AAAAMMJJ-HHMMSS>/
├── manifest.json     format, backup_id, date, outil, simulated, appareil, entrées
├── manifest.sha256   sceau du manifeste (détecte sa modification)
└── files/            arborescence copiée (chemins distants sans « / » initial)
```

Chaque entrée : `source` (chemin sur l'appareil), `relative_path`, `size`, `sha256`,
`status` (`ok`/`error`), `error`. Une sauvegarde partielle reste utilisable et
documente ses manques.

## Extensibilité

- **Nouvelle plateforme / nouvel outil** : implémenter `DeviceAdapter` (+ `FileTransferAdapter`
  ou `FullBackupAdapter`), ajouter l'outil à `ALLOWED_TOOLS`, l'enregistrer dans
  `context.build_context`.
- **Nouveau module fonctionnel** : `core.modules.register(FeatureModule(...))` avec un statut
  de maturité ; un module `PLANNED` est affiché sans être simulé.
- **Nouveau format de rapport** : étendre `services/report.py`.

## Choix techniques

| Choix | Raison | Alternative écartée |
|---|---|---|
| Python + PySide6 | écosystème forensique Python (ALEAPP/iLEAPP), Qt natif sur les 3 OS, LGPL | Electron (lourd, sans gain ici) |
| Outils CLI externes | protocoles maintenus par leurs projets ; pas de réimplémentation risquée | bibliothèques Python USB bas niveau (pilotes, maintenance) |
| SQLite stdlib | aucune dépendance, fiable | ORM (inutile pour 2 tables) |
| Outils dans `<données>/tools` | installation sans droits administrateur, trouvés avant le PATH | modifier le PATH système |
| Sondage 4 s | portable (aucune API de hot-plug commune aux 3 OS) | `adb track-devices` (Android seul) — piste d'optimisation |
