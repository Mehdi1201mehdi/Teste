# Brigade Verte — Design system « SaaS métier » (refonte 18/11/2026)

Spécification complète : produite par l'agent UX/UI pendant la refonte et appliquée dans `css/tokens.css` (jetons) et `css/theme.css` (éléments transverses) ; chaque écran a sa feuille : `dashboard.css`, `terrain.css`, `rapport.css`, `collecte.css`.

- **Palette** : vert profond `#17573A` (actions, page active), vert clair `#1E7B47` / `#DDF3E5` (validations), fond `#F3F5F4`, surfaces blanches, texte `#1F2933`, orange `#B84A0E` (alertes uniquement), rouge `#B42318` (suppressions, erreurs). Couleurs de secteur inchangées.
- **Forme** : cartes blanches, rayons 12–16 px, ombres discrètes, cibles ≥ 44–48 px.
- **Typographie** : Instrument Sans (interface), JetBrains Mono (n° et aperçu du message).
- **Navigation** : un seul menu — barre fixe en bas (< 768 px), rail (768–1023 px et téléphone en paysage), barre latérale de 248 px (≥ 1024 px). Réglages dans l'en-tête et en bas de la barre latérale.
- **Icônes** : Lucide (sprite SVG d'`index.html`), dont une icône par famille de déchets (`#i-fam-…`).
- **Accessibilité** : contrastes AA vérifiés, focus visibles, `prefers-reduced-motion`, noms accessibles = texte visible.

---

## Version précédente « Fiche de constat » (17/11/2026)

_Refonte visuelle du 17/11/2026. Le principe et les composants ci-dessous restent valables ; l'apparence a changé._

## Principe (novembre 2026)

Le modèle est l'objet réel : **le bon de passage papier** de la police municipale.

- **Papier** blanc de liasse (`--paper` #f4f3ee, champs `--sheet` #fff), **encre bleu-noir** (`--ink` #16212b).
- **Une seule couleur d'identité** : le vert brigade (`--brand` #17573a, barre d'application `--appbar` #133f2b). L'**orange** (`--signal`) reste réservé aux dépôts constatés.
- **Angles nets** (3 à 7 px, plus aucune pilule), **filets fins**, ombres quasi absentes. Aucun halo, aucun effet de verre, aucun vert fluo.
- **Étiquettes en clair** (« Rue », « N° »), en police d'interface. Plus de codes en majuscules espacées ni de police machine à écrire décorative.
- **Numéro de bon** façon numéro de série imprimé (cadre rouge). **Étapes** et **familles de déchets** en onglets soulignés.
- **Aperçu du message** rédigé comme un courrier, dans la police de l'interface, pas comme du code.
- **Typographie** : Instrument Sans seule (titres et texte) ; JetBrains Mono uniquement pour les numéros. Bricolage Grotesque n'est plus utilisée.
- **Écran de démarrage** sobre : emblème, « Police municipale d'Amiens — Brigade Verte », vraie progression, nombre de voies chargées.

Implémentation : valeurs dans `css/tokens.css`, apparence des composants dans `css/fiche.css` (chargée après `components.css`).
Toutes les paires texte/fond respectent WCAG AA : 0 violation axe-core sur 12 écrans (mobile et ordinateur).

---

## Version précédente « Relevé de terrain » (septembre 2026)

## Principe

Deux matières :

- **Papier** (calcaire `#f3f1ea`) : tout ce qui se lit et se saisit. Le contraste est fort pour rester lisible en plein soleil.
- **Ardoise** (`#0f1c17`) : le territoire. La carte d'Amiens y est dessinée en points lumineux par secteur.

Un seul accent chaud, l'**orange signal** (`#c4420c`), est réservé aux dépôts relevés : balises, déchets constatés et bouton d'enregistrement.

## Tokens (`css/tokens.css`)

| Famille | Tokens |
|---|---|
| Surfaces | `--paper`, `--paper-2`, `--sheet`, `--sheet-raised`, `--line`, `--line-strong` |
| Encre | `--ink` (15.8:1), `--ink-2` (9.3:1), `--muted` (5.3:1) |
| Marque / signal | `--brand`, `--brand-tint`, `--signal`, `--signal-strong`, `--signal-tint`, `--glow` (sur ardoise uniquement) |
| Secteurs | `--sec-centre` améthyste, `--sec-ouest` bleu Somme, `--sec-nord` mousse, `--sec-est` brique, `--sec-sud` ocre (versions « allumées » `--lit-*` dans `map.css`) |
| Forme | `--r-xs` 6 · `--r-sm` 10 · `--r` 14 · `--r-lg` 22 |
| Espace | grille de 4 px : `--s1` … `--s8` |
| Ergonomie | `--tap` 48 px, `--tap-lg` 56 px (action principale, zone du pouce) |
| Mouvement | `--t-fast` 120 ms, `--t` 200 ms, `--t-slow` 320 ms ; tout est coupé si `prefers-reduced-motion` |

## Typographie (auto-hébergée, hors ligne, licence OFL)

- **Bricolage Grotesque** : titres, compteurs, adresses.
- **Instrument Sans** : interface et texte courant.
- **JetBrains Mono** : étiquettes, numéros de bon, dates, texte du message.

La police Marianne a été retirée. Elle est réservée aux services de l'État et ne doit pas être utilisée pour une collectivité.

## Composants (`css/components.css`)

| Composant | Classes |
|---|---|
| Navigation | commutateur de vue `.viewSwitch` / `.vsBtn`, tampon de tournée `.stamp`, étapes `.stages` / `.stageBtn` |
| Saisie | `.field`, `.label`, `.input`, combobox `.combo` + `.suggest` / `.sug` (navigation clavier), bascules `.toggle`, choix `.pick`, onglets `.catTab`, pastilles `.chip`, sélecteur `.sectorPicker` |
| Contenu | carte lieu `.place`, ticket de bon de passage `.ticket` (talon perforé coloré par secteur), document `.doc`, barre de secteurs `.sectorBar`, statistiques `.stat` |
| Actions | `.btn` (`--primary`, `--signal`, `--line`, `--quiet`, `--danger`), `.linkBtn`, `.iconBtn`, `.actionBar`, `.sendBar` |
| Retours d'état | `.toast` (avec action « Annuler »), `.banner` (hors ligne, mise à jour), état vide `.reportEmpty`, modale `dialog.modal`, feuille `dialog.sheet`, `.switch` |
| Carte (`map.css`) | `.mapHud`, `.mapTools` / `.mapBtn`, `.mapPick`, marqueurs `.marker.pin` / `.target` / `.me` / `.probe` |

## Règles

1. Un composant ne consomme que des tokens.
2. Toute couleur de texte vérifie au moins 4.5:1. L'audit axe-core (WCAG 2 A/AA et bonnes pratiques) ne relève aucune violation.
3. Chaque animation répond à une question de l'agent : « ai-je changé d'étape ? », « est-ce enregistré ? », « où est-ce ? ».
4. Le format du message est figé : voir `js/mail.js` et `js/bp.js`.
