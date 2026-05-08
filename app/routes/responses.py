"""Responses API route - /v1/responses (OpenAI Responses API compatible)."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models import ResponsesRequest
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


def _generate_response_id() -> str:
    return f"resp-nexus-{uuid.uuid4()}"


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
    """Handle Responses API requests with ChatGPT Plus backend streaming."""
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
                    "openai-model": body.model,
                    "x-request-id": response_id,
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
    """Stream Responses API by transparently forwarding to ChatGPT backend.

    Passes through the raw Responses API request fields (input, tools,
    instructions, previous_response_id) directly to the ChatGPT backend
    without reinterpretation. Rewrites response IDs for consistency.
    """
    seen_completed = False

    try:
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        # Pass-through: forward raw request fields to ChatGPT backend
        async for raw_data in client.responses(
            model=body.model,
            input_items=body.input,
            instructions=body.instructions,
            tools=body.tools,
            tool_choice=body.tool_choice,
            parallel_tool_calls=body.parallel_tool_calls,
            previous_response_id=body.previous_response_id,
            temperature=body.temperature,
            max_output_tokens=body.max_output_tokens,
            reasoning_effort=body.reasoning_effort,
            stream=True,
        ):
            try:
                event_data = json.loads(raw_data)
                event_type = event_data.get("type", "")

                # Rewrite response ID in response-level events
                if "response" in event_data and isinstance(event_data["response"], dict):
                    event_data["response"]["id"] = response_id

                # Track completion
                if event_type == "response.completed":
                    seen_completed = True

                # Forward as named SSE event
                line = ChatGPTAdapter.build_named_event(event_type, event_data)
                log.debug("Responses forward event", extra={"type": event_type, "line": line[:200]})
                yield line

            except json.JSONDecodeError:
                pass

        # If backend didn't send response.completed, emit our own
        if not seen_completed:
            yield ChatGPTAdapter.build_named_event("response.completed", {
                "type": "response.completed",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "created_at": int(time.time()),
                    "model": body.model,
                    "output": [],
                    "status": "completed",
                },
            })

        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, True)

    except (CloudflareChallengeError, TokenExpiredError) as e:
        log.warn("ChatGPT backend error", extra={"account_id": entry.account_id, "error": str(e)})
        yield ChatGPTAdapter.build_response_failed(response_id, body.model, str(e))
        latency_ms = int((time.time() - req_start) * 1000)
        metrics_collector.record(body.model, entry.account_id, latency_ms, False)
        asyncio.create_task(_trigger_probe_safe(entry.account_id))
    except Exception as e:
        log.error("Response stream error", extra={"error": str(e)})
        yield ChatGPTAdapter.build_response_failed(response_id, body.model, str(e))
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
    """Non-streaming Responses API via pass-through to ChatGPT backend."""
    try:
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        result = None
        async for raw_data in client.responses(
            model=body.model,
            input_items=body.input,
            instructions=body.instructions,
            tools=body.tools,
            tool_choice=body.tool_choice,
            parallel_tool_calls=body.parallel_tool_calls,
            previous_response_id=body.previous_response_id,
            temperature=body.temperature,
            max_output_tokens=body.max_output_tokens,
            reasoning_effort=body.reasoning_effort,
            stream=False,
        ):
            try:
                result = json.loads(raw_data)
                result["id"] = response_id
            except json.JSONDecodeError:
                pass

        if result is None:
            result = {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": body.model,
                "output": [],
                "status": "completed",
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
