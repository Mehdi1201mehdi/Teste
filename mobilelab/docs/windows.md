# MobileLab sous Windows — guide de A à Z

Durée : 5 à 10 minutes. Aucun droit administrateur n'est nécessaire.
Configuration : Windows 10 ou 11, 64 bits, connexion Internet pour l'installation.

Deux méthodes. **La méthode 1 est la plus simple.**

---

## Méthode 1 — Programme prêt à l'emploi (recommandée)

### A. Télécharger

1. Ouvrez la page des versions du dépôt GitHub :
   `https://github.com/mehdi1201mehdi/teste/releases/tag/mobilelab-latest`
2. Téléchargez **`MobileLab-Windows-x64.zip`**.
   *(Vérification facultative : l'empreinte SHA-256 est dans le fichier `.sha256` à côté.)*

### B. Installer

3. Clic droit sur le zip → **Extraire tout…** → choisissez par exemple
   `Documents\MobileLab` → **Extraire**.
4. Dans le dossier extrait, double-cliquez sur **`MobileLab.exe`**.
5. Si Windows affiche **« Windows a protégé votre ordinateur »** : cliquez sur
   **Informations complémentaires** → **Exécuter quand même**. (Le programme n'est pas encore
   signé numériquement ; c'est normal pour une version de test.)
6. Facultatif : clic droit sur `MobileLab.exe` → **Afficher d'autres options** → **Envoyer vers**
   → **Bureau (créer un raccourci)**.

Passez ensuite à l'étape **C** plus bas.

---

## Méthode 2 — Installation automatique depuis les sources

À utiliser si vous préférez l'installation avec raccourcis et mises à jour faciles.

1. Sur GitHub, ouvrez la branche `claude/cool-edison-e34zco` → bouton vert **Code** →
   **Download ZIP**, puis extrayez le zip.
2. Ouvrez le dossier `mobilelab\windows` et double-cliquez sur **`INSTALLER.bat`**.
3. Le script fait tout, en vous posant deux questions :
   - installe **Python 3.12** s'il manque (pour vous seul) ;
   - installe MobileLab dans `%LOCALAPPDATA%\MobileLab` ;
   - propose d'installer **ADB** (Android) et les **outils Apple** (iPhone) ;
   - crée les raccourcis **Bureau** et **menu Démarrer** (dont « MobileLab (démo sans téléphone) ») ;
   - vérifie le tout et affiche un diagnostic.
4. Pour désinstaller : menu Démarrer → MobileLab → **Désinstaller MobileLab**
   (ou `DESINSTALLER.bat`). Vos sauvegardes ne sont jamais supprimées.

---

## C. Premier lancement — essayer sans téléphone

1. Dans MobileLab, cochez **Mode simulation** (en bas à gauche).
   Un bandeau violet indique que tout est factice.
2. Parcourez les onglets : Appareils, Sauvegarde (lancez une sauvegarde de démo), Gestion,
   Analyse (bouton « Analyser » dans l'historique des sauvegardes), Diagnostic…
3. Décochez **Mode simulation** pour revenir aux vrais appareils.

## D. Brancher un téléphone Android

1. **Installer ADB** (une seule fois) : onglet **Diagnostic** → **Installer / mettre à jour
   ADB** → **Oui**. Le téléchargement vient du site officiel de Google.
2. **Activer le débogage USB** sur le téléphone :
   - Paramètres → À propos du téléphone → touchez **7 fois** « Numéro de build »
     (Samsung : Paramètres → À propos → Informations sur le logiciel) ;
   - Paramètres → Système → **Options pour les développeurs** → activez **Débogage USB**.
3. Branchez le câble (un câble de **données**, pas seulement de charge), déverrouillez le
   téléphone, acceptez **« Autoriser le débogage USB ? »** (cochez « Toujours autoriser »).
4. L'appareil apparaît dans l'onglet **Appareils** avec l'état **Connecté**.

**Le téléphone n'apparaît pas ?**
- État « Autorisation requise » : déverrouillez le téléphone et acceptez la fenêtre.
- Rien du tout : installez le **pilote USB du fabricant** (Samsung : « Samsung USB Driver for
  Mobile Phones » ; Google Pixel : « Google USB Driver » ; Xiaomi, Oppo… : site du fabricant),
  puis rebranchez.
- Essayez un autre câble / port USB ; onglet Diagnostic → **Redémarrer le serveur ADB**.

## E. Brancher un iPhone / iPad

1. Installez **« Appareils Apple »** (ou **iTunes**) depuis le **Microsoft Store** : cela
   installe le pilote USB d'Apple.
2. Onglet **Diagnostic** → **Installer les outils Apple (iPhone)** → **Oui**.
3. Branchez, déverrouillez et touchez **« Se fier à cet ordinateur »**, puis saisissez le code.
4. L'iPhone apparaît dans **Appareils**. Sauvegarde : onglet **Sauvegarde** (sauvegarde
   complète officielle ; si le chiffrement est activé sur l'iPhone, elle sera chiffrée).

## F. Tout ce que vous pouvez faire

| Onglet | Fonctions |
|---|---|
| Appareils | Détection automatique, modèle, version, état, aide pas à pas |
| Sauvegarde | Android : photos, téléchargements, documents, musique, films, dossier au choix. iPhone : sauvegarde complète. Vérification d'intégrité, historique, suppression confirmée |
| Gestion (Android) | Liste des applications, export des APK, installation d'APK, désinstallation, capture d'écran, envoi de fichiers PC → téléphone, restauration d'une sauvegarde sur ce téléphone ou un autre (migration) |
| Analyse | Ouvrir une sauvegarde MobileLab, iPhone (non chiffrée), Android `.ab` ou un dossier ; filtres ; inspecteur de bases SQLite ; doublons ; photos (année, appareil, GPS) ; extraction ; comparaison ; rapport HTML/JSON/CSV |
| Récupération | Ce qui est possible / impossible, et marche à suivre |
| Diagnostic | État des outils, installation d'ADB et des outils Apple, choix manuel d'un exécutable, pack de support |
| Journal | Historique détaillé, filtrable, exportable |

## G. Où sont mes fichiers ?

| Quoi | Où |
|---|---|
| Sauvegardes (par défaut) | `%USERPROFILE%\MobileLab\Sauvegardes` |
| Captures d'écran | `%USERPROFILE%\Pictures\MobileLab` |
| Réglages, journaux, outils | `%LOCALAPPDATA%\MobileLab` |

Collez ces chemins dans la barre d'adresse de l'Explorateur.

## H. En cas de problème

1. Onglet **Diagnostic** → lisez les lignes « Attention » / « Erreur » et leur conseil.
2. **Exporter un pack de support…** crée un zip (diagnostic + journal, mots de passe masqués)
   que vous pouvez joindre à un signalement.
3. L'antivirus bloque `MobileLab.exe` : c'est une fausse alerte fréquente pour les programmes
   PyInstaller non signés ; ajoutez une exclusion ou utilisez la méthode 2.
