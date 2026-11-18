# Brigade Verte — Audit & feuille de route

_Audit du 24/09/2026, complété le 17/11/2026 · application `brigade-verte-v3` · complète `DESIGN-SYSTEM.md`._

## 1. Ce qui existe (et qu'on garde)

| Domaine | État |
|---|---|
| Stack | PWA vanilla ES modules, sans framework ni build obligatoire (esbuild minifie au déploiement). ~5 600 lignes. |
| Parcours | 2 étapes Lieu → Déchets (enregistrement direct) + vues Rapport et Collecte. Mail au format historique **octet pour octet** (test de non-régression). |
| Carte | Leaflet 1.9 embarqué, Plan IGN (Géoplateforme), 27 quartiers + 5 secteurs officiels d'Amiens Métropole embarqués, mode hors ligne (rues en points). |
| Adresse | 1 437 rues locales (instantané, hors ligne) + BAN pour affiner le secteur par le numéro. |
| Stockage | localStorage schéma v4 avec migration, export/import JSON de secours. |
| Offline | Service worker : coquille en cache-first, tuiles IGN plafonnées à 700. |
| Design system | « Relevé de terrain » : papier calcaire + ardoise, orange signal, 5 teintes de secteur, 3 polices OFL auto-hébergées, tokens couleurs/espaces/rayons/ombres/mouvement. |
| Accessibilité | 0 violation axe-core, cibles 48–56 px, `prefers-reduced-motion`, dialogues natifs. |

**Verdict** : la base est saine. On ne réécrit rien. On améliore par petites touches testées.

## 2. Constats de l'audit (fonctionnel + visuel, 320 → 1440 px)

