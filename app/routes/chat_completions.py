"""Chat Completions API route - /v1/chat/completions."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models import ChatCompletionRequest
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import pool, PoolEntry
from app.services.account_store import increment_usage_count
from app.services.config_store import is_model_allowed_for_key, increment_key_monthly_usage
from app.services.metrics_collector import metrics_collector
from app.services.health_check import trigger_probe
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.services.chatgpt_client import CloudflareChallengeError, TokenExpiredError
from app.config import settings
from app.utils.logger import log

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
):
    """Handle chat completion requests with ChatGPT Plus backend streaming."""
    await rate_limit_dependency(request, api_key)

    if not is_model_allowed_for_key(api_key, body.model):
        return _error_response(
            f"The model '{body.model}' does not exist or is not available.",
            "model_not_found",
            404,
        )

    entry = await pool.acquire_async()
    if not entry:
        return _error_response(
            "All account concurrency slots are currently in use. Please try again later.",
            "rate_limit_exceeded",
            429,
        )

    req_start = time.time()
    completion_id = _generate_completion_id()

    asyncio.create_task(_increment_counters(entry.account_id, api_key))

    try:
        if body.stream:
            return StreamingResponse(
                _stream_completion(entry, body, completion_id, req_start),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            return await _non_stream_completion(entry, body, completion_id, req_start)
    except Exception as e:
        _release_on_error(entry, req_start, body.model)
        log.error("Chat completion error", extra={"error": str(e)})
        return _error_response(str(e), "internal_error")


async def _increment_counters(account_id: str, api_key: str) -> None:
    try:
        await increment_usage_count(account_id)
    except Exception as e:
        log.error("Failed to update usage stats", extra={"error": str(e)})
    try:
        await increment_key_monthly_usage(api_key)
    except Exception as e:
        log.error("Failed to update key monthly usage", extra={"error": str(e)})


async def _stream_completion(
    entry: PoolEntry,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
) -> AsyncGenerator[str, None]:
    """Stream chat completion via ChatGPTClient + ChatGPTAdapter."""
    try:
        messages = [{"role": m.role, "content": m.content} for m in body.messages]
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        # Yield initial role chunk
        init_chunk = ChatGPTAdapter.build_chat_chunk(
            completion_id, body.model, role="assistant"
        )
        init_line = f"data: {json.dumps(init_chunk)}\n\n"
        log.debug("ChatCompletions yield init", extra={"line": init_line[:200]})
        yield init_line

        # Stream from ChatGPT backend
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
                    out_line = f"data: {json.dumps(chunk)}\n\n"
                    log.debug("ChatCompletions yield text", extra={"text": text, "line": out_line[:200]})
                    yield out_line
            except json.JSONDecodeError:
                pass

        # Yield stop chunk
        stop_chunk = ChatGPTAdapter.build_chat_chunk(
            completion_id, body.model, finish_reason="stop"
        )
        stop_line = f"data: {json.dumps(stop_chunk)}\n\n"
        log.debug("ChatCompletions yield stop", extra={"line": stop_line[:200]})
        yield stop_line
        yield "data: [DONE]\n\n"

        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, True)

    except (CloudflareChallengeError, TokenExpiredError) as e:
        log.warn("ChatGPT backend error", extra={"account_id": entry.account_id, "error": str(e)})
        error_data = {
            "error": {"message": str(e), "type": "server_error", "code": "api_error"}
        }
        yield f"data: {json.dumps(error_data)}\n\n"
        yield "data: [DONE]\n\n"
        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, False)
        asyncio.create_task(_trigger_probe_safe(entry.account_id))
    except Exception as e:
        log.error("Stream error", extra={"error": str(e)})
        error_data = {
            "error": {"message": str(e), "type": "server_error", "code": "internal_error"}
        }
        yield f"data: {json.dumps(error_data)}\n\n"
        yield "data: [DONE]\n\n"
        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, False)
        asyncio.create_task(_trigger_probe_safe(entry.account_id))
    finally:
        pool.release(entry.account_id)


async def _non_stream_completion(
    entry: PoolEntry,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
) -> JSONResponse:
    """Non-streaming completion via ChatGPTClient."""
    try:
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
        metrics_collector.record(body.model, entry.account_id, latency_ms, True)
        return JSONResponse(content=result)

    except Exception as e:
        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, False)
        asyncio.create_task(_trigger_probe_safe(entry.account_id))
        raise
    finally:
        pool.release(entry.account_id)


async def _trigger_probe_safe(account_id: str) -> None:
    try:
        await trigger_probe(account_id)
    except Exception:
        pass


def _release_on_error(entry: PoolEntry, req_start: float, model: str) -> None:
    pool.release(entry.account_id)
    latency_ms = int((time.time() - req_start) * 1000)
    metrics_collector.record(model, entry.account_id, latency_ms, False)
