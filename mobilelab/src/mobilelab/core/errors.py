"""Exceptions métier. Chaque erreur porte un message lisible et une piste d'action."""

from __future__ import annotations


class MobileLabError(Exception):
    """Erreur de base, affichable telle quelle à l'utilisateur."""

    def __init__(self, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint

    def __str__(self) -> str:
        return f"{self.message} — {self.hint}" if self.hint else self.message


class ToolNotFoundError(MobileLabError):
    """Un outil externe (adb, idevice_id…) est introuvable."""


class CommandError(MobileLabError):
    """Un outil externe a échoué ou a dépassé son délai."""


class UnsafePathError(MobileLabError):
    """Un chemin ou argument a été rejeté par la validation."""


class InsufficientSpaceError(MobileLabError):
    """Espace disque insuffisant à la destination."""


class ConfirmationRequiredError(MobileLabError):
    """Opération destructive appelée sans confirmation explicite."""


class EncryptedBackupError(MobileLabError):
    """Sauvegarde chiffrée : contenu non lisible sans déchiffrement autorisé."""
