"""Chat Completions API route - /v1/chat/completions.

Orchestrates the Chat Completions flow:
1. Validate request (auth, rate limit, model)
2. Convert to Responses API format via ChatGPTAdapter
3. Call ChatGPT backend via ChatGPTClient.responses()
4. Convert responses back to Chat Completions format via ChatGPTAdapter

All format conversion logic lives in ChatGPTAdapter; this module only
handles HTTP routing, retry, and metrics.
"""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.exceptions import ModelNotFoundError, RateLimitError, RetryExhaustedError, BackendError
from app.models import ChatCompletionRequest
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import PoolEntry
from app.services.config_store import is_model_allowed_for_key
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.utils.logger import log
from app.utils.retry import with_retry, with_stream_retry
from app.utils.route_helpers import increment_counters

router = APIRouter()


def _generate_completion_id() -> str:
    return f"chatcmpl-nexus-{uuid.uuid4()}"


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    body: ChatCompletionRequest,
    api_key: str = Depends(api_key_auth_dependency),
    deps: AppDependencies = Depends(get_deps),
):
    """Handle chat completion requests with ChatGPT Plus backend streaming."""
    await rate_limit_dependency(request, api_key)

    if not is_model_allowed_for_key(api_key, body.model):
        raise ModelNotFoundError(body.model)

    req_start = time.time()
    completion_id = _generate_completion_id()

    if body.stream:
        return StreamingResponse(
            _stream_completion_with_retry(deps, body, completion_id, req_start, api_key),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        try:
            result = await with_retry(
                deps,
                lambda entry: _do_non_stream(deps, entry, body, completion_id, req_start, api_key),
                model=body.model,
            )
            return result
        except RetryExhaustedError as e:
            log.error("Chat completion exhausted retries", extra={"error": str(e)})
            raise RateLimitError(str(e))
        except RuntimeError as e:
            log.error("Chat completion backend error", extra={"error": str(e)})
            raise BackendError(str(e))
        except Exception as e:
            log.error("Chat completion error", extra={"error": str(e)})
            raise


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming completion via ChatGPTClient.responses()."""
    asyncio.create_task(increment_counters(entry.account_id, api_key))

    client = entry.chatgpt_client
    if not client:
        raise RuntimeError("ChatGPT client not initialized")

    params = ChatGPTAdapter.prepare_request(body)
    params["stream"] = True

    result = None
    async for raw_data in client.responses(**params):
        try:
            response_data = json.loads(raw_data)
            result = ChatGPTAdapter.convert_non_stream_response(
                response_data, completion_id, body.model
            )
        except json.JSONDecodeError:
            pass

    if result is None:
        result = ChatGPTAdapter.convert_non_stream_response(
            {"output": []}, completion_id, body.model
        )

    latency_ms = int((time.time() - req_start) * 1000)
    deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True)
    return JSONResponse(content=result)


async def _stream_completion_with_retry(
    deps: AppDependencies,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """Stream chat completion with account failover on initial connection errors."""

    async def _stream(entry: PoolEntry) -> AsyncGenerator[str, None]:
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        params = ChatGPTAdapter.prepare_request(body)
        include_usage = bool(
            body.stream_options and body.stream_options.get("include_usage")
        )

        init_chunk = ChatGPTAdapter.build_chat_chunk(
            completion_id, body.model, role="assistant"
        )
        yield f"data: {json.dumps(init_chunk)}\n\n"

        async for raw_data in client.responses(**params):
            try:
                event_data = json.loads(raw_data)
                chunks = ChatGPTAdapter.convert_stream_event(
                    event_data, completion_id, body.model,
                    include_usage=include_usage,
                )
                for chunk_json in chunks:
                    yield f"data: {chunk_json}\n\n"
            except json.JSONDecodeError:
                pass

        yield "data: [DONE]\n\n"

    def _no_slot_error() -> str:
        error_data = {
            "error": {
                "message": "All account concurrency slots are currently in use.",
                "type": "server_error",
                "code": "rate_limit_exceeded",
            }
        }
        return f"data: {json.dumps(error_data)}\n\n"

    def _format_error(msg: str) -> str:
        error_data = {
            "error": {
                "message": msg,
                "type": "server_error",
                "code": "api_error",
            }
        }
        return f"data: {json.dumps(error_data)}\n\n"

    async for chunk in with_stream_retry(
        deps, _stream, body.model, api_key, req_start,
        format_no_slot_error=_no_slot_error,
        format_error=_format_error,
        append_done=True,
    ):
        yield chunk
