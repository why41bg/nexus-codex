"""Quota probe service - query ChatGPT Plus account usage/quota via HTTP.

All mutable state (cache, inflight) is encapsulated in the QuotaProbeService
class. An instance is created during app startup and stored in AppDependencies.

Uses TokenManager to get a valid access_token (with auto-refresh support),
then requests chatgpt.com/backend-api/codex/usage to get quota data.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from app.config import settings
from app.services.token_manager import TokenManager
from app.utils.logger import log

# ─── Types ──────────────────────────────────────────────────


class QuotaWindow:
    """Represents a rate-limit window."""

    def __init__(self, used_percent: float, window_duration_mins: int, resets_at: int):
        self.used_percent = used_percent
        self.window_duration_mins = window_duration_mins
        self.resets_at = resets_at

    def to_dict(self) -> dict[str, Any]:
        return {
            "usedPercent": self.used_percent,
            "windowDurationMins": self.window_duration_mins,
            "resetsAt": self.resets_at,
        }


class QuotaCredits:
    """Represents credit info."""

    def __init__(self, has_credits: bool, unlimited: bool, balance: str):
        self.has_credits = has_credits
        self.unlimited = unlimited
        self.balance = balance

    def to_dict(self) -> dict[str, Any]:
        return {
            "hasCredits": self.has_credits,
            "unlimited": self.unlimited,
            "balance": self.balance,
        }


class QuotaInfo:
    """Represents complete quota information."""

    def __init__(
        self,
        primary: QuotaWindow,
        secondary: QuotaWindow,
        credits: QuotaCredits,
        plan_type: str,
        rate_limit_reached_type: str | None,
    ):
        self.primary = primary
        self.secondary = secondary
        self.credits = credits
        self.plan_type = plan_type
        self.rate_limit_reached_type = rate_limit_reached_type

    def to_dict(self) -> dict[str, Any]:
        return {
            "primary": self.primary.to_dict(),
            "secondary": self.secondary.to_dict(),
            "credits": self.credits.to_dict(),
            "planType": self.plan_type,
            "rateLimitReachedType": self.rate_limit_reached_type,
        }


# ─── Constants ──────────────────────────────────────────────

USAGE_URL = "https://chatgpt.com/backend-api/codex/usage"
USER_AGENT = "nexus-codex/1.0"


# ─── Helpers ────────────────────────────────────────────────


class _CacheEntry:
    def __init__(self, data: QuotaInfo, expires_at: float):
        self.data = data
        self.expires_at = expires_at


def _to_window(w: dict[str, Any]) -> QuotaWindow:
    """Transform raw API window data to QuotaWindow."""
    return QuotaWindow(
        used_percent=w.get("used_percent", 0),
        window_duration_mins=round(w.get("limit_window_seconds", 0) / 60),
        resets_at=w.get("reset_at", 0),
    )


def _transform_response(data: dict[str, Any]) -> QuotaInfo | None:
    """Transform raw API response to QuotaInfo."""
    rl = data.get("rate_limit")
    if not rl:
        return None

    primary_window = rl.get("primary_window")
    secondary_window = rl.get("secondary_window")
    if not primary_window or not secondary_window:
        return None

    credits_data = data.get("credits", {})

    return QuotaInfo(
        primary=_to_window(primary_window),
        secondary=_to_window(secondary_window),
        credits=QuotaCredits(
            has_credits=credits_data.get("has_credits", False),
            unlimited=credits_data.get("unlimited", False),
            balance=credits_data.get("balance", "0"),
        ),
        plan_type=data.get("plan_type", "unknown"),
        rate_limit_reached_type=data.get("rate_limit_reached_type"),
    )


class QuotaProbeService:
    """Encapsulated quota probe state — no module-level globals.

    All mutable state (cache, inflight tasks) is instance-level,
    making the service testable and safe in multi-instance scenarios.
    """

    def __init__(self) -> None:
        self._cache: dict[str, _CacheEntry] = {}
        self._inflight: dict[str, asyncio.Task[QuotaInfo | None]] = {}

    # ─── Core ───────────────────────────────────────────────────

    async def _fetch_quota(
        self,
        codex_home: str,
        timeout_ms: int,
        token_manager: TokenManager | None = None,
    ) -> QuotaInfo | None:
        """Fetch quota from API, store in cache on success."""
        token_mgr = token_manager or TokenManager(codex_home)
        token = await token_mgr.get_access_token()
        if not token:
            log.warn("quota-probe: no valid access_token", extra={"codexHome": codex_home})
            return None
        account_id = token_mgr.get_account_id()

        try:
            timeout = httpx.Timeout(timeout_ms / 1000.0)
            headers: dict[str, str] = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            }
            if account_id:
                headers["ChatGPT-Account-Id"] = account_id
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(
                    USAGE_URL,
                    headers=headers,
                )

            if resp.status_code != 200:
                body = resp.text[:200]
                is_cf_challenge = "_cf_chl_opt" in body or "challenge-platform" in body
                log.warn(
                    "quota-probe: HTTP error",
                    extra={
                        "codexHome": codex_home,
                        "status": resp.status_code,
                        "isCfChallenge": is_cf_challenge,
                        "bodyPreview": body,
                    },
                )
                return None

            data = resp.json()
            result = _transform_response(data)

            if result:
                cache_ttl_ms = settings.quota_cache_ttl_ms
                self._cache[codex_home] = _CacheEntry(
                    data=result,
                    expires_at=time.time() * 1000 + cache_ttl_ms,
                )
                log.debug(
                    "quota-probe: success",
                    extra={
                        "codexHome": codex_home,
                        "planType": result.plan_type,
                        "primaryUsed": f"{result.primary.used_percent}%",
                        "ttlMs": cache_ttl_ms,
                    },
                )
            else:
                log.warn("quota-probe: response missing rate_limits", extra={"codexHome": codex_home})

            return result
        except Exception as e:
            log.warn(
                "quota-probe: fetch error",
                extra={
                    "codexHome": codex_home,
                    "error": str(e),
                },
            )
            return None

    async def probe_quota(
        self,
        codex_home: str,
        timeout_ms: int = 10_000,
        *,
        token_manager: TokenManager | None = None,
    ) -> QuotaInfo | None:
        """Query account quota info (with in-memory cache).

        - Returns cached data if still valid
        - Deduplicates concurrent requests for the same account
        - Cache TTL defaults to 10 minutes (configurable via QUOTA_CACHE_TTL_MS)
        """
        # Check cache
        cached = self._cache.get(codex_home)
        if cached and time.time() * 1000 < cached.expires_at:
            return cached.data

        # Deduplicate inflight requests
        existing = self._inflight.get(codex_home)
        if existing and not existing.done():
            return await existing

        task = asyncio.create_task(
            self._fetch_quota(codex_home, timeout_ms, token_manager=token_manager)
        )
        self._inflight[codex_home] = task
        try:
            return await task
        finally:
            self._inflight.pop(codex_home, None)

    async def refresh_quota(
        self,
        codex_home: str,
        timeout_ms: int = 10_000,
        *,
        token_manager: TokenManager | None = None,
    ) -> QuotaInfo | None:
        """Force refresh quota (bypasses cache)."""
        self._cache.pop(codex_home, None)
        return await self.probe_quota(codex_home, timeout_ms, token_manager=token_manager)
