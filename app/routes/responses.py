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
from app.exceptions import ModelNotFoundError, RateLimitError, RetryExhaustedError, BackendError
from app.models import ResponsesRequest
from app.middleware.auth import api_key_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import PoolEntry
from app.services.config_store import is_model_allowed_for_key
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.utils.logger import log
from app.utils.retry import with_retry, with_stream_retry
from app.utils.bg_task import create_bg_task
from app.utils.route_helpers import increment_counters, mask_api_key, set_request_context

router = APIRouter()


def _generate_response_id() -> str:
    return f"resp-nexus-{uuid.uuid4()}"


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
        raise ModelNotFoundError(body.model)

    req_start = time.time()
    response_id = _generate_response_id()
    api_key_masked = mask_api_key(api_key)

    # Store business context for access-log middleware
    set_request_context(request, api_key=api_key, model=body.model, request_id=response_id)

    log.info("Responses API request", extra={
        "model": body.model, "stream": body.stream,
        "api_key": api_key_masked, "request_id": response_id,
    })

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
                model=body.model,
                session_id=body.previous_response_id,
            )
            return result
        except RetryExhaustedError as e:
            log.error("Responses API exhausted retries", extra={
                "error": str(e), "model": body.model,
                "api_key": api_key_masked, "request_id": response_id,
            })
            raise RateLimitError(str(e))
        except RuntimeError as e:
            log.error("Responses API backend error", extra={
                "error": str(e), "model": body.model,
                "api_key": api_key_masked, "request_id": response_id,
            })
            raise BackendError(str(e))
        except Exception as e:
            log.error("Responses API error", extra={
                "error": str(e), "model": body.model,
                "api_key": api_key_masked, "request_id": response_id,
            })
            raise


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming Responses API via pass-through to ChatGPT backend."""
    create_bg_task(increment_counters(entry.account_id, api_key), name="increment-counters")

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
        stream=True,
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
    await deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True, api_key)
    return JSONResponse(content=result)


async def _stream_response_with_retry(
    deps: AppDependencies,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """Stream Responses API with account failover on initial connection errors."""

    async def _stream(entry: PoolEntry) -> AsyncGenerator[str, None]:
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        seen_completed = False

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

    def _no_slot_error() -> str:
        return ChatGPTAdapter.build_response_failed(
            response_id, body.model,
            "All account concurrency slots are currently in use."
        )

    def _format_error(msg: str) -> str:
        return ChatGPTAdapter.build_response_failed(response_id, body.model, msg)

    async for chunk in with_stream_retry(
        deps, _stream, body.model, api_key, req_start,
        format_no_slot_error=_no_slot_error,
        format_error=_format_error,
        session_id=body.previous_response_id,
    ):
        yield chunk