# Rapport d'analyse — Dr.Fone (Wondershare) et faisabilité d'une alternative open source

> Statut : **analyse de la cible incomplète**. L'accès réseau au site de Dr.Fone était bloqué
> dans l'environnement d'analyse ; aucune observation directe de la cible n'a pu être faite.
> Ce rapport distingue strictement ce qui a été observé de ce qui reste à confirmer.

Date : 2026-10-15 · Environnement : conteneur Linux cloud (Ubuntu, Python 3.13, Node 22).

## 1. Légende de classement

| Code | Signification |
|---|---|
| **V** | Vérifié par observation ou preuve (commande exécutée, sortie conservée ci-dessous) |
| **H** | Hypothèse à confirmer (connaissance générale non vérifiée dans cette session) |
| **I** | Inconnu avec les moyens disponibles |

## 2. Environnement et outils — constats

| # | Constat | Code | Preuve |
|---|---|---|---|
| E1 | REA `rea-agents` 6.5.0 s'exécute en CLI (153 commandes, 207 outils MCP déclarés) | V | `npx rea-agents@6.5.0 --help`, `rea doctor` (catalogue : `cli_commands: 153`, `mcp_tools: 207`) |
| E2 | REA enregistré comme serveur MCP de Claude Code via `rea setup --client claude_code` | V | `claude mcp list` → `rea: npx -y rea-agents@6.5.0 mcp - √ Connected` ; sauvegarde `/root/.claude.json.rea.backup` |
| E3 | Les outils MCP de REA ne sont pas chargés dans la session en cours (redémarrage du client requis) | V | Recherche d'outils `mcp__rea*` : aucun résultat ; les analyses ont été faites via le CLI REA, qui exécute les mêmes workflows |
| E4 | Le site `drfone.wondershare.net` est refusé par la politique réseau de l'environnement | V | `curl https://drfone.wondershare.net/fr/` → `CONNECT tunnel failed, response 403` |
| E5 | REA confirme l'échec d'observation web | V | `rea analyze-web-bundle` via Chromium/CDP → `code: target_unavailable`, `reason: target_not_allowed` ; journal du proxy : `drfone.wondershare.net:443 — connect_rejected ×3` |
| E6 | Un second canal (WebFetch) échoue également | V | `getaddrinfo ENOTFOUND drfone.wondershare.net` et `…wondershare.com` |
| E7 | ADB 34.0.4 et libimobiledevice 1.3.0 installables et fonctionnels (sans appareil) | V | `adb version` ; `ideviceinfo --version` ; `idevice_id -l` → `ERROR: Unable to retrieve device list!` (usbmuxd absent) |
| E8 | REA inspecte le client ADB sans contacter d'appareil | V | `rea inspect-adb-client` → `evidence_id: ev_8bacd95b…`, `version: 34.0.4-debian`, `contacted_adb_server: false`, `confidence: observed` |
| E9 | Aucun appareil physique ni port USB dans l'environnement cloud | V | `adb devices -l` → liste vide |
| E10 | Version de bureau de Dr.Fone : non disponible dans l'environnement | V | Aucun binaire fourni ; la machine de l'utilisateur n'est pas accessible |
| E11 | Architecture du logiciel de bureau (Electron, .NET, Qt, natif…) | I | Nécessite le binaire installé ; ne pas l'inférer du site web |

## 3. Fonctionnalités annoncées par Dr.Fone

Aucune page du site n'ayant pu être lue, **la liste ci-dessous n'est pas vérifiée**. Elle
reprend la connaissance générale antérieure du produit (catégorie H) et doit être confirmée
par l'analyse REA du site dès que le domaine est autorisé.

| Module (intitulé approximatif) | Code | Faisabilité open source | Décision MobileLab |
|---|---|---|---|
| Détection / informations d'appareil | H | Élevée : `adb devices -l`, `getprop` ; `idevice_id`, `ideviceinfo` | **Implémenté** |
| Sauvegarde du téléphone (Android) | H | Élevée pour le stockage partagé (`adb pull`) ; données privées d'apps inaccessibles sans root | **Implémenté** (stockage partagé) |
| Sauvegarde du téléphone (iOS) | H | Élevée : `idevicebackup2` (protocole de sauvegarde officiel via lockdown/usbmuxd) | **Implémenté** |
| Gestionnaire de fichiers / transfert ordinateur ↔ téléphone | H | Élevée en lecture ; écriture possible (`adb push`) | Lecture/export implémentés ; écriture **prévue** |
| Transfert téléphone → téléphone | H | Moyenne : formats et permissions variables | **Prévu** (module « migration »), après validation |
| Récupération de données (Android/iOS) | H | Fichiers existants et sauvegardes : élevée. Fichiers supprimés : faible sur appareils récents (chiffrement basé fichier, TRIM) ; souvent root/exploit requis | **Partiel** : extraction depuis sauvegardes, lecture SQLite, signalement des pages libres ; **aucune promesse** de récupération |
| Transfert / sauvegarde WhatsApp | H | Faible et fragile : bases chiffrées côté app, format propriétaire | **Non implémenté** |
| Réparation système (iOS/Android) | H | iOS : restauration via `idevicerestore` possible mais risquée ; Android : spécifique constructeur | **Non implémenté** (risque de perte de données) |
| Effacement de données | H | Techniquement simple (réinitialisation), mais destructif | **Non implémenté** à ce stade |
| Déverrouillage d'écran, contournement FRP, iCloud / verrouillage d'activation | H | — | **Exclu** : contournement de mesures de sécurité et antivol |
| Localisation virtuelle | H | Techniquement possible (mode développeur) | **Exclu** : usage principalement trompeur, hors objectif |
| Gestionnaire de mots de passe de l'appareil | H | — | **Exclu** : accès à des secrets |

