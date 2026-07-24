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

### Lancement

L'application démarre **vide** (aucune donnée fictive) et synchronise
automatiquement les vrais sites e-commerce (connecteurs) dans sa base. Tu
ajoutes ensuite des produits par URL, par recherche mot-clé ou par
découverte de catégorie.

> `seed.py` existe uniquement pour une **démo hors ligne** de l'interface
> (données factices). Ne l'utilise pas pour de la vraie veille tarifaire.


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

### Connecteurs e-commerce (un module par enseigne)

Chaque site a **son propre connecteur indépendant** dans
`app/connectors/<site>.py`. Enseignes fournies : Amazon, Cdiscount, Fnac,
Darty, Boulanger, Carrefour, Auchan, E.Leclerc, Leroy Merlin, Castorama,
ManoMano, Rakuten, Rue du Commerce, LDLC, Materiel.net, Electro Dépôt,
AliExpress, eBay — plus un connecteur **générique** (schema.org) pour tout
autre site.

Chaque connecteur déclare : domaines gérés, URL de recherche, motifs d'URL
produit, besoin de JavaScript (Playwright), délai entre requêtes, fiabilité
du vendeur. La logique commune (requêtes polies, backoff, rotation de proxy,
détection de blocage, journalisation, gestion des changements de structure
via `parse()` surchargeable) est dans `BaseConnector`.

Les connecteurs sont **auto-enregistrés** (`@register`) et synchronisés dans
la table `websites` au démarrage : l'app liste les vrais sites sans aucune
donnée produit fictive.

**Ajouter un site** (sans toucher au reste de l'app) :

```python
# app/connectors/monsite.py
from .base import BaseConnector
from .registry import register

@register
class MonSiteConnector(BaseConnector):
    name = "monsite"
    label = "Mon Site"
    domains = ("monsite.fr",)
    search_url_template = "https://www.monsite.fr/recherche?q={query}"
    product_url_patterns = ("/produit/",)
    needs_playwright = False   # True si le site charge ses prix en JS
    # Surcharger parse(html, url) uniquement si schema.org ne suffit pas
```

Puis l'ajouter à la liste d'imports de `app/connectors/__init__.py`. Le
supprimer = retirer le fichier et sa ligne d'import. Tests : `pytest -q`.

> ⚠️ **Réalité du scraping.** Les enseignes fournies contiennent de vraies
> URLs de recherche et une vraie extraction (la plupart exposent
> schema.org/JSON-LD : nom, prix, ancien prix, réduction, disponibilité,
> marque, EAN, image, référence). MAIS les sites les plus protégés (Amazon,
> Cdiscount, AliExpress, la grande distribution…) bloquent activement le
> scraping : ils exigent Playwright + des **proxies résidentiels** et
> peuvent renvoyer des blocages ou changer de structure. C'est inhérent au
> domaine. Active `USE_PLAYWRIGHT_FALLBACK=true`, le pool de proxies, et
> commence par les sites les plus « scrapables » (LDLC, Materiel.net,
> eBay, Electro Dépôt) pour valider ta configuration. Respecte les CGU et
> les limites techniques des sites.

### Module « Sources API gratuites » (page dédiée)

Un catalogue de **110 sources** (API officielles, open data, free tier,
frameworks) piloté par `sources.config.json`, avec un **connecteur générique
REST** qui teste, collecte, normalise et exporte — sans casser l'existant.

**Catégories** : scraping, frameworks, recherche/SERP, open-data,
géolocalisation, e-commerce, actualités, social, météo/environnement,
finance/crypto, utilitaires.

**Ce que fait la page** : filtre par catégorie + recherche, badges
Gratuit / Free tier / Open source / Open data, boutons **Tester**,
**Collecter**, **Activer/Désactiver**, **Export JSON/CSV/Excel**, champ clé
API (stockée côté serveur, **jamais réaffichée**), logs & historique en
temps réel.

**Sécurité** : clés lues depuis `.env` (ou saisies puis stockées côté
serveur), jamais renvoyées au frontend ni écrites dans les logs (masquage).
Rate-limit par source, timeout, retry + backoff, gestion propre des erreurs
HTTP 401/403/404/429/500 avec proposition d'**alternative sans clé**. On ne
contourne **jamais** Cloudflare/DataDome/CAPTCHA : un blocage renvoie une
erreur claire + l'alternative.

**Ajouter une source** = une entrée dans `sources.config.json` :

```jsonc
// exemple SANS clé (fonctionne immédiatement)
{ "id": "open-meteo", "name": "Open-Meteo", "category": "weather",
  "freeType": "free", "baseUrl": "https://api.open-meteo.com/v1",
  "authType": "none", "envKey": "", "kind": "api",
  "test": { "path": "/forecast?latitude=49.9&longitude=2.3&current=temperature_2m" } }

// exemple AVEC clé (renseigne OPENWEATHER_API_KEY dans .env)
{ "id": "openweathermap", "name": "OpenWeatherMap", "category": "weather",
  "freeType": "free-tier", "baseUrl": "https://api.openweathermap.org/data/2.5",
  "authType": "api-key", "envKey": "OPENWEATHER_API_KEY", "kind": "api",
  "test": { "path": "/weather?q=Amiens", "auth_in": "query", "auth_param": "appid" },
  "alternative": "open-meteo" }
```

Aucun code à écrire : le connecteur générique (`app/datasources/base.py`)
gère `testConnection()`, `fetchData()`, `normalizeData()`, `errorHandler()`,
l'injection de clé (query/header), le rate-limit et le backoff.

**Endpoints :** `GET /api/datasources`, `GET /api/datasources/categories`,
`POST /api/datasources/{id}/test`, `POST /api/datasources/{id}/collect`,
`PUT /api/datasources/{id}/toggle`, `POST /api/datasources/keys`,
`GET /api/datasources/logs`, `GET /api/datasources/{id}/export?format=json|csv|xlsx`.

### Baisses du jour (flux de bons plans + rétro-ingénierie)

Page *Baisses du jour* (`app/pricewatch/deals.py`, `deals_sources.json`).
Au lieu de scraper Amazon/Cdiscount (protégés), on lit des **sources
publiques** qui republient déjà légalement leurs grosses promos :

- **Flux RSS** de sites de bons plans (Dealabs par catégorie…) — `type: "rss"`.
- **API JSON interne** d'un site de deals, obtenue par **rétro-ingénierie**
  légitime — `type: "json"` + un `map` de champs.

Le moteur extrait produit + prix + ancien prix + % + marchand, filtre par
seuil et marchand, classe par plus forte baisse, exporte (CSV/Excel/JSON).
Un flux mort → « non disponible », jamais de plantage. **Aucune clé, aucun
site protégé scrapé, aucun CAPTCHA/DataDome contourné.**

**Rétro-ingénierie propre d'une source JSON** (technique légitime : on lit
une API publique que le site appelle lui-même, on ne défait aucune
protection) :

