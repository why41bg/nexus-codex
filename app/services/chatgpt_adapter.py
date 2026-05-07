"""ChatGPT adapter - format conversion between Responses API and Chat Completions.

The ChatGPT backend uses OpenAI Responses API format (SSE named events),
while nexus-codex exposes both Chat Completions and Responses interfaces.
This adapter handles bidirectional format conversion.
"""

from __future__ import annotations

import json
import time
from typing import Any


class ChatGPTAdapter:
    """Converts between ChatGPT backend Responses API format and OpenAI standard formats.

    Two main conversion paths:
    1. Responses API SSE events → Chat Completion Chunks (for /v1/chat/completions)
    2. Responses API SSE events → Responses API named events (for /v1/responses, mostly passthrough)
    """

    # ── Chat Completions: SSE event → chunk ─────────────

    @staticmethod
    def extract_text_from_event(event_data: dict) -> str:
        """Extract text content from a Responses API SSE event.

        Handles various event shapes:
        - response.output_text.delta: {"delta": "text"}
        - response.output_text.done: {"text": "full text"}
        - Legacy formats with "text", "content", etc.
        """
        if not isinstance(event_data, dict):
            return ""

        # Named event: response.output_text.delta
        if "delta" in event_data:
            delta = event_data["delta"]
            if isinstance(delta, str):
                return delta
            if isinstance(delta, dict):
                return delta.get("text", "")

        event_type = event_data.get("type", "")

        # Named event: response.output_text.done
        if event_type == "response.output_text.done" and "text" in event_data:
            return str(event_data["text"])

        # Legacy: direct text field
        if "text" in event_data:
            return str(event_data["text"])

        # Legacy: content field (list or string)
        if "content" in event_data:
            content = event_data["content"]
            if isinstance(content, list):
                return "".join(
                    part.get("text", "") if isinstance(part, dict) else str(part)
                    for part in content
                )
            if isinstance(content, str):
                return content

        return ""

    @staticmethod
    def extract_text_from_response(response_data: dict) -> str:
        """Extract full text from a non-streaming Responses API response object.

        The response format is:
        {"output": [{"content": [{"type": "output_text", "text": "..."}]}]}
        """
        output = response_data.get("output", [])
        parts: list[str] = []
        for item in output:
            for part in item.get("content", []):
                text = part.get("text", "")
                if text:
                    parts.append(text)
        return "".join(parts)

    @staticmethod
    def build_chat_chunk(
        completion_id: str,
        model: str,
        *,
        role: str | None = None,
        content: str | None = None,
        finish_reason: str | None = None,
    ) -> dict:
        """Build a Chat Completion Chunk dict.

        Args:
            completion_id: The chat completion ID
            model: Model name
            role: Assistant role (for initial chunk)
            content: Text content delta
            finish_reason: Stop reason (for final chunk)
        """
        delta: dict[str, Any] = {}
        if role:
            delta["role"] = role
        if content:
            delta["content"] = content

        return {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": finish_reason,
                }
            ],
        }

    @staticmethod
    def build_chat_response(
        completion_id: str,
        model: str,
        text: str,
        usage: dict | None = None,
    ) -> dict:
        """Build a non-streaming Chat Completion response dict."""
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ],
            "usage": usage
            or {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }

    # ── Responses API: SSE event → named event ──────────

    @staticmethod
    def build_named_event(event_name: str, data: dict) -> str:
        """Build an SSE named event string.

        Format: event: <name>\\ndata: <json>\\n\\n
        """
        return f"event: {event_name}\ndata: {json.dumps(data)}\n\n"

    @staticmethod
    def build_response_created(response_id: str, model: str) -> str:
        """Build a response.created named event."""
        return ChatGPTAdapter.build_named_event("response.created", {
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": model,
                "output": [],
                "status": "in_progress",
            },
        })

    @staticmethod
    def build_text_delta(delta: str) -> str:
        """Build a response.output_text.delta named event."""
        return ChatGPTAdapter.build_named_event("response.output_text.delta", {
            "type": "response.output_text.delta",
            "output_index": 0,
            "content_index": 0,
            "delta": delta,
        })

    @staticmethod
    def build_response_completed(
        response_id: str,
        model: str,
        item_id: str,
        full_text: str,
        usage: dict | None = None,
    ) -> str:
        """Build a response.completed named event."""
        return ChatGPTAdapter.build_named_event("response.completed", {
            "type": "response.completed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": model,
                "output": [
                    {
                        "id": item_id,
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": full_text}],
                    }
                ],
                "status": "completed",
                "usage": usage
                or {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                },
            },
        })

    @staticmethod
    def build_response_failed(response_id: str, model: str, error_message: str) -> str:
        """Build a response.failed named event."""
        return ChatGPTAdapter.build_named_event("response.failed", {
            "type": "response.failed",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": int(time.time()),
                "model": model,
                "output": [],
                "status": "failed",
            },
            "error": {
                "message": error_message,
                "type": "server_error",
                "code": "api_error",
            },
        })

    # ── Input format conversion ─────────────────────────

    @staticmethod
    def messages_to_input_items(messages: list[dict]) -> list[dict]:
        """Convert Chat Completions messages to Responses API input_items."""
        items = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            part_type = "output_text" if role == "assistant" else "input_text"
            items.append({
                "type": "message",
                "role": role,
                "content": [{"type": part_type, "text": content}],
            })
        return items


