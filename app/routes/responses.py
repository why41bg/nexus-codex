"""Responses API route - /v1/responses (OpenAI Responses API compatible)."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models import ResponsesRequest, ResponsesInputItem, ContentPart
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import pool, PoolEntry
from app.services.account_store import increment_usage_count
from app.services.config_store import is_model_allowed_for_key, increment_key_monthly_usage
from app.services.metrics_collector import metrics_collector
from app.services.health_check import trigger_probe
from app.config import settings
from app.utils.logger import log

router = APIRouter()


def _extract_prompt_from_input(input_data: str | list[ResponsesInputItem]) -> str:
    """Extract prompt text from Responses API input."""
    if isinstance(input_data, str):
        return input_data

    system_parts: list[str] = []
    user_parts: list[str] = []

    for item in input_data:
        text = _extract_text_from_content(item.content)
        if item.role in ("system", "developer"):
            system_parts.append(text)
        elif item.role == "user":
            user_parts.append(text)

    user_text = "\n".join(user_parts)
    if system_parts:
        return f"{chr(10).join(system_parts)}\n\n{user_text}"
    return user_text


def _extract_text_from_content(content: str | list[ContentPart]) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(
        part.text or ""
        for part in content
        if part.type in ("input_text", "text")
    )


def _generate_response_id() -> str:
    return f"resp-nexus-{uuid.uuid4()}"


def _generate_item_id() -> str:
    return f"msg-nexus-{uuid.uuid4()}"


def _encode_named_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _error_response(message: str, code: str, status: int = 500) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": "server_error", "code": code}},
    )


@router.post("/responses")
async def responses(
    request: Request,
    body: ResponsesRequest,
    api_key: str = Depends(api_key_auth_dependency),
):
    """Handle Responses API requests with OpenAI Python SDK streaming."""
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
            "All account concurrency slots are currently in use.",
            "rate_limit_exceeded",
            429,
        )

    req_start = time.time()
    response_id = _generate_response_id()

    asyncio.create_task(_increment_counters(entry.account_id, api_key))

    try:
        if body.stream:
            return StreamingResponse(
                _stream_response(entry, body, response_id, req_start),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            return await _non_stream_response(entry, body, response_id, req_start)
    except Exception as e:
        _release_on_error(entry, req_start, body.model)
        log.error("Responses API error", extra={"error": str(e)})
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


async def _stream_response(
    entry: PoolEntry,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
) -> AsyncGenerator[str, None]:
    """
    Stream Responses API using OpenAI Python SDK's native streaming.
    Emits token-level deltas via SSE named events.
    """
    item_id = _generate_item_id()
    full_text = ""

    try:
        # Emit response.created
        yield _encode_named_event("response.created", {
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": body.model,
                "output": [],
                "status": "in_progress",
            },
        })

        # Emit output_item.added
        yield _encode_named_event("response.output_item.added", {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "role": "assistant",
                "content": [],
            },
        })

        # Emit content_part.added
        yield _encode_named_event("response.content_part.added", {
            "type": "response.content_part.added",
            "output_index": 0,
            "content_index": 0,
            "part": {"type": "output_text", "text": ""},
        })

        # Build messages for the OpenAI SDK
        prompt = _extract_prompt_from_input(body.input)
        if body.instructions:
            prompt = f"{body.instructions}\n\n{prompt}"

        messages = [{"role": "user", "content": prompt}]

        kwargs = {
            "model": body.model,
            "messages": messages,
            "stream": True,
        }
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if body.max_output_tokens is not None:
            kwargs["max_tokens"] = body.max_output_tokens

        # Stream using official OpenAI Python SDK - token-level deltas!
        stream = entry.client.chat.completions.create(**kwargs)

        input_tokens = 0
        output_tokens = 0

        for chunk in stream:
            if chunk.choices:
                choice = chunk.choices[0]
                if choice.delta and choice.delta.content:
                    delta_text = choice.delta.content
                    full_text += delta_text

                    # Emit response.output_text.delta - token level!
                    yield _encode_named_event("response.output_text.delta", {
                        "type": "response.output_text.delta",
                        "output_index": 0,
                        "content_index": 0,
                        "delta": delta_text,
                    })

            # Track usage from the final chunk
            if chunk.usage:
                input_tokens = chunk.usage.prompt_tokens or 0
                output_tokens = chunk.usage.completion_tokens or 0

        # Emit completion events
        yield _encode_named_event("response.output_text.done", {
            "type": "response.output_text.done",
            "output_index": 0,
            "content_index": 0,
            "text": full_text,
        })

        yield _encode_named_event("response.content_part.done", {
            "type": "response.content_part.done",
            "output_index": 0,
            "content_index": 0,
            "part": {"type": "output_text", "text": full_text},
        })

        yield _encode_named_event("response.output_item.done", {
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": full_text}],
            },
        })

        yield _encode_named_event("response.completed", {
            "type": "response.completed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": body.model,
                "output": [
                    {
                        "id": item_id,
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": full_text}],
                    }
                ],
                "status": "completed",
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                },
            },
        })

        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, True)

    except Exception as e:
        log.error("Response stream error", extra={"error": str(e)})
        yield _encode_named_event("response.failed", {
            "type": "response.failed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": body.model,
                "output": [],
                "status": "failed",
            },
            "error": {"message": str(e), "type": "server_error", "code": "internal_error"},
        })

        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, False)
        asyncio.create_task(_trigger_probe_safe(entry.account_id))
    finally:
        pool.release(entry.account_id)


async def _non_stream_response(
    entry: PoolEntry,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
) -> JSONResponse:
    """Non-streaming Responses API."""
    try:
        prompt = _extract_prompt_from_input(body.input)
        if body.instructions:
            prompt = f"{body.instructions}\n\n{prompt}"

        messages = [{"role": "user", "content": prompt}]

        kwargs = {
            "model": body.model,
            "messages": messages,
        }
        if body.temperature is not None:
            kwargs["temperature"] = body.temperature
        if body.max_output_tokens is not None:
            kwargs["max_tokens"] = body.max_output_tokens

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: entry.client.chat.completions.create(**kwargs)
        )

        content = response.choices[0].message.content if response.choices else ""
        input_tokens = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0
        item_id = _generate_item_id()

        result = {
            "id": response_id,
            "object": "response",
            "created_at": int(time.time()),
            "model": body.model,
            "output": [
                {
                    "id": item_id,
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": content}],
                }
            ],
            "status": "completed",
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            },
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