Points **I** (inconnus) : protocoles réseau de Dr.Fone (licence, télémétrie, mises à jour),
format de ses sauvegardes, composants tiers embarqués, pilotes installés sous Windows.

## 4. Parcours utilisateur (référence MobileLab)

Les parcours Dr.Fone n'ont pas pu être observés (E4–E6). Les parcours ci-dessous sont ceux
de MobileLab, déduits des mécanismes officiels des plateformes (et non d'une copie) :

1. **Connexion** : branchement → détection automatique (sondage toutes les 4 s) → état
   (prêt, autorisation requise, appairage requis, hors ligne…) → aide contextuelle.
2. **Sauvegarde Android** : choix des dossiers du stockage partagé → estimation → contrôle
   d'espace → copie avec SHA-256 → manifeste scellé → historique.
3. **Sauvegarde iOS** : appairage → `idevicebackup2 backup --full` → empreintes → historique.
4. **Analyse** : ouverture d'une sauvegarde / d'un dossier / d'un `.ab` → inventaire filtrable →
   inspection SQLite (copie temporaire) → extraction → rapport HTML/JSON/CSV avec provenance.
5. **Diagnostic** : vérification des outils et services → pistes de résolution → pack de support.

## 5. Limites de REA constatées

- REA analyse ce qu'on lui donne : sans accès réseau à la cible, ni binaire local, il ne peut
  rien observer (E5). Il ne contourne pas les restrictions, ce qui est voulu.
- L'enregistrement MCP n'est pris en compte qu'au redémarrage du client (E3).
- Les fournisseurs natifs (Ghidra, IDA, JADX) ne sont pas configurés : l'analyse d'un binaire
  de bureau demanderait leur installation (Ghidra : `GHIDRA_INSTALL_DIR`, JADX :
  `REA_JADX_MCP_JAR`).
- Dans un conteneur cloud, l'analyse dynamique (exécution de Dr.Fone, capture USB) est
  impossible : pas d'interface graphique Windows/macOS, pas d'USB.
- Selon `DISCLAIMER.md` de REA : pas de contournement de DRM, de licences ou de mesures de
  protection — cohérent avec les règles de ce projet.

## 6. Ce qui permettrait de compléter l'analyse

1. Autoriser `drfone.wondershare.net` et `drfone.wondershare.com` dans l'accès réseau de
   l'environnement, puis lancer `capture-browser-scenario` / `analyze-web-bundle` /
   `export-web-scripts` de REA → mise à jour des lignes H du §3 en V ou en rejet.
2. Pour le logiciel de bureau installé légalement : exécuter REA **sur la machine de
   l'utilisateur** (`npx rea-agents setup`) ; analyses statiques possibles selon la
   technologie (Electron/JS → `analyze-javascript-application` ; .NET → outils managés ;
   natif → Ghidra). Analyse limitée à l'interopérabilité, sans toucher à la licence.

## 7. Technologies open source retenues

| Besoin | Outil | Licence | Remarque |
|---|---|---|---|
| Android | ADB (Android Platform-Tools) | Apache-2.0 (sources AOSP) | Binaire officiel Google soumis à ses conditions ; non embarqué |
| Apple | libimobiledevice (`idevice_id`, `ideviceinfo`, `idevicebackup2`) | LGPL-2.1 | Appelé comme programme externe ; non embarqué |
| Analyse forensique | ALEAPP / iLEAPP | MIT | Facultatifs, installés par l'utilisateur |
| Interface | PySide6 (Qt for Python) | LGPL-3.0 | Lien dynamique ; respecter la LGPL en distribution |
| Métadonnées | SQLite (module standard Python) | Domaine public | — |
| Packaging | PyInstaller | GPL-2.0 avec exception de bootloader | Distribution d'exécutables autorisée |

## 8. Sécurité, confidentialité, licence

Voir [`security.md`](security.md). En résumé : outils externes en liste blanche sans shell,
chemins validés, stockage partagé uniquement, lecture seule en analyse, aucun envoi réseau,
secrets masqués dans les journaux, suppression uniquement avec confirmation explicite.
