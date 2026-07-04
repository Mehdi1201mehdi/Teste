# 📡 Price Radar

Détecteur d'**erreurs de prix**, de **grosses différences de prix**, de
**promotions anormales** et de produits à **forte marge potentielle** sur
plusieurs sites e-commerce.

Construit autour du skill de scraping du repo
(`.agents/skills/web-scraping`) : cascade `requests` → Playwright + stealth,
détection de poison pills (captcha, Cloudflare, 403/429), délais polis par
domaine, rotation de User-Agents et respect de robots.txt.

## Architecture

```
price-radar/
├── run.py                     # Lancement du serveur
├── seed.py                    # Données de test (12 produits, 30 j d'historique)
├── requirements.txt
├── .env.example               # Variables d'environnement (à copier en .env)
├── app/
│   ├── main.py                # FastAPI + fichiers statiques
│   ├── config.py              # Configuration (.env)
│   ├── database.py            # SQLAlchemy + SQLite
│   ├── models.py              # users, products, price_checks, websites,
│   │                          # alerts, categories, scraping_jobs, settings
│   ├── scheduler.py           # Tâches automatiques (APScheduler)
│   ├── routers/api.py         # API REST complète
│   ├── scraping/              # ← construit sur le skill web-scraping
│   │   ├── cascade.py         # requests → Playwright stealth, avec escalade
│   │   ├── extractor.py       # JSON-LD / OpenGraph / CSS / regex prix
│   │   ├── poison.py          # captcha, rate-limit, Cloudflare, 404…
│   │   └── polite.py          # délais par domaine, UA tournants, backoff,
│   │                          # robots.txt, proxy optionnel
│   └── services/
│       ├── opportunity.py     # prix marché, score 0-100, niveau, risque, marge
│       ├── alerts.py          # dashboard + email + Telegram + Discord, seuils
│       └── watcher.py         # vérification produit, anti-doublons, logs
└── static/                    # SPA (dashboard, opportunités, produits,
                               # détail + graphique, alertes, paramètres, logs)
```

**Stack** : Python 3.11+, FastAPI, SQLite (zéro config, remplaçable par
PostgreSQL via `DATABASE_URL`), APScheduler, front vanilla JS + Chart.js.

## Installation

```bash
cd price-radar
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # puis ajustez si besoin
```

### Données de test (interface utilisable immédiatement)

```bash
python seed.py          # 12 produits, ~370 relevés, alertes, opportunités
python seed.py --reset  # repart de zéro
```

### Lancement

```bash
python run.py
# → http://localhost:8000        (interface)
# → http://localhost:8000/docs   (API interactive Swagger)
```

## Comment ça marche

### Détection des erreurs de prix

Pour chaque relevé, le **prix moyen du marché** est déterminé ainsi :
1. valeur saisie manuellement sur le produit (prioritaire) ;
2. sinon moyenne des prix des produits partageant le même **EAN**
   (concurrents suivis) + l'**historique** du produit (30 derniers relevés,
   anciens prix barrés inclus).

Puis on calcule :

```
écart %        = (prix marché − prix trouvé) / prix marché × 100
marge estimée  = prix marché − prix trouvé − frais de livraison
```

**Score d'opportunité (0-100)** : écart > 30 % (+30), > 50 % (+45),
> 70 % (+60), baisse brutale ≥ 25 % vs relevé précédent (+15), en stock
(+10), site/vendeur fiable (+10), livraison connue (+5).

**Niveau** : `faible` / `moyen` (≥ 30 %) / `fort` (≥ 50 %) /
`exceptionnel` (≥ 70 % ou score ≥ 85).

**Risque** : `élevé` (écart ≥ 85 %, vendeur inconnu ou rupture),
`moyen` (moins de 3 relevés, stock inconnu), `faible` sinon.

### Alertes

Seuils personnalisables dans **Paramètres** (ou `.env`) :
- écart supérieur à X % (défaut 40),
- marge estimée supérieure à X € (défaut 100),
- uniquement si produit en stock (défaut oui).

Canaux : notification dashboard (toujours), **email SMTP**, **Telegram**,
**Discord** — activés dès que les variables `.env` correspondantes sont
renseignées. Anti-doublon : pas deux alertes de même niveau pour le même
produit en 24 h.

### Surveillance automatique

