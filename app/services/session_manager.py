"""Admin session manager for Bearer token authentication."""

from __future__ import annotations

import secrets
import time

from app.config import settings


class SessionManager:
    """Encapsulated admin session state — no module-level globals.

    All session data is instance-level, making it testable and safe
    in multi-instance scenarios.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, dict] = {}

    def create_session(self) -> str:
        """Create a new admin session and return the token."""
        token = secrets.token_hex(32)
        now = time.time() * 1000  # ms
        self._sessions[token] = {
            "created_at": now,
            "expires_at": now + settings.admin_session_ttl_ms,
        }
        return token

    def validate_session(self, token: str) -> bool:
        """Validate a session token."""
        session = self._sessions.get(token)
        if not session:
            return False
        now = time.time() * 1000
        if now > session["expires_at"]:
            del self._sessions[token]
            return False
        return True

    def destroy_session(self, token: str) -> bool:
        """Destroy a session."""
        if token in self._sessions:
            del self._sessions[token]
            return True
        return False

    def cleanup_expired(self) -> None:
        """Remove all expired sessions."""
        now = time.time() * 1000
        expired = [t for t, s in self._sessions.items() if now > s["expires_at"]]
        for t in expired:
            del self._sessions[t]

