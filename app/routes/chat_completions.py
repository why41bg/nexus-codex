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

import hashlib
import json
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.utils.logger import log
from app.models import ChatCompletionRequest
from app.middleware.auth import api_key_auth_dependency
from app.services.account_pool import PoolEntry
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.utils.bg_task import create_bg_task
from app.utils.retry import with_stream_retry
from app.utils.route_helpers import increment_counters
from app.utils.route_orchestrator import (
    build_sse_response,
    execute_non_stream,
    format_no_slot_openai_error,
    format_openai_stream_error,
    validate_request,
)

router = APIRouter()


def _generate_completion_id() -> str:
    return f"chatcmpl-nexus-{uuid.uuid4()}"


def _extract_session_id(body: ChatCompletionRequest, api_key: str) -> str | None:
    """Extract session ID from request for session affinity.

    Uses api_key + hash of message content to create a stable session identifier.
    This ensures the same conversation thread always routes to the same account.
    """
    if not body.messages:
        return None
    # Use api_key + first user message as session key for stability
    first_user_msg = next((m for m in body.messages if m.role == "user"), None)
    if first_user_msg:
        content = first_user_msg.content
        if isinstance(content, str):
            content_hash = hashlib.sha256(content.encode()).hexdigest()[:12]
            return f"{api_key}:{content_hash}"
    return None


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    body: ChatCompletionRequest,
    api_key: str = Depends(api_key_auth_dependency),
    deps: AppDependencies = Depends(get_deps),
):
    """Handle chat completion requests with ChatGPT Plus backend streaming."""
    completion_id = _generate_completion_id()

    req_start, api_key_masked = await validate_request(
        request, api_key, body.model, completion_id,
        log_prefix="Chat completion", stream=body.stream,
    )

    if body.stream:
        return build_sse_response(
            _stream_completion_with_retry(deps, body, completion_id, req_start, api_key)
        )

    return await execute_non_stream(
        deps,
        lambda entry: _do_non_stream(deps, entry, body, completion_id, req_start, api_key),
        model=body.model,
        api_key_masked=api_key_masked,
        request_id=completion_id,
        log_prefix="Chat completion",
        session_id=_extract_session_id(body, api_key),
    )


async def _do_non_stream(
    deps: AppDependencies,
    entry: PoolEntry,
    body: ChatCompletionRequest,
    completion_id: str,
    req_start: float,
    api_key: str,
) -> JSONResponse:
    """Non-streaming completion via ChatGPTClient.responses()."""
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
            log.warning(
                "Non-stream chat completion: failed to parse response chunk as JSON",
                extra={"completion_id": completion_id, "raw_data": raw_data[:200] if raw_data else ""},
            )

    if result is None:
        result = ChatGPTAdapter.convert_non_stream_response(
            {"output": []}, completion_id, body.model
        )

    latency_ms = int((time.time() - req_start) * 1000)
    await deps.metrics_collector.record(body.model, entry.account_id, latency_ms, True, api_key)
    # Increment usage counters only after successful completion to avoid
    # double-counting when with_retry retries the operation.
    create_bg_task(increment_counters(deps, entry.account_id, api_key), name="increment-counters")
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
                log.warning(
                    "Stream chat completion: failed to parse SSE chunk as JSON",
                    extra={"completion_id": completion_id, "raw_data": raw_data[:200] if raw_data else ""},
                )

        yield "data: [DONE]\n\n"

    async for chunk in with_stream_retry(
        deps, _stream, body.model, api_key, req_start,
        format_no_slot_error=format_no_slot_openai_error,
        format_error=format_openai_stream_error,
        append_done=True,
        session_id=_extract_session_id(body, api_key),
    ):
        yield chunk