Le scheduler vérifie chaque minute quels produits sont « dus » selon leur
fréquence (1 h / 6 h / 12 h / 24 h, réglable par produit) et les scrape
séquentiellement en respectant les délais par domaine — jamais de rafale
sur un même site.

### Brancher / étendre le scraping

- Le point d'entrée unique est `app/scraping/cascade.py`
  (`cascade.fetch(url)`). Pour brancher votre propre scraper, ajoutez une
  classe avec une méthode `fetch(url) -> (ExtractedProduct | None, erreur)`
  dans la liste `steps`.
- Sites JS-heavy : cochez « Site JS (Playwright) » sur le site, installez
  `playwright` + `playwright-stealth`, puis `playwright install chromium`
  et passez `USE_PLAYWRIGHT_FALLBACK=true`.
- Proxy : `SCRAPE_PROXY=http://user:pass@host:port`.

### Pool de proxies publics

Page **Proxies** (panneau admin) + `app/proxies/`. Pipeline complet :

1. **Téléchargement** de toutes les sources actives (`proxy_sources.json`,
   éditable aussi depuis l'UI).
2. **Fusion + déduplication** sur la clé `protocol://host:port`.
3. **Détection automatique du protocole** (schéma explicite dans la ligne,
   sinon protocole déclaré par la source).
4. **Test concurrent** (`ThreadPoolExecutor`) contre `PROXY_TEST_URL`.
5. **Scoring 0-100** basé sur la latence et la fiabilité historique.
6. **Persistance** en base (tables `proxies`, `proxy_sources`).
7. **Purge** des proxies morts après `PROXY_MAX_FAILS` échecs.
8. **Rafraîchissement automatique** toutes les `PROXY_REFRESH_MINUTES`
   (si `PROXY_POOL_ENABLED=true`), ou à la demande via le bouton
   « Rafraîchir maintenant » / `POST /api/proxies/refresh`.

Sources livrées par défaut (dans `proxy_sources.json`, ajout/suppression
depuis l'UI) : ProxyScrape, TheSpeedX, Monosans, ShiftyTR,
Proxy-List-Download, OpenProxyList — en HTTP / HTTPS / SOCKS4 / SOCKS5.

Quand le pool est actif, chaque requête de scraping tire un proxy vivant
bien noté parmi les 20 meilleurs (rotation). Les proxies SOCKS nécessitent
`requests[socks]` (déjà dans `requirements.txt`). Les listes contiennent
des milliers d'entrées : `PROXY_TEST_LIMIT` borne le nombre testé par
cycle.

| Méthode | Route | Description |
|---|---|---|
| GET/POST | `/api/proxies/sources` | Lister / ajouter une source |
| PUT/DELETE | `/api/proxies/sources/{id}` | Activer-désactiver / supprimer |
| GET | `/api/proxies` | Proxies vivants (filtre protocole) |
| GET | `/api/proxies/stats` | Compteurs, latence, protocoles |
| POST | `/api/proxies/refresh` | Lancer un cycle complet |

### Conformité

- `robots.txt` respecté par défaut (`RESPECT_ROBOTS_TXT=true`).
- Délais aléatoires 2–5 s par domaine, backoff exponentiel sur 403/429.
- Détection captcha/Cloudflare → le job est loggé `blocked`, pas de retry agressif.
- Un produit bloqué reste utilisable via la **saisie manuelle de prix**
  (`POST /api/products/{id}/price`).
- Restez raisonnable sur la fréquence de vérification ; les CGU de
  certains sites interdisent le scraping (risque civil, pas pénal — voir
  la section légale du skill).

## API principale

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/dashboard` | Stats + top opportunités |
| GET | `/api/opportunities` | Filtres : catégorie, site, niveau, marge, écart, prix, stock, date, tri |
| POST | `/api/products` | Ajouter une surveillance (scrape immédiat) |
| PATCH/DELETE | `/api/products/{id}` | Modifier / supprimer |
| POST | `/api/products/{id}/check` | Vérifier maintenant |
| GET | `/api/products/{id}/history` | Historique + stats min/max/moyenne |
| POST | `/api/scrape/preview` | Tester l'extraction d'une URL sans enregistrer |
| GET/PUT | `/api/settings` | Seuils d'alerte |
| GET | `/api/alerts`, `/api/logs` | Alertes, logs scraping |
