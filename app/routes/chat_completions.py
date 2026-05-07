"""Chat Completions API route - /v1/chat/completions."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models import ChatCompletionRequest, ChatMessage
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import pool, PoolEntry
from app.services.account_store import increment_usage_count
from app.services.config_store import is_model_allowed_for_key, increment_key_monthly_usage
from app.services.metrics_collector import metrics_collector
from app.services.health_check import trigger_probe
from app.services.admin_emitter import emit_admin_event
from app.config import settings
from app.utils.logger import log

router = APIRouter()


def _extract_prompt(messages: list[ChatMessage]) -> str:
    """Extract prompt text from messages array, preserving multi-turn context."""
    system_parts: list[str] = []
    conversation_parts: list[str] = []

    for m in messages:
        if m.role == "system":
            system_parts.append(m.content)
        elif m.role == "user":
            conversation_parts.append(f"[user]\n{m.content}")
        elif m.role == "assistant":
            conversation_parts.append(f"[assistant]\n{m.content}")
        elif m.role == "tool":
            conversation_parts.append(f"[tool]\n{m.content}")

    parts = []
    if system_parts:
        parts.append("\n".join(system_parts))
    if conversation_parts:
        parts.append("\n\n".join(conversation_parts))
    return "\n\n".join(parts)


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
    """Handle chat completion requests with OpenAI Python SDK streaming."""
    # Rate limit
    await rate_limit_dependency(request, api_key)

    # Validate model
    if not is_model_allowed_for_key(api_key, body.model):
        return _error_response(
            f"The model '{body.model}' does not exist or is not available.",
            "model_not_found",
            404,
        )

    # Acquire account from pool
    entry = await pool.acquire_async()
    if not entry:
        return _error_response(
            "All account concurrency slots are currently in use. Please try again later.",
            "rate_limit_exceeded",
            429,
        )

    req_start = time.time()
    completion_id = _generate_completion_id()

    # Increment usage counters (fire-and-forget)
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
    """Increment usage counters in background."""
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
    """
    Stream chat completion using OpenAI Python SDK's native streaming.
    This gives true token-level streaming.
    """
    try:
        # Send initial chunk with role
        init_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": body.model,
            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(init_chunk)}\n\n"

        # Use OpenAI SDK streaming
        messages = [{"role": m.role, "content": m.content} for m in body.messages]

        kwargs = {
            "model": body.model,
            "messages": messages,
            "stream": True,
        }
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if body.max_tokens is not None:
            kwargs["max_tokens"] = body.max_tokens

        # Create streaming completion using official OpenAI Python SDK
        stream = entry.client.chat.completions.create(**kwargs)

        for chunk in stream:
            if chunk.choices:
                choice = chunk.choices[0]
                delta = {}
                if choice.delta and choice.delta.content:
                    delta["content"] = choice.delta.content

                if delta:
                    out_chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": body.model,
                        "choices": [
                            {"index": 0, "delta": delta, "finish_reason": None}
                        ],
                    }
                    yield f"data: {json.dumps(out_chunk)}\n\n"

                if choice.finish_reason:
                    stop_chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": body.model,
                        "choices": [
                            {"index": 0, "delta": {}, "finish_reason": choice.finish_reason}
                        ],
                    }
                    yield f"data: {json.dumps(stop_chunk)}\n\n"

        yield "data: [DONE]\n\n"

        # Record success metrics
        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, True)

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
    """Non-streaming completion."""
    try:
        messages = [{"role": m.role, "content": m.content} for m in body.messages]

        kwargs = {
            "model": body.model,
            "messages": messages,
        }
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if body.max_tokens is not None:
            kwargs["max_tokens"] = body.max_tokens

        # Use OpenAI Python SDK (synchronous call in thread pool)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: entry.client.chat.completions.create(**kwargs)
        )

        content = response.choices[0].message.content if response.choices else ""
        usage = {
            "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
            "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            "total_tokens": response.usage.total_tokens if response.usage else 0,
        }

        result = {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": body.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": usage,
        }

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
