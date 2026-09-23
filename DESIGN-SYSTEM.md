# Brigade Verte — Design system « Relevé de terrain »

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
