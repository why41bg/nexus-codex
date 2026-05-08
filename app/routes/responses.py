"""Responses API route - /v1/responses (OpenAI Responses API compatible)."""

from __future__ import annotations

import json
import time
import uuid
import asyncio
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.models import ResponsesRequest
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
    deps: AppDependencies = Depends(get_deps),
):
    """Handle Responses API requests with ChatGPT Plus backend streaming."""
    await rate_limit_dependency(request, api_key)

    if not is_model_allowed_for_key(api_key, body.model):
        return _error_response(
            f"The model '{body.model}' does not exist or is not available.",
            "model_not_found",
            404,
        )

    req_start = time.time()
    response_id = _generate_response_id()

    if body.stream:
        return StreamingResponse(
            _stream_response_with_retry(deps, body, response_id, req_start, api_key),
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
        try:
            result = await with_retry(
                deps,
                lambda entry: _do_non_stream(deps, entry, body, response_id, req_start, api_key),
            )
            return result
        except RuntimeError as e:
            log.error("Responses API exhausted retries", extra={"error": str(e)})
            return _error_response(str(e), "rate_limit_exceeded", 429)
        except Exception as e:
            log.error("Responses API error", extra={"error": str(e)})
            return _error_response(str(e), "internal_error")


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming Responses API via pass-through to ChatGPT backend."""
    asyncio.create_task(_increment_counters(entry.account_id, api_key))

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
    deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True)
    return JSONResponse(content=result)


async def _stream_response_with_retry(
    deps: AppDependencies,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """Stream Responses API with account failover on initial connection errors."""
    from app.utils.retry import MAX_RETRIES

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        entry = await deps.pool.acquire_async()
        if not entry:
            yield ChatGPTAdapter.build_response_failed(
                response_id, body.model,
                "All account concurrency slots are currently in use."
            )
            return

        asyncio.create_task(_increment_counters(entry.account_id, api_key))
        seen_completed = False

        try:
            client = entry.chatgpt_client
            if not client:
                raise RuntimeError("ChatGPT client not initialized")

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

                    if "response" in event_data and isinstance(event_data["response"], dict):
                        event_data["response"]["id"] = response_id

                    if event_type == "response.completed":
                        seen_completed = True

                    yield ChatGPTAdapter.build_named_event(event_type, event_data)
                except json.JSONDecodeError:
                    pass

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
            deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True)
            deps.pool.release(entry.account_id)
            return

        except Exception as e:
            deps.pool.release(entry.account_id)
            latency_ms = int((time.time() - req_start) * 1000)
            deps.metrics_collector.record(body.model, entry.account_id, latency_ms, False)

            if attempt < MAX_RETRIES and is_retryable(e):
                log.warn(
                    "Responses stream retryable error, failing over",
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
                log.error("Response stream error", extra={"error": str(e)})
                yield ChatGPTAdapter.build_response_failed(
                    response_id, body.model, str(e)
                )
                asyncio.create_task(_trigger_probe_safe(entry.account_id))
                return

    yield ChatGPTAdapter.build_response_failed(
        response_id, body.model,
        f"All retry attempts exhausted. Last error: {last_error}"
    )


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
