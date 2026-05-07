"""Rate limiting middleware using sliding window."""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.config_store import find_api_key

# In-memory store: api_key -> list of request timestamps (ms)
_request_store: dict[str, list[float]] = defaultdict(list)


def _cleanup_timestamps(timestamps: list[float], window_ms: float) -> list[float]:
    """Remove expired timestamps."""
    cutoff = time.time() * 1000 - window_ms
    return [ts for ts in timestamps if ts > cutoff]


async def rate_limit_dependency(request: Request, api_key: str) -> None:
    """Rate limit check as a dependency. Call after api_key_auth_dependency."""
    # Determine limits for this key
    key_config = find_api_key(api_key)
    limit_max = key_config.rate_limit_max if (key_config and key_config.rate_limit_max) else settings.rate_limit_max
    limit_window_ms = key_config.rate_limit_window_ms if (key_config and key_config.rate_limit_window_ms) else settings.rate_limit_window_ms

    now_ms = time.time() * 1000
    timestamps = _cleanup_timestamps(_request_store.get(api_key, []), limit_window_ms)

    current_count = len(timestamps)
    remaining = max(0, limit_max - current_count)

    if current_count >= limit_max:
        oldest = min(timestamps) if timestamps else now_ms
        reset_time = oldest + limit_window_ms
        retry_after = max(1, int((reset_time - now_ms) / 1000))
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "message": f"Rate limit exceeded. Please retry after {retry_after} seconds.",
                    "type": "rate_limit_error",
                    "code": "rate_limit_exceeded",
                }
            },
        )

    # Record this request
    timestamps.append(now_ms)
    _request_store[api_key] = timestamps
