"""Responses API route - /v1/responses (OpenAI Responses API compatible)."""

from __future__ import annotations

import json
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.utils.logger import log
from app.models import ResponsesRequest
from app.middleware.auth import api_key_auth_dependency
from app.services.account_pool import PoolEntry
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.utils.bg_task import create_bg_task
from app.utils.retry import with_stream_retry
from app.utils.route_helpers import increment_counters
from app.utils.route_orchestrator import (
    build_sse_response,
    execute_non_stream,
    make_responses_error_formatters,
    validate_request,
)

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
    response_id = _generate_response_id()

    req_start, api_key_masked = await validate_request(
        request, api_key, body.model, response_id,
        log_prefix="Responses API", stream=body.stream,
    )

    if body.stream:
        return build_sse_response(
            _stream_response_with_retry(deps, body, response_id, req_start, api_key),
            extra_headers={
                "openai-model": body.model,
                "x-request-id": response_id,
            },
        )

    return await execute_non_stream(
        deps,
        lambda entry: _do_non_stream(deps, entry, body, response_id, req_start, api_key),
        model=body.model,
        api_key_masked=api_key_masked,
        request_id=response_id,
        log_prefix="Responses API",
        session_id=body.previous_response_id,
    )


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ResponsesRequest,
    response_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming Responses API via pass-through to ChatGPT backend."""
    create_bg_task(increment_counters(deps, entry.account_id, api_key), name="increment-counters")

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
            log.warning(
                "Non-stream responses: failed to parse response chunk as JSON",
                extra={"response_id": response_id, "raw_data": raw_data[:200] if raw_data else ""},
            )

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
                log.warning(
                    "Stream responses: failed to parse SSE chunk as JSON",
                    extra={"response_id": response_id, "raw_data": raw_data[:200] if raw_data else ""},
                )

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

    _no_slot_error, _format_error = make_responses_error_formatters(response_id, body.model)

    async for chunk in with_stream_retry(
        deps, _stream, body.model, api_key, req_start,
        format_no_slot_error=_no_slot_error,
        format_error=_format_error,
        session_id=body.previous_response_id,
    ):
        yield chunk
