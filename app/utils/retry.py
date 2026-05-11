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
from app.exceptions import RetryExhaustedError
from app.services.account_pool import AccountPool, PoolEntry
from app.services.chatgpt_client import CloudflareChallengeError, TokenExpiredError, QuotaExhaustedError
from app.utils.logger import log
from app.utils.route_helpers import mask_api_key


MAX_RETRIES = 3

T = TypeVar("T")

RETRYABLE_ERRORS = (
    CloudflareChallengeError,
    TokenExpiredError,
    QuotaExhaustedError,
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


async def _release_and_probe(entry: PoolEntry, deps: AppDependencies) -> None:
    """Release an account slot and trigger a health probe."""
    deps.pool.release(entry.account_id)
    try:
        if deps.health_checker:
            await deps.health_checker.trigger_probe(entry.account_id)
    except Exception:
        pass


async def with_retry(
    deps: AppDependencies,
    operation: Callable[[PoolEntry], Awaitable[T]],
    acquire_timeout_ms: int | None = None,
    model: str | None = None,
    session_id: str | None = None,
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
    # Successful operation result (used to conditionally bind session)
    result: T | None = None
    last_error: Exception | None = None
    collector = deps.log_collector
    model_name = model or "unknown"

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async(acquire_timeout_ms, session_id)
        if not entry:
            if collector:
                await collector.emit(
                    "all_accounts_exhausted",
                    f"No available accounts for {model_name}",
                    context={"model": model_name, "pool_size": len(deps.pool.entries())},
                )
            raise RetryExhaustedError(
                "All account concurrency slots are currently in use. "
                "Please try again later."
            )

        if collector:
            await collector.emit(
                "account_acquired",
                f"Acquired account {entry.account_id} for {model_name}",
                context={"model": model_name},
                account_id=entry.account_id,
            )

        try:
            result = await operation(entry)
            deps.pool.release(entry.account_id)
            # Bind session after successful operation
            if session_id:
                deps.pool.bind_session(session_id, entry.account_id)
            if collector:
                await collector.emit(
                    "account_released",
                    f"Released account {entry.account_id} for {model_name}",
                    context={"model": model_name},
                    account_id=entry.account_id,
                )
            return result
        except Exception as e:
            if attempt < MAX_RETRIES and is_retryable(e):
                log.warning(
                    "Retryable error, failing over to next account",
                    extra={
                        "account_id": entry.account_id,
                        "model": model_name,
                        "attempt": attempt + 1,
                        "max_retries": MAX_RETRIES,
                        "error": str(e),
                    },
                )
                if collector:
                    await collector.emit(
                        "upstream_error",
                        f"Upstream error 0 for {model_name}: {e}",
                        context={"model": model_name, "upstream_status": 0, "error": str(e), "retry_count": attempt + 1},
                        account_id=entry.account_id,
                    )
                # Unbind session if this is a quota exhaustion error
                if session_id and isinstance(e, QuotaExhaustedError):
                    deps.pool.unbind_session(session_id)
                await _release_and_probe(entry, deps)
                last_error = e
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            else:
                deps.pool.release(entry.account_id)
                if collector:
                    await collector.emit(
                        "upstream_error",
                        f"Upstream error 0 for {model_name}: {e}",
                        context={"model": model_name, "upstream_status": 0, "error": str(e)},
                        account_id=entry.account_id,
                    )
                raise

    if collector:
        await collector.emit(
            "all_accounts_exhausted",
            f"No available accounts for {model_name}",
            context={"model": model_name, "pool_size": len(deps.pool.entries())},
        )
    raise RetryExhaustedError(
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
    session_id: str | None = None,
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
    from app.utils.bg_task import create_bg_task
    from app.utils.route_helpers import increment_counters, trigger_probe_safe  # noqa: F811

    collector = deps.log_collector
    last_error: Exception | None = None
    api_key_masked = mask_api_key(api_key) if api_key else "unknown"

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async(session_id=session_id)
        if not entry:
            if collector:
                await collector.emit(
                    "all_accounts_exhausted",
                    f"No available accounts for {model}",
                    context={"model": model, "pool_size": len(deps.pool.entries())},
                )
            yield format_no_slot_error()
            if append_done:
                yield "data: [DONE]\n\n"
            return

        if collector:
            await collector.emit(
                "account_acquired",
                f"Acquired account {entry.account_id} for {model}",
                context={"model": model},
                account_id=entry.account_id,
            )

        create_bg_task(increment_counters(deps, entry.account_id, api_key), name="increment-counters")

        try:
            async for chunk in stream_fn(entry):
                yield chunk

            latency_ms = int((time.time() - req_start) * 1000)
            await deps.metrics_collector.record(model, entry.account_id, latency_ms, True, api_key)
            deps.pool.release(entry.account_id)
            if collector:
                await collector.emit(
                    "account_released",
                    f"Released account {entry.account_id} for {model}",
                    context={"model": model},
                    account_id=entry.account_id,
                    duration_ms=latency_ms,
                )
            # Bind session after successful operation
            if session_id:
                deps.pool.bind_session(session_id, entry.account_id)
            return

        except Exception as e:
            deps.pool.release(entry.account_id)
            latency_ms = int((time.time() - req_start) * 1000)
            await deps.metrics_collector.record(model, entry.account_id, latency_ms, False, api_key)

            if attempt < MAX_RETRIES and is_retryable(e):
                log.warning(
                    "Stream retryable error, failing over",
                    extra={
                        "account_id": entry.account_id,
                        "model": model,
                        "api_key": api_key_masked,
                        "attempt": attempt + 1,
                        "error": str(e),
                    },
                )
                if collector:
                    await collector.emit(
                        "upstream_error",
                        f"Upstream error 0 for {model}: {e}",
                        context={"model": model, "upstream_status": 0, "error": str(e), "retry_count": attempt + 1},
                        account_id=entry.account_id,
                    )
                # Unbind session if this is a quota exhaustion error
                if session_id and isinstance(e, QuotaExhaustedError):
                    deps.pool.unbind_session(session_id)
                create_bg_task(trigger_probe_safe(entry.account_id, health_checker=deps.health_checker), name="trigger-probe", message=f"retry attempt {attempt + 1}")
                last_error = e
                await asyncio.sleep(0.5 * (attempt + 1))
                continue

            log.error("Stream error", extra={
                "error": str(e), "account_id": entry.account_id,
                "model": model, "api_key": api_key_masked,
            })
            if collector:
                await collector.emit(
                    "upstream_error",
                    f"Upstream error 0 for {model}: {e}",
                    context={"model": model, "upstream_status": 0, "error": str(e)},
                    account_id=entry.account_id,
                )
            yield format_error(str(e))
            if append_done:
                yield "data: [DONE]\n\n"
            create_bg_task(trigger_probe_safe(entry.account_id, health_checker=deps.health_checker), name="trigger-probe", message="stream error final")
            return

    if collector:
        await collector.emit(
            "all_accounts_exhausted",
            f"No available accounts for {model}",
            context={"model": model, "pool_size": len(deps.pool.entries())},
        )
    yield format_error(f"All retry attempts exhausted. Last error: {last_error}")
    if append_done:
        yield "data: [DONE]\n\n"
