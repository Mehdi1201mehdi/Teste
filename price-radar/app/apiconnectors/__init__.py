"""Framework de connecteurs d'API officielles / flux publics.

Ajouter une API = déposer un fichier `app/apiconnectors/<api>.py` (sous-classe
de `APIConnector` décorée `@register`) et l'importer ci-dessous. Le retirer =
supprimer le fichier et sa ligne d'import.
"""
from .base import APIConnector, APIOffer, APIProduct  # noqa: F401
from .registry import (all_api_connectors, by_name, catalog_sources,  # noqa: F401
                       price_sources, register)

# --- Import des modules d'API : déclenche leur enregistrement ---
from . import openfacts       # noqa: F401,E402  (4 connecteurs Open*Facts)
from . import upcitemdb       # noqa: F401,E402
from . import barcodelookup   # noqa: F401,E402
from . import ebay            # noqa: F401,E402
from . import amazon          # noqa: F401,E402
from . import aliexpress      # noqa: F401,E402
from . import googlemerchant  # noqa: F401,E402
from . import openstreetmap   # noqa: F401,E402  (Nominatim + Overpass)
