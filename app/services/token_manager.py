"""Token manager - read, refresh, and persist OAuth tokens for ChatGPT Plus accounts.

Reads access_token/refresh_token from CODEX_HOME/auth.json, parses JWT expiry,
auto-refreshes tokens before they expire, and persists refreshed tokens back.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from pathlib import Path

import aiofiles
import httpx

from app.utils.logger import log

# ─── Constants ──────────────────────────────────────────────

TOKEN_REFRESH_URL = "https://auth.openai.com/oauth/token"
TOKEN_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
TOKEN_REFRESH_BUFFER_SEC = 8 * 60  # refresh 8 minutes before expiry (matches Codex CLI)
USER_AGENT = "nexus-codex/1.0"


# ─── Helpers ────────────────────────────────────────────────


def parse_jwt_expiry(token: str) -> float | None:
    """Parse JWT exp claim, returning expiry timestamp in seconds (Unix time)."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("exp")
    except Exception:
        return None


# ─── TokenManager ───────────────────────────────────────────


class TokenManager:
    """Manages the OAuth token lifecycle for a single ChatGPT Plus account.

    Reads tokens from CODEX_HOME/auth.json, auto-refreshes when the access_token
    is within TOKEN_REFRESH_BUFFER_SEC of expiry, and persists refreshed tokens
    back to auth.json.
    """

    # Shared httpx client for token refresh — reused across all instances
    # to allow TCP connection pooling to auth.openai.com.
    _shared_http_client: httpx.AsyncClient | None = None
    _shared_http_client_lock: asyncio.Lock = asyncio.Lock()

    @classmethod
    async def _get_http_client(cls) -> httpx.AsyncClient:
        """Return (and lazily create) a shared httpx.AsyncClient with lock protection."""
        if cls._shared_http_client is not None and not cls._shared_http_client.is_closed:
            return cls._shared_http_client
        async with cls._shared_http_client_lock:
            # Double-check after acquiring lock
            if cls._shared_http_client is None or cls._shared_http_client.is_closed:
                cls._shared_http_client = httpx.AsyncClient(
                    headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
                    timeout=30,
                )
            return cls._shared_http_client

    @classmethod
    async def close_shared_client(cls) -> None:
        """Close the shared httpx client gracefully. Call during app shutdown."""
        async with cls._shared_http_client_lock:
            if cls._shared_http_client and not cls._shared_http_client.is_closed:
                await cls._shared_http_client.aclose()
            cls._shared_http_client = None

    def __init__(self, codex_home: str):
        self._codex_home = codex_home
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._account_id: str | None = None
        self._expires_at: float | None = None
        self._plan_type: str | None = None
        self._refresh_lock = asyncio.Lock()
        self._loaded = False

    # ── Public API ──────────────────────────────────────

    async def get_access_token(self) -> str | None:
        """Return a valid access_token, refreshing if needed."""
        if not self._loaded:
            await self._load_auth_json()
            self._loaded = True
        if self._access_token and self._needs_refresh():
            await self.refresh_if_needed()
        return self._access_token

    async def refresh_if_needed(self) -> bool:
        """Refresh the token if it's within the refresh buffer window."""
        if self._needs_refresh():
            return await self._do_refresh()
        return True

    def get_account_id(self) -> str | None:
        """Return the account_id from auth.json."""
        return self._account_id

    def get_plan_type(self) -> str | None:
        """Return the plan_type from auth.json."""
        return self._plan_type

    def get_account_info(self) -> dict:
        """Return account info dict (plan_type, account_id, token_valid)."""
        return {
            "plan_type": self._plan_type or "unknown",
            "account_id": self._account_id,
            "token_valid": self._access_token is not None and not self._needs_refresh(),
            "expires_at": self._expires_at,
        }

    # ── Internal ────────────────────────────────────────

    def _needs_refresh(self) -> bool:
        """Check if token needs refreshing (within buffer window of expiry)."""
        if not self._expires_at:
            return bool(self._refresh_token)
        return (self._expires_at - time.time()) < TOKEN_REFRESH_BUFFER_SEC

    async def _load_auth_json(self) -> None:
        """Load tokens from auth.json (async file I/O)."""
        try:
            auth_path = Path(self._codex_home) / "auth.json"
            exists = await asyncio.to_thread(auth_path.exists)
            if not exists:
                log.warning("auth.json not found", extra={"codexHome": self._codex_home})
                return
            async with aiofiles.open(auth_path, mode="r", encoding="utf-8") as f:
                raw = await f.read()
            auth = json.loads(raw)
            tokens = auth.get("tokens") or {}
            self._access_token = tokens.get("access_token")
            self._refresh_token = tokens.get("refresh_token")
            self._account_id = tokens.get("account_id")
            self._plan_type = auth.get("plan_type")
            if self._access_token:
                self._expires_at = parse_jwt_expiry(self._access_token)
            log.debug(
                "TokenManager loaded",
                extra={
                    "codexHome": self._codex_home,
                    "hasAccessToken": bool(self._access_token),
                    "hasRefreshToken": bool(self._refresh_token),
                    "expiresAt": self._expires_at,
                },
            )
        except Exception as e:
            log.error("Failed to load auth.json", extra={"codexHome": self._codex_home, "error": str(e)})

    async def _do_refresh(self) -> bool:
        """Execute token refresh via OAuth2 refresh_token grant."""
        if not self._refresh_token:
            log.warning("No refresh_token available", extra={"codexHome": self._codex_home})
            return False

        async with self._refresh_lock:
            # Double-check after acquiring lock
            if not self._needs_refresh() and self._access_token:
                return True

            try:
                client = await self._get_http_client()
                resp = await client.post(
                    TOKEN_REFRESH_URL,
                    json={
                        "grant_type": "refresh_token",
                        "refresh_token": self._refresh_token,
                        "client_id": TOKEN_CLIENT_ID,
                    },
                )

                if resp.status_code != 200:
                    log.error(
                        "Token refresh failed",
                        extra={
                            "codexHome": self._codex_home,
                            "status": resp.status_code,
                            "body": resp.text[:200],
                        },
                    )
                    return False

                data = resp.json()
                self._access_token = data["access_token"]
                self._refresh_token = data.get("refresh_token", self._refresh_token)
                self._expires_at = parse_jwt_expiry(self._access_token)

                # Persist back to auth.json
                await self._save_auth_json(data)
                log.info("Token refreshed successfully", extra={"codexHome": self._codex_home})
                return True

            except Exception as e:
                log.error("Token refresh error", extra={"codexHome": self._codex_home, "error": str(e)})
                return False

    async def _save_auth_json(self, refresh_data: dict) -> None:
        """Persist refreshed tokens back to auth.json using atomic write.

        Writes to a temporary file first, then atomically replaces the
        original to prevent corruption if the process crashes mid-write.
        """
        try:
            auth_path = Path(self._codex_home) / "auth.json"
            exists = await asyncio.to_thread(auth_path.exists)
            if not exists:
                return
            async with aiofiles.open(auth_path, mode="r", encoding="utf-8") as f:
                raw = await f.read()
            auth = json.loads(raw)
            tokens = auth.get("tokens") or {}
            tokens["access_token"] = refresh_data["access_token"]
            if "refresh_token" in refresh_data:
                tokens["refresh_token"] = refresh_data["refresh_token"]
            if "id_token" in refresh_data:
                tokens["id_token"] = refresh_data["id_token"]
            auth["tokens"] = tokens
            auth["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            # Atomic write: write to .tmp then replace
            tmp_path = auth_path.with_suffix(".tmp")
            async with aiofiles.open(tmp_path, mode="w", encoding="utf-8") as f:
                await f.write(json.dumps(auth, indent=2))
            await asyncio.to_thread(os.replace, str(tmp_path), str(auth_path))
        except Exception as e:
            log.error("Failed to save auth.json", extra={"codexHome": self._codex_home, "error": str(e)})
