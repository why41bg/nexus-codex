"""Authentication middleware for FastAPI."""

from __future__ import annotations

import base64

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

from app.services.config_store import (
    get_api_key_set,
    find_api_key,
    verify_admin_auth,
)
from app.services.session_manager import validate_session


def _error_response(message: str, error_type: str, code: str, status: int) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": error_type, "code": code}},
    )


async def admin_auth_dependency(request: Request) -> None:
    """Dependency for admin route authentication."""
    # Check query token (for SSE/EventSource)
    query_token = request.query_params.get("token")
    if query_token:
        if validate_session(query_token):
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
        if validate_session(token):
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
        if not verify_admin_auth(username, password):
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
    allowed_keys = get_api_key_set()

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
    if api_key not in allowed_keys:
        raise HTTPException(
            status_code=401,
            detail={"error": {"message": "Invalid API key provided.", "type": "invalid_request_error", "code": "invalid_api_key"}},
        )

    # IP whitelist check
    entry = find_api_key(api_key)
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