1. Ouvre le site de deals dans Chrome → **F12** → onglet **Réseau** →
   filtre **Fetch/XHR**.
2. Recharge / scrolle la page ; repère la requête qui renvoie les deals en
   **JSON**.
3. Copie son **URL** dans `deals_sources.json` (`type: "json"`) et remplis
   `map` avec les chemins des champs (ex. `"items": "data.deals"`,
   `"price": "price.current"`).

C'est plus propre que le RSS (données structurées, EAN, catégorie). Si un
site sert un CAPTCHA/DataDome, il est hors périmètre — on ne force pas.

Endpoints : `GET /api/pricewatch/deals`, `GET /api/pricewatch/deals/export`.

### Connecteurs d'API officielles (page *Comparateur*)

En parallèle du scraping, une couche **API officielles / flux publics** dans
`app/apiconnectors/` — un module indépendant par API, auto-enregistré,
avec cache (Redis ou mémoire), quotas (délai mini entre appels), gestion
d'erreurs et journalisation dans `APIConnector`.

| Connecteur | Type | Clé | Fournit |
|---|---|---|---|
| Open Food / Beauty / Pet Food / Products Facts | catalogue | non | nom, marque, catégorie, image, EAN |
| UPCitemDB | catalogue | trial gratuit | métadonnées + offres |
| Barcode Lookup | catalogue | oui | métadonnées + magasins/prix |
| eBay Browse API | prix | oui (OAuth) | offres neuf/occasion |
| Amazon PA-API v5 | prix | oui (signé SigV4) | articles Amazon |
| AliExpress Open Platform | prix | oui (signé) | produits AliExpress |
| Google Merchant / Content API | catalogue | oui (OAuth) | ton catalogue marchand |
| OpenStreetMap Nominatim / Overpass | géo | non | localisation des enseignes |

Les connecteurs à clé sont **désactivés proprement** tant que les variables
`.env` ne sont pas renseignées (`configured = false`) — aucun appel n'est
tenté. Renseigne les clés dans `.env` pour les activer.

**Endpoints :**

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/api-connectors` | Liste + statut de configuration |
| GET | `/api/compare?q=…` | Compare les offres des API prix : min/max/moyenne/économie/% |
| GET | `/api/barcode/{ean}` | Enrichit un produit par code-barres (bases ouvertes + offres) |

> Les clés Amazon/eBay/AliExpress se signent/authentifient réellement dans le
> code (SigV4, OAuth client_credentials, HMAC). Les appels réseau réels
> tournent sur ta machine avec tes clés ; le parsing des réponses est
> couvert par les tests hors-ligne (`pytest`) sur des payloads réels.

### Docker

```bash
cp .env.example .env         # renseigne tes clés API
docker compose up -d --build
# → http://localhost:8000  (app + PostgreSQL + Redis)
```

Sans Docker, l'app fonctionne en SQLite + cache mémoire. Avec Docker Compose,
elle bascule automatiquement sur PostgreSQL (`DATABASE_URL`) et Redis
(`REDIS_URL`).

### Recherche & découverte de produits

Deux façons de trouver des produits automatiquement, **sur les sites
couverts par un connecteur** (il n'existe pas de recherche « sur tout
internet ») :

1. **Recherche multi-sites par mot-clé** (page *Recherche multi-sites*).
   Renseigne pour chaque site un *modèle d'URL de recherche* avec le
   placeholder `{query}` (ex : `https://boutique.fr/recherche?q={query}`).
   Tu tapes un mot-clé → le programme interroge chaque site, extrait les
   fiches produits des résultats, les scrape et compare les prix.
   Option « ajouter à la surveillance » pour tout suivre ensuite.

