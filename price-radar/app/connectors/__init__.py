"""Framework de connecteurs e-commerce.

Ajouter un site = déposer un fichier `app/connectors/<site>.py` déclarant une
sous-classe de `BaseConnector` décorée par `@register`, puis l'importer
ci-dessous. Le supprimer = retirer le fichier et sa ligne d'import. Aucune
autre partie de l'application n'a besoin d'être modifiée.
"""
from .base import BaseConnector, FetchResult  # noqa: F401
from .registry import (all_connectors, by_name, for_domain,  # noqa: F401
                       for_url, register)

# --- Import des modules de site : déclenche leur enregistrement ---
from . import generic  # noqa: F401,E402
from . import (amazon, cdiscount, fnac, darty, boulanger, carrefour,  # noqa: F401,E402
               auchan, leclerc, leroymerlin, castorama, manomano, rakuten,
               rueducommerce, ldlc, materielnet, electrodepot, aliexpress, ebay)


def sync_connectors_to_db(db) -> int:
    """Crée/actualise une entrée `websites` pour chaque connecteur enregistré,
    afin que l'UI liste les vrais sites (sans aucune donnée produit fictive)."""
    from .. import models

    count = 0
    for connector in all_connectors():
        domain = connector.domains[0] if connector.domains else ""
        if not domain:
            continue  # connecteur générique : pas de site à lister
        site = db.query(models.Website).filter(
            models.Website.domain == domain).first()
        if site is None:
            site = models.Website(name=connector.label, domain=domain)
            db.add(site)
            count += 1
        # On (re)synchronise les métadonnées issues du connecteur
        site.name = connector.label
        site.search_url_template = connector.search_url_template
        site.needs_playwright = connector.needs_playwright
        site.min_delay = connector.min_delay
        site.trusted = connector.trusted
    db.commit()
    return count
