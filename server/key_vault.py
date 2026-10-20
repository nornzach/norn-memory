"""A readable copy of each API key, so its owner can copy it again from the dashboard.

Requests are still checked against the bcrypt hash in api_keys.key_hash; this copy is only for showing
the key to the user who created it. It is encrypted (Fernet) with a key derived from JWT_SECRET, so a
database dump on its own doesn't give the keys away. If JWT_SECRET changes, the stored copies can no
longer be read: those keys keep working but can't be shown again, like keys created before copies were
kept.
"""

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_CONTEXT = b"norn-m api key storage\0"


def _fernet() -> Optional[Fernet]:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        return None
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(_CONTEXT + secret.encode("utf-8")).digest()))


def seal(key: str) -> Optional[str]:
    """The encrypted copy to store, or None when there is no JWT_SECRET to encrypt with."""
    fernet = _fernet()
    return fernet.encrypt(key.encode("utf-8")).decode("ascii") if fernet else None


def unseal(token: Optional[str]) -> Optional[str]:
    """The key from a stored copy, or None when there is none or it can't be read."""
    fernet = _fernet()
    if not token or fernet is None:
        return None
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
