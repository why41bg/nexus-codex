"""Request retry helper - automatic account failover on transient errors.

When a ChatGPT backend request fails with a retryable error
(Cloudflare challenge, token expiry, network issues), this module
releases the failed account, acquires a different one, and retries
the request up to MAX_RETRIES times.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Awaitable
from typing import TypeVar

from app.dependencies import AppDependencies
from app.services.account_pool import PoolEntry
from app.services.chatgpt_client import CloudflareChallengeError, TokenExpiredError
from app.services.health_check import trigger_probe
from app.utils.logger import log

MAX_RETRIES = 3

T = TypeVar("T")

RETRYABLE_ERRORS = (
    CloudflareChallengeError,
    TokenExpiredError,
    ConnectionError,
    TimeoutError,
    OSError,
)


def is_retryable(exc: Exception) -> bool:
    """Check if an exception warrants an account failover retry."""
    if isinstance(exc, RETRYABLE_ERRORS):
        return True
    exc_name = type(exc).__name__
    if exc_name in ("ConnectError", "ReadError", "WriteError", "RemoteProtocolError",
                     "PoolTimeout", "ReadTimeout", "WriteTimeout", "ConnectTimeout"):
        return True
    return False


async def _release_and_probe(entry: PoolEntry) -> None:
    """Release an account slot and trigger a health probe."""
    from app.services.account_pool import pool
    pool.release(entry.account_id)
    try:
        await trigger_probe(entry.account_id)
    except Exception:
        pass


async def with_retry(
    deps: AppDependencies,
    operation: Callable[[PoolEntry], Awaitable[T]],
    acquire_timeout_ms: int | None = None,
) -> T:
    """Execute an operation with automatic account failover on retryable errors.

    Acquires an account from the pool, runs the operation, and if a retryable
    error occurs, releases the failed account, acquires a different one, and
    retries up to MAX_RETRIES times.

    Args:
        deps: Application dependencies container.
        operation: Async callable that takes a PoolEntry and returns T.
        acquire_timeout_ms: Timeout for each acquire attempt.

    Returns:
        The result of the operation.

    Raises:
        RuntimeError: If all retry attempts are exhausted.
    """
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async(acquire_timeout_ms)
        if not entry:
            raise RuntimeError(
                "All account concurrency slots are currently in use. "
                "Please try again later."
            )

        try:
            result = await operation(entry)
            deps.pool.release(entry.account_id)
            return result
        except Exception as e:
            if attempt < MAX_RETRIES and is_retryable(e):
                log.warn(
                    "Retryable error, failing over to next account",
                    extra={
                        "account_id": entry.account_id,
                        "attempt": attempt + 1,
                        "max_retries": MAX_RETRIES,
                        "error": str(e),
                    },
                )
                await _release_and_probe(entry)
                last_error = e
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            else:
                deps.pool.release(entry.account_id)
                raise

    raise RuntimeError(
        f"All {MAX_RETRIES + 1} retry attempts exhausted. "
        f"Last error: {last_error}"
    )
