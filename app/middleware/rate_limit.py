"""Rate limiting middleware using sliding window."""

from __future__ import annotations

import time
from collections import defaultdict
from typing import TYPE_CHECKING

from fastapi import Request

from app.config import settings
from app.exceptions import RateLimitError

if TYPE_CHECKING:
    from app.dependencies import AppDependencies


class RateLimiter:
    """Encapsulated rate limiter state — no module-level globals.

    All mutable state is instance-level, making the limiter testable
    and safe in multi-instance scenarios.
    """

    def __init__(self) -> None:
        self._request_store: dict[str, list[float]] = defaultdict(list)

    def _cleanup_timestamps(self, timestamps: list[float], window_ms: float) -> list[float]:
        """Remove expired timestamps."""
        cutoff = time.time() * 1000 - window_ms
        return [ts for ts in timestamps if ts > cutoff]

    def _purge_stale_keys(self, window_ms: float) -> None:
        """Remove keys whose timestamps have all expired."""
        cutoff = time.time() * 1000 - window_ms
        stale = [k for k, ts in self._request_store.items() if not ts or max(ts) <= cutoff]
        for k in stale:
            del self._request_store[k]

    async def check(self, request: Request, api_key: str) -> None:
        """Rate limit check. Raises HTTPException(429) if limit exceeded."""
        # Determine limits for this key via DI
        deps: AppDependencies | None = getattr(request.app.state, "deps", None)
        config_store = deps.config_store if deps else None
        key_config = config_store.find_api_key(api_key) if config_store else None
        limit_max = key_config.rate_limit_max if (key_config and key_config.rate_limit_max) else settings.rate_limit_max
        limit_window_ms = key_config.rate_limit_window_ms if (key_config and key_config.rate_limit_window_ms) else settings.rate_limit_window_ms

        now_ms = time.time() * 1000
        timestamps = self._cleanup_timestamps(self._request_store.get(api_key, []), limit_window_ms)

        current_count = len(timestamps)
        remaining = max(0, limit_max - current_count)

        if current_count >= limit_max:
            oldest = min(timestamps) if timestamps else now_ms
            reset_time = oldest + limit_window_ms
            retry_after = max(1, int((reset_time - now_ms) / 1000))

            # Log rate limit event
            if deps and deps.log_collector:
                client_ip = request.client.host if request.client else "-"
                await deps.log_collector.emit(
                    "rate_limit_hit",
                    f"Rate limit hit from {client_ip}",
                    context={"path": request.url.path},
                    api_key_id=api_key[:8] + "..." if api_key else None,
                    client_ip=client_ip,
                )

            raise RateLimitError(
                f"Rate limit exceeded. Please retry after {retry_after} seconds."
            )

        # Record this request
        timestamps.append(now_ms)
        self._request_store[api_key] = timestamps

        # Periodic cleanup: purge stale keys that have no recent timestamps
        # to prevent unbounded memory growth from many distinct API keys.
        if len(self._request_store) > 1000:
            self._purge_stale_keys(limit_window_ms)


async def rate_limit_dependency(request: Request, api_key: str) -> None:
    """Rate limit check as a dependency. Call after api_key_auth_dependency.

    Uses the RateLimiter instance from AppDependencies so that state is
    shared consistently through the DI container rather than a module-level
    singleton.
    """
    deps: AppDependencies | None = getattr(request.app.state, "deps", None)
    limiter = deps.rate_limiter if deps else RateLimiter()
    await limiter.check(request, api_key)
