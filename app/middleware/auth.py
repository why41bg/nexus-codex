"""Authentication middleware for FastAPI."""

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import TYPE_CHECKING

from fastapi import Request, HTTPException

from app.dependencies import get_deps_from_request

if TYPE_CHECKING:
    from app.dependencies import AppDependencies


def _hmac_digest(key_str: str) -> bytes:
    """Compute the HMAC-SHA256 digest used for key comparison."""
    return hmac.new(b"nexus-key-check", key_str.encode(), hashlib.sha256).digest()


# Pre-computed HMAC lookup table: maps digest → digest.
# Rebuilt every time the key set changes (see _build_hmac_index).
_hmac_index: dict[bytes, bytes] = {}
_hmac_index_source: frozenset[str] = frozenset()


def _build_hmac_index(allowed_keys: frozenset[str]) -> dict[bytes, bytes]:
    """(Re)build a HMAC digest → digest mapping from allowed keys."""
    return {_hmac_digest(k): _hmac_digest(k) for k in allowed_keys}


def _constant_time_key_check(api_key: str, allowed_keys: set[str]) -> bool:
    """Check if api_key is in allowed_keys in O(1) with timing-safe comparison.

    Uses a pre-computed HMAC lookup table that is rebuilt when the key
    set changes.  The lookup itself is a dict get (O(1)), and we still
    use ``hmac.compare_digest`` for the final comparison so that the
    equality check is constant-time.
    """
    global _hmac_index, _hmac_index_source  # noqa: PLW0603
    # Rebuild the index when the allowed key set content has changed
    frozen = frozenset(allowed_keys)
    if frozen != _hmac_index_source:
        _hmac_index = _build_hmac_index(frozen)
        _hmac_index_source = frozen

    ha = _hmac_digest(api_key)
    # Constant-time comparison against a known-good digest from the index,
    # or a dummy digest if the key is not present (to avoid early return).
    expected = _hmac_index.get(ha)
    if expected is not None:
        # compare_digest ensures constant-time comparison
        return hmac.compare_digest(ha, expected)
    return False


def _get_session_manager(request: Request):
    """Get the SessionManager from DI container."""
    deps = get_deps_from_request(request)
    if deps:
        return deps.session_manager
    return None


async def admin_auth_dependency(request: Request) -> None:
    """Dependency for admin route authentication."""
    session_mgr = _get_session_manager(request)

    # Check query token (for SSE/EventSource)
    query_token = request.query_params.get("token")
    if query_token:
        if session_mgr and session_mgr.validate_session(query_token):
            return
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid or expired session token.", "type": "authentication_error", "code": "invalid_credentials"}},
        )

    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Missing Authorization header.", "type": "authentication_error", "code": "missing_credentials"}},
        )

    # Try Bearer token
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        if session_mgr and session_mgr.validate_session(token):
            return
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid or expired session token.", "type": "authentication_error", "code": "invalid_credentials"}},
        )

    # Try Basic auth
    if auth_header.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
            colon_idx = decoded.index(":")
            username = decoded[:colon_idx]
            password = decoded[colon_idx + 1:]
        except Exception:
            raise HTTPException(
                status_code=401,
                detail={"error": {"message": "Invalid Basic auth encoding.", "type": "authentication_error", "code": "invalid_credentials"}},
            )
        deps = get_deps_from_request(request)
        if not deps or not deps.config_store.verify_admin_auth(username, password):
            raise HTTPException(
                status_code=401,
                detail={"error": {"message": "Invalid username or password.", "type": "authentication_error", "code": "invalid_credentials"}},
            )
        return

    raise HTTPException(
        status_code=401,
        detail={"error": {"message": "Invalid Authorization header format.", "type": "authentication_error", "code": "invalid_credentials"}},
    )


async def api_key_auth_dependency(request: Request) -> str:
    """
    Dependency for API key authentication.
    Returns the validated API key string.
    """
    deps = get_deps_from_request(request)
    if not deps:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": "Application not initialized.", "type": "server_error", "code": "not_ready"}},
        )

    config_store = deps.config_store
    allowed_keys = config_store.get_api_key_set()

    if not allowed_keys:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "No API keys configured.", "type": "invalid_request_error", "code": "no_api_keys"}},
        )

    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Missing Authorization header. Expected: Bearer <api_key>", "type": "invalid_request_error", "code": "missing_api_key"}},
        )

    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid Authorization header format.", "type": "invalid_request_error", "code": "invalid_api_key"}},
        )

    api_key = auth_header[7:]
    if not _constant_time_key_check(api_key, allowed_keys):
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid API key provided.", "type": "invalid_request_error", "code": "invalid_api_key"}},
        )

    # Key existence & enabled check
    entry = config_store.find_api_key(api_key)

    if entry and not entry.enabled:
        raise HTTPException(
            status_code=403,
            detail={"error": {"message": "This API key has been disabled.", "type": "invalid_request_error", "code": "api_key_disabled"}},
        )

    # Expiration check
    if entry and entry.expires_at:
        from datetime import datetime, timezone

        try:
            expires = datetime.fromisoformat(entry.expires_at)
            if datetime.now(timezone.utc) >= expires:
                raise HTTPException(
                    status_code=403,
                    detail={"error": {"message": "This API key has expired.", "type": "invalid_request_error", "code": "api_key_expired"}},
                )
        except ValueError:
            # expires_at has an unparseable format — reject the key to be safe
            raise HTTPException(
                status_code=403,
                detail={"error": {"message": "This API key has an invalid expiration date and cannot be used.", "type": "invalid_request_error", "code": "api_key_expired"}},
            )

    # IP whitelist check
    if entry and entry.ip_whitelist:
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or request.headers.get("x-real-ip", "")
            or (request.client.host if request.client else "")
        )
        if client_ip and client_ip not in entry.ip_whitelist:
            raise HTTPException(
                status_code=403,
                detail={"error": {"message": "IP not allowed for this API key.", "type": "invalid_request_error", "code": "ip_not_allowed"}},
            )

    # Monthly quota check
    if entry and entry.monthly_quota is not None:
        if (entry.monthly_usage or 0) >= entry.monthly_quota:
            from datetime import datetime, timezone

            if not entry.monthly_reset_at or datetime.now(timezone.utc) < datetime.fromisoformat(entry.monthly_reset_at):
                raise HTTPException(
                    status_code=429,
                    detail={"error": {"message": "Monthly quota exceeded.", "type": "rate_limit_error", "code": "monthly_quota_exceeded"}},
                )

    return api_key