| # | Constat | Impact | Priorité |
|---|---|---|---|
| A | **Le toast recouvre le bouton principal** (Déchets, Copier le message) sur mobile, pendant 2 à 5,5 s. | Bloque l'action suivante | P1 |
| B | **GPS « à l'aveugle »** : une seule mesure, aucune précision affichée, aucune animation de recherche sur la carte. En ville, ± 60 m peut changer de rue. | Erreurs de rue | P1 |
| C | **Mobile : la rue choisie finit cachée sous le compteur** : la carte se replie pendant la frappe, centre la rue, puis se redéploie sans recentrer (`invalidateSize({pan:false})`). | Perte de repère | P1 |
| D | **320 px : le nom de rue se coupe au milieu d'un mot** (« Rochefouca / uld »). | Lisibilité | P2 |
| E | **Pas de détection de doublon** : même rue + même numéro saisis deux fois dans la tournée. | Mail en double | P2 |
| F | Toasts : un seul ton (neutre/alerte), pas de fermeture, pas d'état succès/erreur distinct. | Clarté | P2 |
| G | Aucun retour haptique (Android le permet). | Terrain, gants | P3 |
| H | `manifest.webmanifest` garde les anciennes couleurs (#edf7f1 / #0f6b3a). | Écran de lancement incohérent | P3 |
| I | La page `/suivi/` n'utilise pas le design system (emojis). | Cohérence | P3 |
| J | Le dépôt GitHub est public (le code, pas les données). | Info | — |

Points déjà bons, à ne pas toucher : l'empty state du rapport (illustration + action), la confirmation de clôture (case obligatoire), l'annulation de suppression, l'anti-chevauchement des noms de quartiers.

## 3. Outils, connecteurs, services

| Outil | Utilité ici | Coût | Sécurité / permissions | Hors ligne | Décision |
|---|---|---|---|---|---|
| GitHub (web + Actions) | Code, PR, déploiement Pages | Gratuit | Dépôt public : aucun secret dans le code | — | ✅ en place |
| Cloudflare Pages | Préversion par branche | Gratuit | Lecture seule du dépôt | — | ✅ en place |
| Claude in Chrome | Tests réels (réseau IGN/BAN), captures | — | Agit dans le Chrome de l'utilisateur | — | ✅ utilisé |
| Playwright + axe-core | 30 tests fonctionnels, a11y, captures multi-tailles | Gratuit | Local | ✅ | ✅ en place |
| IGN Géoplateforme | Fond de carte | Gratuit, sans clé | CORS ouvert | Cache 700 tuiles | ✅ |
| API Adresse (BAN) | Géocodage / secteur par numéro | Gratuit, sans clé | Aucune donnée perso envoyée (adresse publique) | ❌ (repli local) | ✅ |
| WFS Amiens Métropole | Quartiers/secteurs | Gratuit | — | Données embarquées | ✅ (instantané) |
| Hugging Face (MCP) | Recherche de modèles | Gratuit | Compte `mehdi1201` | — | ✅ recherche faite |
| Figma (MCP) | Maquettes / bibliothèque | Selon plan | — | — | ⏸ utile si l'équipe veut itérer sur maquettes |
| Replit | Hébergement d'apps | — | — | — | ❌ inutile (Pages suffit) |

## 4. IA — ce qui a de la valeur (et ce qui n'en a pas)

**Recherche Hugging Face (24/09/2026)**
- Modèles « waste detection » (YOLOv8/v10/11) : téléchargements quasi nuls, licences floues, classes « recyclage » (bouteille, canette), et non les dépôts sauvages (matelas, gravats, canapé). **Non retenus.**
- **`Xenova/siglip-base-patch16-224`** (zero-shot, ONNX, transformers.js) : tourne **dans le téléphone**, sans clé ni serveur. Les libellés seraient notre propre liste de déchets. **Candidat R&D.**
- VLM compacts (`SmolVLM-256M/500M`, ONNX) : capables de décrire une photo, mais 250–500 Mo et lents sur mobile. **Pas pour le terrain aujourd'hui.**
- API d'inférence HF depuis une page statique : exposerait un jeton. **Refusé.**

**Où l'IA n'apporte rien** : réécrire le mail (format imposé, octet pour octet), résumer le rapport (le calcul déterministe est plus fiable).

**Contrainte réelle** : le mail part par `mailto:` (Outlook), qui ne joint pas de photo. Une photo ne servirait donc qu'à **suggérer les déchets**, jamais à les valider seule.

## 5. Architecture cible (adaptée au projet)

```
brigade-verte-v3/
├── css/  tokens · base · layout · components · animations · map   ← Design System + Motion System
├── js/
│   ├── app.js, router.js, storage.js                               ← Core + Offline Engine (localStorage v4)
│   ├── composer.js, report.js, components.js, ui.js                ← UI
│   ├── geo.js                                                      ← GPS (suivi de précision)
│   ├── map.js, sectors.js                                          ← Maps
│   ├── streets.js, api.js                                          ← Address
│   ├── bp.js, mail.js, waste.js                                    ← Data / règles métier pures
│   └── (futur) vision.js                                           ← Vision AI, chargé à la demande
├── data/  streets · waste · quartiers · secteurs
└── service-worker.js                                               ← Offline Engine
tests (hors dépôt) : func.py · axe.py · mailbase.py · captures
```
Pas de Sync Engine ni d'Analytics serveur : l'outil reste **100 % local**, sans compte ni donnée personnelle collectée. C'est un choix, pas un manque.

## 6. Feuille de route

**Itération 1 — terrain & feedback (livrée le 24/09/2026)**
1. Toasts typés (succès / info / alerte / erreur), bouton fermer, placés **au-dessus** de la barre d'action.
2. GPS visuel : anneau de recherche, **cercle de précision réel** qui se resserre, arrêt à ± 25 m ou après 12 s, erreurs expliquées.
3. Carte mobile : la rue choisie reste centrée quand la carte se redéploie.
4. Détection de doublon (même rue + même numéro dans la tournée) avec accès au bon existant.
5. Retour haptique discret (Android), désactivé par « mouvement réduit ».
6. Coupure propre des noms de rue à 320 px ; manifest aux couleurs du design system.

**Itération 2 — mémoire du territoire**
- Historique local anonyme des tournées (rue, date, déchets), sans donnée personnelle.
- Carte « points chauds » : rues récurrentes sur 30/90 jours, en densité par quartier.
- « Cette rue a déjà eu 3 dépôts ce mois-ci » dans la carte du lieu.

**Itération 3 — Vision (R&D mesurée)**
- Prototype SigLIP opt-in : photo → 3 suggestions de déchets → l'agent valide.
- Critère d'adoption : ≥ 70 % de bonne suggestion dans le top 3 sur 50 vraies photos d'Amiens, modèle < 100 Mo, < 2 s sur un Android d'entrée de gamme. Sinon : on n'intègre pas.

**Itération 4 — finition**
- Page `/suivi/` alignée sur le design system.
- Transitions d'écran via View Transitions API (repli CSS).
- Revue design « 10× » écran par écran.


## 7. Audit du 17/11/2026 (6 axes : UX, responsive, JS, performance/hors ligne, carte/GPS, accessibilité)

**Corrigé**

| Priorité | Constat | Correction |
|---|---|---|
| Critique | Une réponse d'erreur (404, portail Wi-Fi) pouvait remplacer `streets.json` en cache → plus de recherche de rue hors ligne | `service-worker.js` : seules les réponses valides sont mises en cache |
| Critique | Les sauvegardes v5 (`current.bps`) n'étaient plus relues à l'import | `js/backup.js` : lecture v3 / v4 / v5 |
| Critique | Abréviation tapée (« mat ») envoyée telle quelle dans le rapport | « Ajouter » / Entrée retiennent le libellé officiel (« Matelas ») |
| Critique | GPS lent : un résultat tardif écrasait la rue choisie à la main ; la croix n'annulait pas | Localisation annulée dès qu'une rue est choisie autrement |
| Critique | Téléphone en paysage : aucun champ visible | Disposition carte + saisie côte à côte |
| Critique | Focus clavier invisible sur les boutons principaux et en contraste élevé | Anneau de focus + contour transparent |
| Important | Texte du rapport retouché à la main effacé sans prévenir | Avertissement explicite ; la date suit le texte retouché |
| Important | Bon importé avec un secteur mal écrit absent du mail | Secteur normalisé, lignes invalides refusées et signalées |
| Important | Historique v5 (IndexedDB) devenu inaccessible | Joint à l'export JSON |
| Important | Modifier un bon effaçait ses champs v5 (id, note…) | Champs conservés |
| Important | Secteur d'une ancienne adresse appliqué à la nouvelle (réseau lent) ; secteur GPS remplacé hors ligne | Réponse tardive ignorée ; le secteur n'est remplacé que par une donnée plus précise |
| Important | Ordinateur : « Outlook ne s'est pas ouvert » affiché à tort | Détection de la perte de focus |
| Important | Code modifié sans changer `VERSION` → jamais mis à jour sur les téléphones | Empreinte du contenu ajoutée à la version au déploiement (`build.sh`) |
| Important | `/suivi/` : « Match France / Maroc » figé dans les comptes rendus | Champ « Motif » facultatif |
| Important | Cibles tactiles < 44 px, zoom iOS sur 3 champs, encoche ignorée, attribution IGN masquée sur mobile | Corrigé (CSS) |
| Amélioration | Férié un mercredi à Amiens : jour férié affiché « reporté » | Affiché « férié — à vérifier » (règle non publiée, pas inventée) |
| Amélioration | Erreur JS à chaque coupure réseau (écran d'accueil) ; double téléchargement des secteurs ; attente GPS/adresse jusqu'à 9–12 s | Corrigé (budgets de 4–6 s) |
| Amélioration | Sauvegarde illisible écrasée ; stockage plein ; deux onglets | Copie `…_illisible` ; caches non essentiels libérés ; onglets synchronisés |
| Amélioration | Écran d'accueil : 2 s imposées | 1,4 s le premier lancement du jour, 0,2 s ensuite (toujours sautable) |

**Restant / à décider**
- **Semaine 53** : la semaine du 28/12/2026 est la n° 53 (impaire), suivie de la n° 1 (impaire). Confirmer auprès d'Amiens Métropole si l'alternance « semaines paires » suit la numérotation ISO.
- Tableau de bord, historique, exports CSV (v5) : retirés du code le 28/09/2026, non recréés.
- Premier chargement sur réseau très faible : ~10 s (26 modules). Un regroupement (`esbuild --bundle`) le réduirait ; à faire avec un test de mise à jour.
- Balises de carte placées au point de référence de la rue (pas à la position GPS) ; 3 rues sans secteur dans `streets.json`.
- Non testé sur appareil réel : Safari iOS, lecteurs d'écran (VoiceOver, TalkBack), gants, plein soleil, ouverture réelle d'Outlook.


## 8. Refonte du 18/11/2026 (équipe de sous-agents)

Analyse : audit technique & données, expert métier, designer UX/UI. Réalisation en parallèle avec fichiers attribués : structure/navigation, Accueil, Terrain, Rapports, Collecte. Contrôle : agent QA (12 séries de tests, ~420 vérifications), corrections intégrées par le chef de projet.

- **Nouveau** : écran Accueil (indicateurs réels, accès Terrain/Rapports/Collecte, activité récente, alerte tournée précédente non clôturée), navigation barre basse / barre latérale, date et heure réelles par bon (`createdAt`, `updatedAt`, jamais inventées pour les anciens bons), identifiant stable par bon (`id`).
- **Terrain** : déchets en grandes cartes par famille, bouton « ENREGISTRER LE DÉPÔT », annulation après enregistrement.
- **Rapports** : recherche, filtre par secteur, tri, détails ; aperçu complet ; retours visuels sans jamais écrire « envoyé ».
- **Collecte** : une carte par type, badges Aujourd'hui / Reporté / Férié — à vérifier ; moteur inchangé.
- **Inchangé** : format du rapport (mail.js, phrase.js, email.js), moteur de collecte, clé de stockage et compatibilité des sauvegardes v3/v4/v5.
- **Restant** : semaine 53 à confirmer avec Amiens Métropole ; essais sur vrais téléphones (Outlook, GPS) ; un bouton de déchet peut être partiellement couvert par la barre d'action selon le défilement.
