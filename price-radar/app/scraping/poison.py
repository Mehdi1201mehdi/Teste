"""Détection de « poison pills » : captcha, rate-limit, Cloudflare, login…
Repris du skill web-scraping."""
import re
from dataclasses import dataclass
from enum import Enum


class PoisonPillType(Enum):
    PAYWALL = "paywall"
    CAPTCHA = "captcha"
    RATE_LIMIT = "rate_limit"
    CLOUDFLARE = "cloudflare"
    LOGIN_REQUIRED = "login_required"
    NOT_FOUND = "not_found"
    NONE = "none"


@dataclass
class PoisonPillResult:
    detected: bool
    type: PoisonPillType
    confidence: float
    details: str


class PoisonPillDetector:
    PATTERNS = {
        PoisonPillType.CAPTCHA: [
            r"verify you are human",
            r"captcha",
            r"robot verification",
            r"prove you'?re not a robot",
            r"êtes[- ]vous un robot",
            r"vérification de sécurité",
        ],
        PoisonPillType.RATE_LIMIT: [
            r"too many requests",
            r"rate limit exceeded",
            r"slow down",
            r"trop de requêtes",
        ],
        PoisonPillType.CLOUDFLARE: [
            r"checking your browser",
            r"cloudflare",
            r"ddos protection",
            r"please wait while we verify",
            r"attention required",
        ],
        PoisonPillType.LOGIN_REQUIRED: [
            r"sign in to continue",
            r"log in required",
            r"connectez-vous pour continuer",
        ],
    }

    def detect(self, url: str, content: str, status_code: int = 200) -> PoisonPillResult:
        if status_code == 429:
            return PoisonPillResult(True, PoisonPillType.RATE_LIMIT, 1.0, "HTTP 429")
        if status_code == 403:
            return PoisonPillResult(True, PoisonPillType.CLOUDFLARE, 0.8, "HTTP 403")
        if status_code == 404:
            return PoisonPillResult(True, PoisonPillType.NOT_FOUND, 1.0, "HTTP 404")

        content_lower = (content or "").lower()
        # Une page produit fait rarement moins de 500 caractères de HTML
        if len(content_lower) < 500:
            return PoisonPillResult(
                True, PoisonPillType.CLOUDFLARE, 0.5, "Contenu anormalement court"
            )
        for pill_type, patterns in self.PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, content_lower):
                    return PoisonPillResult(True, pill_type, 0.7, f"Motif : {pattern}")
        return PoisonPillResult(False, PoisonPillType.NONE, 0.0, "")
