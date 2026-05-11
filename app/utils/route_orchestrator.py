"""Shared route orchestration for API proxy endpoints.

All three API routes (chat_completions, responses, messages) follow
the same request lifecycle:
    1. rate-limit check
    2. model allowed check
    3. set request context
    4. log the incoming request
    5. branch on stream vs non-stream
    6. identical error-handling envelope

This module extracts steps 1-4 and the error-handling envelope so each
route only needs to supply protocol-specific logic (adapter, id prefix,
error formatting).
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, AsyncGenerator
from typing import TypeVar

from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies
from app.exceptions import BackendError, ModelNotFoundError, RateLimitError, RetryExhaustedError
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import PoolEntry
from app.utils.logger import log
from app.utils.retry import with_retry, with_stream_retry
from app.utils.route_helpers import mask_api_key, set_request_context

T = TypeVar("T")


async def validate_request(
    request: Request,
    api_key: str,
    model: str,
    request_id: str,
    log_prefix: str,
    *,
    stream: bool = False,
    protocol: str | None = None,
) -> tuple[float, str]:
    """Run common pre-flight checks shared by all proxy routes.

    Steps:
        - Rate limit check
        - Model allowed check (raises ModelNotFoundError)
        - Store request context for access-log middleware
        - Log the incoming request

    Returns:
        (req_start, api_key_masked) tuple
    """
    if protocol:
        request.state.protocol = protocol

    await rate_limit_dependency(request, api_key)

    # Use config_store from DI for model access check
    deps: AppDependencies | None = getattr(request.app.state, "deps", None)
    if deps and not deps.config_store.is_model_allowed_for_key(api_key, model):
        raise ModelNotFoundError(model)

    req_start = time.time()
    api_key_masked = mask_api_key(api_key)

    set_request_context(request, api_key=api_key, model=model, request_id=request_id)

    log.info(f"{log_prefix} request", extra={
        "model": model, "stream": stream,
        "api_key": api_key_masked, "request_id": request_id,
    })

    return req_start, api_key_masked


async def execute_non_stream(
    deps: AppDependencies,
    operation: Callable[[PoolEntry], Awaitable[JSONResponse]],
    *,
    model: str,
    api_key_masked: str,
    request_id: str,
    log_prefix: str,
    session_id: str | None = None,
) -> JSONResponse:
    """Execute a non-streaming operation with unified error handling.

    Wraps with_retry and converts all retryable/backend errors to
    appropriate NexusError subclasses.
    """
    try:
        return await with_retry(
            deps,
            operation,
            model=model,
            session_id=session_id,
        )
    except RetryExhaustedError as e:
        log.error(f"{log_prefix} exhausted retries", extra={
            "error": str(e), "model": model,
            "api_key": api_key_masked, "request_id": request_id,
        })
        raise RateLimitError(str(e))
    except RuntimeError as e:
        log.error(f"{log_prefix} backend error", extra={
            "error": str(e), "model": model,
            "api_key": api_key_masked, "request_id": request_id,
        })
        raise BackendError(str(e))
    except Exception as e:
        log.error(f"{log_prefix} error", extra={
            "error": str(e), "model": model,
            "api_key": api_key_masked, "request_id": request_id,
        })
        raise


def build_sse_response(
    generator: AsyncGenerator[str, None],
    *,
    extra_headers: dict[str, str] | None = None,
) -> StreamingResponse:
    """Build a StreamingResponse with standard SSE headers."""
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    if extra_headers:
        headers.update(extra_headers)
    return StreamingResponse(generator, media_type="text/event-stream", headers=headers)
