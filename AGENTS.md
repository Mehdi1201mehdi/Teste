# AGENTS.md — Règles de qualité de code (CodeScene MCP)

> Ce dépôt utilise le serveur MCP **CodeScene** (`@codescene/codehealth-mcp`)
> pour garder un code sain. Ces règles s'appliquent à tout agent autonome
> (Claude Code, etc.) qui modifie le code. Elles peuvent aussi être copiées
> dans `CLAUDE.md`.

## Outils MCP disponibles

| Outil | Quand l'utiliser |
|---|---|
| `code_health_review` | **Avant** de modifier un fichier |
| `code_health_score` | **Après chaque modification** (mesurer le delta) |
| `pre_commit_code_health_safeguard` | **Avant** de valider (commit) |
| `analyze_change_set` | **Avant** une pull request |

## Boucle de travail imposée

1. **Avant d'éditer un fichier** → `code_health_review` sur ce fichier pour
   connaître le score de référence et les points chauds.
2. **Une modification à la fois** → une seule responsabilité par changement
   (un helper, une condition aplatie, séparer validation et routage…).
3. **Après chaque modification** → `code_health_score` et compare le delta.
   - Delta **stable** malgré un refactor : change d'approche (aplatir une
     condition, séparer validation/routage), une seule modif, puis recalcule.
   - Score **en dessous de la référence** : corrige avant d'aller plus loin.
4. **Ne pas commiter tant que** `pre_commit_code_health_safeguard` n'est pas
   au vert. « Les tests passent » ne suffit pas : lance d'abord le score.
5. **Avant une PR** → `analyze_change_set`.

## Garde-fous

- **Périmètre serré** : si un changement dérive sur 5–7 fichiers, stop.
  Reviens à `code_health_review` sur le fichier concerné uniquement,
  score après chaque modif.
- **Zone d'alerte (~7)** : prochaine modif = un helper, une responsabilité.
  Évaluer (`code_health_score`) avant de valider.
- Ne jamais commiter un jeton/clé en clair. Le jeton CodeScene est
  **requis** (vérifié : sans lui, les outils répondent « No access token
  configured »). Récupère un jeton **gratuit**
  (`docs/getting-a-personal-access-token.md` du dépôt CodeScene), puis
  expose-le via la variable d'environnement `CS_ACCESS_TOKEN`. Jamais dans
  le dépôt.
