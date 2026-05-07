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
from app.services.chatgpt_adapter import ChatGPTAdapter
from app.services.chatgpt_client import CloudflareChallengeError, TokenExpiredError
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
    """Stream Responses API by forwarding all SSE events from ChatGPT backend.

    The ChatGPT backend returns properly formatted Responses API SSE named events.
    We forward them all (not just text deltas) so the Codex CLI receives the full
    event sequence it expects (output_item.added, content_part.added, etc.).
    """
    item_id = f"msg-nexus-{uuid.uuid4()}"
    full_text = ""
    seen_completed = False

    try:
        prompt = _extract_prompt_from_input(body.input)
        if body.instructions:
            prompt = f"{body.instructions}\n\n{prompt}"

        messages = [{"role": "user", "content": prompt}]
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        # Forward all SSE events from ChatGPT backend
        async for raw_data in client.chat(
            model=body.model,
            messages=messages,
            stream=True,
            temperature=body.temperature,
            max_tokens=body.max_output_tokens,
        ):
            try:
                event_data = json.loads(raw_data)
                event_type = event_data.get("type", "")

                # Rewrite response ID in response-level events
                if "response" in event_data and isinstance(event_data["response"], dict):
                    event_data["response"]["id"] = response_id

                # Track full text from deltas
                if event_type == "response.output_text.delta":
                    text = ChatGPTAdapter.extract_text_from_event(event_data)
                    if text:
                        full_text += text

                # Track completion
                if event_type == "response.completed":
                    seen_completed = True
                    # Ensure output has our item_id
                    output = event_data.get("response", {}).get("output", [])
                    for item in output:
                        if item.get("type") == "message":
                            item["id"] = item_id

                # Forward as named SSE event
                line = ChatGPTAdapter.build_named_event(event_type, event_data)
                log.debug("Responses forward event", extra={"type": event_type, "line": line[:200]})
                yield line

            except json.JSONDecodeError:
                pass

        # If backend didn't send response.completed, emit our own
        if not seen_completed:
            completed_line = ChatGPTAdapter.build_response_completed(
                response_id, body.model, item_id, full_text
            )
            log.debug("Responses yield completed (fallback)", extra={"line": completed_line[:200]})
            yield completed_line

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
    """Non-streaming Responses API via ChatGPTClient."""
    try:
        prompt = _extract_prompt_from_input(body.input)
        if body.instructions:
            prompt = f"{body.instructions}\n\n{prompt}"

        messages = [{"role": "user", "content": prompt}]
        client = entry.chatgpt_client
        if not client:
            raise RuntimeError("ChatGPT client not initialized")

        full_text = ""
        async for raw_data in client.chat(
            model=body.model,
            messages=messages,
            stream=False,
            temperature=body.temperature,
            max_tokens=body.max_output_tokens,
        ):
            try:
                response_data = json.loads(raw_data)
                full_text = ChatGPTAdapter.extract_text_from_response(response_data)
            except json.JSONDecodeError:
                pass

        item_id = f"msg-nexus-{uuid.uuid4()}"
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
                    "content": [{"type": "output_text", "text": full_text}],
                }
            ],
            "status": "completed",
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
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
