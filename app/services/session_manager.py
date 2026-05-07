from __future__ import annotations

"""Admin session manager for Bearer token authentication."""

import secrets
import time

from app.config import settings

_sessions: dict[str, dict] = {}


def create_session() -> str:
    """Create a new admin session and return the token."""
    token = secrets.token_hex(32)
    now = time.time() * 1000  # ms
    _sessions[token] = {
        "created_at": now,
        "expires_at": now + settings.admin_session_ttl_ms,
    }
    return token


def validate_session(token: str) -> bool:
    """Validate a session token."""
    session = _sessions.get(token)
    if not session:
        return False
    now = time.time() * 1000
    if now > session["expires_at"]:
        del _sessions[token]
        return False
    return True


def destroy_session(token: str) -> bool:
    """Destroy a session."""
    if token in _sessions:
        del _sessions[token]
        return True
    return False


def cleanup_expired_sessions() -> None:
    """Remove all expired sessions."""
    now = time.time() * 1000
    expired = [t for t, s in _sessions.items() if now > s["expires_at"]]
    for t in expired:
        del _sessions[t]
