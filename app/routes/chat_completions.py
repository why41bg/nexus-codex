"""Chat Completions API route - /v1/chat/completions."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.models import ChatCompletionRequest
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import PoolEntry
from app.services.account_store import increment_usage_count
from app.services.config_store import is_model_allowed_for_key, increment_key_monthly_usage
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.config import settings
from app.utils.logger import log
from app.utils.retry import with_retry, is_retryable

router = APIRouter()


def _generate_completion_id() -> str:
    return f"chatcmpl-nexus-{uuid.uuid4()}"


def _error_response(message: str, code: str, status: int = 500) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "message": message,
                "type": "server_error",
                "code": code,
            }
        },
    )


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
        return _error_response(
            f"The model '{body.model}' does not exist or is not available.",
            "model_not_found",
            404,
        )

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
            )
            return result
        except RuntimeError as e:
            log.error("Chat completion exhausted retries", extra={"error": str(e)})
            return _error_response(str(e), "rate_limit_exceeded", 429)
        except Exception as e:
            log.error("Chat completion error", extra={"error": str(e)})
            return _error_response(str(e), "internal_error")


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming completion via ChatGPTClient (used inside with_retry)."""
    asyncio.create_task(_increment_counters(entry.account_id, api_key))

    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    client = entry.chatgpt_client
    if not client:
        raise RuntimeError("ChatGPT client not initialized")

    full_text = ""
    async for raw_data in client.chat(
        model=body.model,
        messages=messages,
        stream=False,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    ):
        try:
            response_data = json.loads(raw_data)
            full_text = ChatGPTAdapter.extract_text_from_response(response_data)
        except json.JSONDecodeError:
            pass

    result = ChatGPTAdapter.build_chat_response(
        completion_id, body.model, full_text
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
    from app.utils.retry import MAX_RETRIES

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async()
        if not entry:
            error_data = {
                "error": {
                    "message": "All account concurrency slots are currently in use.",
                    "type": "server_error",
                    "code": "rate_limit_exceeded",
                }
            }
            yield f"data: {json.dumps(error_data)}\n\n"
            yield "data: [DONE]\n\n"
            return

        asyncio.create_task(_increment_counters(entry.account_id, api_key))

        try:
            messages = [{"role": m.role, "content": m.content} for m in body.messages]
            client = entry.chatgpt_client
            if not client:
                raise RuntimeError("ChatGPT client not initialized")

            init_chunk = ChatGPTAdapter.build_chat_chunk(
                completion_id, body.model, role="assistant"
            )
            yield f"data: {json.dumps(init_chunk)}\n\n"

            async for raw_data in client.chat(
                model=body.model,
                messages=messages,
                stream=True,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
            ):
                try:
                    event_data = json.loads(raw_data)
                    text = ChatGPTAdapter.extract_text_from_event(event_data)
                    if text:
                        chunk = ChatGPTAdapter.build_chat_chunk(
                            completion_id, body.model, content=text
                        )
                        yield f"data: {json.dumps(chunk)}\n\n"
                except json.JSONDecodeError:
                    pass

            stop_chunk = ChatGPTAdapter.build_chat_chunk(
                completion_id, body.model, finish_reason="stop"
            )
            yield f"data: {json.dumps(stop_chunk)}\n\n"
            yield "data: [DONE]\n\n"

            latency_ms = int((time.time() - req_start) * 1000)
            deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True)
            deps.pool.release(entry.account_id)
            return

        except Exception as e:
            deps.pool.release(entry.account_id)
            latency_ms = int((time.time() - req_start) * 1000)
            deps.metrics_collector.record(body.model, entry.account_id, latency_ms, False)

            if attempt < MAX_RETRIES and is_retryable(e):
                log.warn(
                    "Stream retryable error, failing over",
                    extra={
                        "account_id": entry.account_id,
                        "attempt": attempt + 1,
                        "error": str(e),
                    },
                )
                asyncio.create_task(_trigger_probe_safe(entry.account_id))
                last_error = e
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            else:
                log.error("Stream error", extra={"error": str(e)})
                error_data = {
                    "error": {
                        "message": str(e),
                        "type": "server_error",
                        "code": "api_error",
                    }
                }
                yield f"data: {json.dumps(error_data)}\n\n"
                yield "data: [DONE]\n\n"
                asyncio.create_task(_trigger_probe_safe(entry.account_id))
                return

    error_data = {
        "error": {
            "message": f"All retry attempts exhausted. Last error: {last_error}",
            "type": "server_error",
            "code": "rate_limit_exceeded",
        }
    }
    yield f"data: {json.dumps(error_data)}\n\n"
    yield "data: [DONE]\n\n"


async def _increment_counters(account_id: str, api_key: str) -> None:
    try:
        await increment_usage_count(account_id)
    except Exception as e:
        log.error("Failed to update usage stats", extra={"error": str(e)})
    try:
        await increment_key_monthly_usage(api_key)
    except Exception as e:
        log.error("Failed to update key monthly usage", extra={"error": str(e)})


async def _trigger_probe_safe(account_id: str) -> None:
    try:
        from app.services.health_check import trigger_probe
        await trigger_probe(account_id)
    except Exception:
        pass
