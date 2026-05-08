"""Request retry helper - automatic account failover on transient errors.

When a ChatGPT backend request fails with a retryable error
(Cloudflare challenge, token expiry, network issues), this module
releases the failed account, acquires a different one, and retries
the request up to MAX_RETRIES times.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Awaitable, AsyncGenerator
from typing import TypeVar

from app.dependencies import AppDependencies
from app.services.account_pool import AccountPool, PoolEntry
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


async def _release_and_probe(entry: PoolEntry, pool: AccountPool) -> None:
    """Release an account slot and trigger a health probe."""
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
                await _release_and_probe(entry, deps.pool)
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


async def with_stream_retry(
    deps: AppDependencies,
    stream_fn: Callable[[PoolEntry], AsyncGenerator[str, None]],
    model: str,
    api_key: str,
    req_start: float,
    format_no_slot_error: Callable[[], str],
    format_error: Callable[[str], str],
    *,
    append_done: bool = False,
) -> AsyncGenerator[str, None]:
    """Execute a streaming operation with automatic account failover.

    Acquires an account from the pool, streams via ``stream_fn``, and on
    retryable errors releases the failed account, acquires a different one,
    and retries up to ``MAX_RETRIES`` times.

    Args:
        deps: Application dependencies container.
        stream_fn: Async generator that yields SSE strings for a PoolEntry.
        model: Model name for metrics recording.
        api_key: API key for usage counter increment.
        req_start: Request start timestamp for latency calculation.
        format_no_slot_error: Returns an SSE string when no account slot
            is available.
        format_error: Returns an SSE string for a given error message.
        append_done: If True, append ``"data: [DONE]\\n\\n"`` after every
            error event (Chat Completions SSE convention).
    """
    from app.utils.route_helpers import increment_counters, trigger_probe_safe

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async()
        if not entry:
            yield format_no_slot_error()
            if append_done:
                yield "data: [DONE]\n\n"
            return

        asyncio.create_task(increment_counters(entry.account_id, api_key))

        try:
            async for chunk in stream_fn(entry):
                yield chunk

            latency_ms = int((time.time() - req_start) * 1000)
            deps.metrics_collector.record(model, entry.account_id, latency_ms, True)
            deps.pool.release(entry.account_id)
            return

        except Exception as e:
            deps.pool.release(entry.account_id)
            latency_ms = int((time.time() - req_start) * 1000)
            deps.metrics_collector.record(model, entry.account_id, latency_ms, False)

            if attempt < MAX_RETRIES and is_retryable(e):
                log.warn(
                    "Stream retryable error, failing over",
                    extra={
                        "account_id": entry.account_id,
                        "attempt": attempt + 1,
                        "error": str(e),
                    },
                )
                asyncio.create_task(trigger_probe_safe(entry.account_id))
                last_error = e
                await asyncio.sleep(0.5 * (attempt + 1))
                continue

            log.error("Stream error", extra={"error": str(e)})
            yield format_error(str(e))
            if append_done:
                yield "data: [DONE]\n\n"
            asyncio.create_task(trigger_probe_safe(entry.account_id))
            return

    yield format_error(f"All retry attempts exhausted. Last error: {last_error}")
    if append_done:
        yield "data: [DONE]\n\n"
