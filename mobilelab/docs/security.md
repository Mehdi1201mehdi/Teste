# Sécurité, confidentialité et cadre d'utilisation

MobileLab est destiné à **vos propres appareils** ou à ceux que vous êtes autorisé à
examiner. Il n'utilise que les mécanismes officiels des plateformes, après autorisation
explicite sur l'appareil (débogage USB accepté, « Faire confiance à cet ordinateur »).

## Ce que MobileLab ne fera jamais

- Contourner un verrouillage d'écran, FRP, le verrouillage d'activation, iCloud ou tout
  mécanisme antivol.
- Contourner une licence logicielle ou une protection technique.
- Déchiffrer une sauvegarde chiffrée sans le secret de son propriétaire (et aucune fonction
  de « récupération » de mot de passe n'est fournie).
- Accéder aux données privées des applications Android (root, exploits).
- Envoyer des données vers un service externe. **MobileLab ne fait aucune requête réseau.**

## Mesures techniques

| Risque | Mesure | Où |
|---|---|---|
| Injection de commande côté hôte | `subprocess` sans shell, arguments en liste, refus des octets NUL | `core/runner.py` |
| Lancement d'un programme arbitraire | liste blanche `ALLOWED_TOOLS` | `core/runner.py` |
| Injection côté appareil (`adb shell`) | chemin validé puis échappé (`shlex.quote`) | `adapters/adb.py` |
| Accès hors périmètre Android | racines autorisées : `/sdcard`, `/storage/emulated`, `/storage/self` ; `..` refusé | `core/paths.py` |
| Écriture hors destination (path traversal) | `safe_join` + noms assainis (Windows inclus) ; filtre `data` de `tarfile` | `core/paths.py`, `services/analysis.py` |
| Modification d'une preuve | SQLite ouverte sur une **copie** temporaire en `mode=ro` | `services/analysis.py` |
| Altération d'une sauvegarde | SHA-256 par fichier + sceau du manifeste ; vérification à la demande | `services/integrity.py` |
| Secrets dans les journaux | masquage (`password=`, `token:`, `Bearer …`, `api_key`…) avant écriture | `core/logging_setup.py` |
| Données personnelles collectées inutilement | propriétés d'appareil en liste blanche (pas de nom d'appareil, numéro, IMEI) | `adapters/adb.py`, `adapters/ios.py` |
| Fichiers sensibles lisibles par d'autres utilisateurs | dossier de données `0700`, base et journaux `0600` (POSIX) | `core/paths.py`, `core/db.py` |
| Suppression accidentelle | confirmation explicite (bouton par défaut : Annuler) ; refus si le dossier n'a pas de manifeste MobileLab | `services/backup.py`, `ui/widgets.py` |
| Écrasement | une sauvegarde crée toujours un dossier neuf horodaté | `services/backup.py` |
| Injection de formule (CSV) / script (HTML) | préfixe `'` ; échappement HTML | `services/report.py` |
| Confusion démo / réel | mode simulation : bandeau permanent, titre de fenêtre, en-tête de fichier, `simulated: true` dans le manifeste | `adapters/simulated.py`, `ui/main_window.py` |

## Données stockées localement

| Élément | Emplacement | Contenu |
|---|---|---|
| Base de métadonnées | `<données>/mobilelab.db` | historique des opérations, catalogue des sauvegardes (chemins, tailles) |
| Journaux | `<données>/logs/mobilelab.log` (rotation 3 × 2 Mo) | opérations, erreurs (secrets masqués) |
| Sauvegardes | dossier choisi par l'utilisateur | copie des fichiers + manifeste |

`<données>` : `%LOCALAPPDATA%\MobileLab` (Windows), `~/Library/Application Support/MobileLab`
(macOS), `$XDG_DATA_HOME/mobilelab` (Linux), ou `MOBILELAB_HOME`.

Les sauvegardes ne sont **pas chiffrées par MobileLab** : stockez-les sur un volume chiffré
(BitLocker, FileVault, LUKS) si elles contiennent des données sensibles.

## Licences des composants

ADB et libimobiledevice ne sont **pas redistribués** : l'utilisateur les installe depuis
leurs sources officielles. PySide6 (LGPL-3.0) est utilisé en lien dynamique ; un exécutable
PyInstaller en mode dossier conserve les bibliothèques Qt remplaçables. ALEAPP/iLEAPP (MIT)
sont facultatifs et externes.

## Signaler une vulnérabilité

Ouvrez une issue privée (GitHub Security Advisories) plutôt qu'une issue publique.
