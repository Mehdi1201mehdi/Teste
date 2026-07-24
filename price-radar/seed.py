"""Génère des données de test réalistes pour essayer l'interface sans
brancher le scraping : 3 sites, 4 catégories, 12 produits, 30 jours
d'historique de prix, plusieurs grosses opportunités et alertes.

Usage : python seed.py [--reset]
"""
import random
import sys
from datetime import datetime, timedelta

from app import models
from app.database import Base, SessionLocal, engine
from app.services import alerts as alert_service
from app.services.opportunity import evaluate

random.seed(42)


WEBSITES = [
    {"name": "TechDeal", "domain": "techdeal.example", "trusted": True},
    {"name": "MegaShop", "domain": "megashop.example", "trusted": True},
    {"name": "PromoStore", "domain": "promostore.example", "trusted": False},
]

CATEGORIES = ["High-tech", "Électroménager", "Gaming", "Bricolage"]

# (nom, catégorie, prix marché, prix final ~= marché * ratio, ean)
PRODUCTS = [
    ("Casque sans fil Sony WH-1000XM5", "High-tech", 349.0, 0.28, "4548736132566"),
    ("iPhone 15 Pro 256 Go", "High-tech", 1229.0, 0.55, "0195949036558"),
    ("TV OLED LG 55\" C4", "High-tech", 1290.0, 0.42, "8806091985702"),
    ("Robot pâtissier KitchenAid Artisan", "Électroménager", 649.0, 0.31, "5413184010393"),
    ("Aspirateur Dyson V15 Detect", "Électroménager", 699.0, 0.63, "5025155057353"),
    ("Lave-linge Bosch Série 6", "Électroménager", 799.0, 0.87, "4242005298764"),
    ("PS5 Slim édition standard", "Gaming", 549.0, 0.49, "0711719577294"),
    ("Manette Xbox Elite Series 2", "Gaming", 179.0, 0.72, "0889842196367"),
    ("PC portable ASUS ROG RTX 4070", "Gaming", 1799.0, 0.24, "4711387301234"),
    ("Perceuse-visseuse Makita 18V", "Bricolage", 229.0, 0.58, "0088381898765"),
    ("Station énergie EcoFlow Delta 2", "Bricolage", 999.0, 0.36, "4897082668436"),
    ("Nettoyeur haute pression Kärcher K5", "Bricolage", 329.0, 0.93, "4054278571234"),
]


def seed():
    if "--reset" in sys.argv:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(models.Product).count():
        print("La base contient déjà des données. Utilisez --reset pour repartir de zéro.")
        return

    sites = []
    for w in WEBSITES:
        site = models.Website(**w, min_delay=2.0)
        db.add(site)
        sites.append(site)

    cats = {}
    for name in CATEGORIES:
        cat = models.Category(name=name)
        db.add(cat)
        cats[name] = cat
    db.commit()

    now = datetime.utcnow()
    for idx, (name, cat_name, market, final_ratio, ean) in enumerate(PRODUCTS):
        site = sites[idx % len(sites)]
        slug = name.lower().replace(" ", "-").replace('"', "")[:50]
        product = models.Product(
            name=name,
            url=f"https://{site.domain}/produit/{slug}",
            image_url=f"https://picsum.photos/seed/product{idx}/400/400",
            ean=ean,
            seller=site.name,
            category_id=cats[cat_name].id,
            website_id=site.id,
            market_price=market,
            market_price_auto=False,
            check_frequency_minutes=360,
            active=True,
        )
        db.add(product)
        db.commit()

        # 30 jours d'historique : prix stable autour du marché, puis chute
        # progressive (ou brutale) vers le prix final pour les opportunités.
        final_price = round(market * final_ratio, 2)
        for day in range(30, -1, -1):
            date = now - timedelta(days=day, hours=random.randint(0, 5))
            if day > 3:
                price = round(market * random.uniform(0.94, 1.06), 2)
            elif day > 0:
                price = round(market * random.uniform(0.85, 0.98), 2)
            else:
                price = final_price  # relevé du jour = l'opportunité
            availability = "in_stock" if random.random() > 0.08 else "out_of_stock"
            if day == 0:
                availability = "in_stock" if final_ratio < 0.9 else availability
            shipping = random.choice([0.0, 0.0, 4.99, 9.99])
            old_price = round(market * 1.05, 2) if day == 0 and final_ratio < 0.6 else None

            result = evaluate(db, product, price, shipping, availability)
            check = models.PriceCheck(
                product_id=product.id, price=price, old_price=old_price,
                shipping_cost=shipping, availability=availability,
                method="seed", market_price=result.market_price,
                gap_eur=result.gap_eur, gap_percent=result.gap_percent,
                margin_eur=result.margin_eur, margin_percent=result.margin_percent,
                score=result.score, opportunity_level=result.level,
                risk_level=result.risk,
            )
            db.add(check)
            db.flush()
            check.created_at = date
            db.commit()

            if day == 0:
                product.last_price = price
                product.last_old_price = old_price
                product.last_shipping = shipping
                product.last_availability = availability
                product.last_checked_at = date
                db.commit()
                if result.level in ("fort", "exceptionnel"):
                    alert_service.create_alert(db, product, check, result)

        # Quelques logs de scraping factices
        db.add(models.ScrapingJob(product_id=product.id, url=product.url,
                                  status="success", method="requests",
                                  duration_ms=random.randint(400, 2500)))
    db.add(models.ScrapingJob(url="https://blocked.example/produit/x",
                              status="blocked", method="requests",
                              error="blocked:captcha:Motif : captcha",
                              duration_ms=1200))
    db.commit()

    n_alerts = db.query(models.Alert).count()
    print(f"✅ Seed terminé : {len(PRODUCTS)} produits, "
          f"{db.query(models.PriceCheck).count()} relevés de prix, "
          f"{n_alerts} alertes.")
    db.close()


if __name__ == "__main__":
    seed()
