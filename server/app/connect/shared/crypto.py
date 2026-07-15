"""Envelope encryption for the Phase 1 token vault (spec §7.4).

Minimal stopgap, not the final HSM/KMS-backed vault: a single app-held Fernet
key (symmetric, authenticated) encrypts refresh/access tokens before they hit
the DB. `cryptography` is already a transitive dependency via
python-jose[cryptography], so this adds no new package.
"""
from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class TokenVaultMisconfigured(RuntimeError):
    pass


@lru_cache
def _fernet() -> Fernet:
    key = get_settings().token_vault_key
    if not key:
        raise TokenVaultMisconfigured("TOKEN_VAULT_KEY is not set")
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise TokenVaultMisconfigured("Token vault key cannot decrypt this value") from e
