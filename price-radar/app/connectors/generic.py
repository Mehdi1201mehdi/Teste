"""Connecteur générique : scrape n'importe quelle fiche produit exposant des
données schema.org / OpenGraph. Sert de repli pour tout site non couvert par
un connecteur dédié, et de base pour en ajouter un rapidement."""
from .base import BaseConnector
from .registry import register


@register
class GenericConnector(BaseConnector):
    name = "generic"
    label = "Générique (schema.org)"
    domains = ()
    search_url_template = ""   # pas de recherche : fiche produit uniquement
    trusted = False