2. **Découverte depuis une page catégorie** (bouton *Découvrir* sur une
   catégorie ayant une `watch_url`). Le programme lit la page rayon,
   découvre les liens produits et les met sous surveillance.

L'extraction des liens produits est heuristique (JSON-LD `ItemList`,
chemins de type `/produit/…`, cartes produit), limitée au domaine du site.
La qualité dépend du site : certains chargent leurs résultats en
JavaScript (cocher *Site JS*) ou bloquent le scraping.

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/connectors` | Liste des connecteurs e-commerce disponibles |
| POST | `/api/search` | Recherche mot-clé multi-sites |
| POST | `/api/categories/{id}/discover` | Découverte depuis une page catégorie |

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

Sources livrées par défaut (dans `proxy_sources.json`, ~29 entrées,
ajout/suppression depuis l'UI) : ProxyScrape **v4**, **Geonode** (API JSON),
TheSpeedX, Monosans, ShiftyTR, Proxy-List-Download, OpenProxyList,
**iplocate**, **Proxifly**, **jetkai**, **hookzof**, **clarketm**, **mmpx12**
— en HTTP / HTTPS / SOCKS4 / SOCKS5.

Deux formats de source sont gérés : `text` (liste `ip:port`, avec ou sans
schéma) et `geonode` (réponse JSON de l'API Geonode, multi-protocole). Le
champ `format` est réglable par source (fichier ou panneau admin). Bouton
**« Recharger depuis le fichier »** pour importer de nouvelles sources sans
perdre tes réglages.

**Vérification d'IP** (page Proxies → *Vérifier mon IP*) : confirme quelle IP
publique sert au scan (directe ou via un proxy), avec géolocalisation —
via les API gratuites ipify + ip-api. Endpoint `GET /api/proxies/ip-check`.

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

### Anti-bot : échelle de furtivité (et ce qui est volontairement exclu)

Le scraping monte en puissance seulement autant que nécessaire :

1. **`requests` + rotation d'UA/headers + délais polis** — sites non protégés.
2. **`curl_cffi`** (`USE_CURL_CFFI=true`, activé par défaut) — imite l'empreinte
   **TLS/JA3** d'un vrai Chrome. Débloque les sites qui filtrent au niveau TLS
   sans exécuter de JavaScript ni résoudre de challenge.
3. **Navigateur furtif interchangeable** (`USE_PLAYWRIGHT_FALLBACK=true`,
   `PLAYWRIGHT_ENGINE=…`) — sites rendus en JavaScript. Moteurs au choix,
   avec repli automatique si l'un n'est pas installé :
   - `stealth` : Playwright + `playwright-stealth` (défaut)
   - `patchright` : Playwright patché anti-détection (drop-in)
   - `camoufox` : Firefox furtif (fingerprint au niveau C++)
   - `plain` : Playwright sans furtivité

   Installe le moteur choisi puis son navigateur, ex. :
   `pip install patchright && patchright install chromium`, ou
   `pip install camoufox[geoip] && camoufox fetch`.
4. **Pool de proxies** (idéalement résidentiels) — réputation d'IP.

> La furtivité navigateur (niveau 3) augmente tes chances sur les sites
> **moyennement** protégés. Contre DataDome / Cloudflare Turnstile des gros
> sites, elle ne suffit pas seule : il faut la combiner au niveau 4
> (proxies résidentiels), et même là c'est fragile et à ré-entretenir.

Ces quatre niveaux relèvent de la **furtivité** : paraître un visiteur
normal pour lire des **prix publics**. C'est l'approche recommandée par le
skill de scraping du dépôt.

**Volontairement NON intégré** : les services/outils qui **résolvent
activement un challenge Cloudflare/DataDome ou un CAPTCHA**
(ex. *scrapingbypass*, *FlareSolverr*, solveurs de CAPTCHA payants).
Défaire une mesure technique d'accès sort du cadre de la simple furtivité :
c'est juridiquement risqué (contournement de contrôle d'accès, cf. CFAA) et
contraire aux CGU des sites. Si un site sert un challenge Turnstile ou une
interstitielle DataDome, considère-le comme non scrapable par cet outil —
n'essaie pas de forcer.

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
