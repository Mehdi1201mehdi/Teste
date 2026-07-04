"""Modèles SQLAlchemy : users, products, price_checks, websites, alerts,
categories, scraping_jobs, settings."""
from datetime import datetime

from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    name = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    # URL de catégorie à surveiller (listing e-commerce), optionnelle
    watch_url = Column(String, default="")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    products = relationship("Product", back_populates="category")


class Website(Base):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    domain = Column(String, unique=True, nullable=False)
    trusted = Column(Boolean, default=False)  # vendeur/site fiable
    active = Column(Boolean, default=True)
    min_delay = Column(Float, default=2.0)  # délai mini entre requêtes (s)
    needs_playwright = Column(Boolean, default=False)  # site JS-heavy
    # Modèle d'URL de recherche du site, avec {query} comme placeholder
    # ex : https://boutique.fr/recherche?q={query}
    search_url_template = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    products = relationship("Product", back_populates="website")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    name = Column(String, default="")
    url = Column(String, unique=True, nullable=False)
    image_url = Column(String, default="")
    ean = Column(String, default="")            # référence / EAN / SKU
    seller = Column(String, default="")
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=True)

    # Prix moyen du marché : saisi manuellement OU recalculé automatiquement
    market_price = Column(Float, nullable=True)
    market_price_auto = Column(Boolean, default=True)

    # Dernier état connu
    last_price = Column(Float, nullable=True)
    last_old_price = Column(Float, nullable=True)
    last_shipping = Column(Float, nullable=True)
    last_availability = Column(String, default="")

    # Surveillance
    active = Column(Boolean, default=True)
    check_frequency_minutes = Column(Integer, default=360)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    category = relationship("Category", back_populates="products")
    website = relationship("Website", back_populates="products")
    price_checks = relationship("PriceCheck", back_populates="product",
                                cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="product",
                          cascade="all, delete-orphan")


class PriceCheck(Base):
    __tablename__ = "price_checks"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    price = Column(Float, nullable=False)
    old_price = Column(Float, nullable=True)      # prix barré si présent
    shipping_cost = Column(Float, nullable=True)
    currency = Column(String, default="EUR")
    availability = Column(String, default="")     # in_stock / out_of_stock / unknown
    method = Column(String, default="")           # requests / playwright / seed...

    # Résultat de la détection au moment du relevé
    market_price = Column(Float, nullable=True)
    gap_eur = Column(Float, nullable=True)
    gap_percent = Column(Float, nullable=True)
    margin_eur = Column(Float, nullable=True)
    margin_percent = Column(Float, nullable=True)
    score = Column(Integer, default=0)            # 0-100
    opportunity_level = Column(String, default="faible")  # faible/moyen/fort/exceptionnel
    risk_level = Column(String, default="moyen")  # faible/moyen/eleve

    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="price_checks")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    price_check_id = Column(Integer, ForeignKey("price_checks.id"), nullable=True)
    title = Column(String, default="")
    message = Column(Text, default="")
    level = Column(String, default="moyen")  # niveau d'opportunité déclencheur
    read = Column(Boolean, default=False)
    sent_email = Column(Boolean, default=False)
    sent_telegram = Column(Boolean, default=False)
    sent_discord = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="alerts")


class ScrapingJob(Base):
    __tablename__ = "scraping_jobs"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    url = Column(String, default="")
    status = Column(String, default="pending")  # pending/success/error/blocked
    method = Column(String, default="")
    error = Column(Text, default="")
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(Text, default="")


class ProxySource(Base):
    __tablename__ = "proxy_sources"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    url = Column(String, nullable=False)
    protocol = Column(String, default="http")  # http/https/socks4/socks5/auto
    enabled = Column(Boolean, default=True)
    last_fetched_at = Column(DateTime, nullable=True)
    last_count = Column(Integer, default=0)     # proxies récupérés au dernier fetch
    last_error = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Proxy(Base):
    __tablename__ = "proxies"

    id = Column(Integer, primary_key=True)
    # clé logique unique : "protocol://host:port"
    key = Column(String, unique=True, nullable=False)
    protocol = Column(String, default="http")
    host = Column(String, nullable=False)
    port = Column(Integer, nullable=False)
    source = Column(String, default="")

    alive = Column(Boolean, default=False)
    latency_ms = Column(Integer, nullable=True)
    score = Column(Integer, default=0)          # 0-100
    success_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    @property
    def url(self) -> str:
        scheme = "socks5" if self.protocol == "socks5" else \
                 "socks4" if self.protocol == "socks4" else \
                 self.protocol
        return f"{scheme}://{self.host}:{self.port}"
