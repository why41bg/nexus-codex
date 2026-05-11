"""Messages route — POST /v1/messages (Anthropic Messages API compatible)."""

from __future__ import annotations

import json
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.adapters.anthropic_adapter import AnthropicAdapter
from app.dependencies import AppDependencies, get_deps
from app.models_anthropic import AnthropicMessagesRequest
from app.middleware.auth import api_key_auth_dependency
from app.services.account_pool import PoolEntry
from app.utils.bg_task import create_bg_task
from app.utils.logger import log
from app.utils.retry import with_stream_retry
from app.utils.route_helpers import increment_counters
from app.utils.route_orchestrator import (
    build_sse_response,
    execute_non_stream,
    make_anthropic_error_formatters,
    validate_request,
)

router = APIRouter()


def _generate_message_id() -> str:
    return f"msg_{uuid.uuid4().hex[:24]}"


@router.post("/messages")
async def messages(
    request: Request,
    body: AnthropicMessagesRequest,
    api_key: str = Depends(api_key_auth_dependency),
    deps: AppDependencies = Depends(get_deps),
):
    """Handle Anthropic Messages API requests via ChatGPT Plus backend."""
    message_id = _generate_message_id()

    req_start, api_key_masked = await validate_request(
        request, api_key, body.model, message_id,
        log_prefix="Messages API", stream=body.stream,
        protocol="anthropic",
    )

    if body.stream:
        return build_sse_response(
            _stream_messages_with_retry(deps, body, message_id, req_start, api_key),
            extra_headers={"x-request-id": message_id},
        )

    return await execute_non_stream(
        deps,
        lambda entry: _do_non_stream(deps, entry, body, message_id, req_start, api_key),
        model=body.model,
        api_key_masked=api_key_masked,
        request_id=message_id,
        log_prefix="Messages API",
    )


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: AnthropicMessagesRequest,
    message_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming Messages API via pass-through to ChatGPT backend."""
    create_bg_task(increment_counters(deps, entry.account_id, api_key), name="increment-counters")

    client = entry.chatgpt_client
    if not client:
        raise RuntimeError("ChatGPT client not initialized")

    params = AnthropicAdapter.to_responses_params(body)
    params["stream"] = True

    result = None
    async for raw_data in client.responses(**params):
        try:
            result = json.loads(raw_data)
        except json.JSONDecodeError:
            log.debug(
                "Non-stream: failed to parse response chunk as JSON",
                extra={"raw_data": raw_data[:200] if raw_data else ""},
            )

    if result is None:
        result = {
            "id": message_id,
            "object": "response",
            "created_at": int(time.time()),
            "model": body.model,
            "output": [],
            "status": "completed",
            "usage": {},
        }

    anthropic_response = AnthropicAdapter.to_anthropic_response(
        result, message_id, body.model
    )

    latency_ms = int((time.time() - req_start) * 1000)
    await deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True, api_key)
    return JSONResponse(content=anthropic_response)


async def _stream_messages_with_retry(
    deps: AppDependencies,
    body: AnthropicMessagesRequest,
    message_id: str,
    req_start: float,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """Stream Messages API with account failover on initial connection errors."""

    # Emit message_start exactly once, before any retry loop.
    state, start_event = AnthropicAdapter.begin_stream(message_id, body.model)
    yield start_event

    async def _stream(entry: PoolEntry) -> AsyncGenerator[str, None]:
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        params = AnthropicAdapter.to_responses_params(body)
        params["stream"] = True

        seen_completed = False

        async for raw_data in client.responses(**params):
            try:
                event_data = json.loads(raw_data)
                for sse_line in AnthropicAdapter.convert_stream_event(state, event_data):
                    yield sse_line

                if event_data.get("type") == "response.completed":
                    seen_completed = True
            except json.JSONDecodeError:
                log.debug(
                    "Stream: failed to parse SSE chunk as JSON",
                    extra={"raw_data": raw_data[:200] if raw_data else ""},
                )

        if not seen_completed:
            log.warning(
                "Stream ended without response.completed event; emitting fallback message_stop",
                extra={"message_id": message_id, "model": body.model},
            )
            yield AnthropicAdapter.build_sse({
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": 0},
            })
            yield AnthropicAdapter.build_sse({"type": "message_stop"})

    _no_slot_error, _format_error = make_anthropic_error_formatters()

    async for chunk in with_stream_retry(
        deps, _stream, body.model, api_key, req_start,
        format_no_slot_error=_no_slot_error,
        format_error=_format_error,
    ):
        yield chunk
