"""Anthropic adapter — format conversion between Anthropic Messages API and ChatGPT Responses API.

This adapter is the **single source of truth** for all conversions between
the Anthropic Messages protocol and the ChatGPT Responses protocol used by
the backend. Route handlers in messages.py delegate all format logic here.

Architecture:
- Public methods: called by route handlers (messages.py)
- Private methods (_prefix): internal conversion helpers
"""

from __future__ import annotations

import json
from typing import Any

from app.models_anthropic import AnthropicMessagesRequest, AnthropicThinkingConfig
from app.utils.logger import log


class StreamState:
    """Mutable state tracked across a single streaming response conversion."""

    def __init__(self, message_id: str, model: str) -> None:
        self.message_id = message_id
        self.model = model
        self.content_index: int = 0
        self.current_tool_use_id: str | None = None
        self.current_tool_use_name: str | None = None
        self.started_text_block: bool = False
        self.started_tool_block: bool = False
        self.has_output: bool = False

    def close_text_block(self) -> dict | None:
        """Close the current text content block and advance the index.

        Returns a content_block_stop event dict, or None if no text block
        was open.
        """
        if not self.started_text_block:
            return None
        self.started_text_block = False
        idx = self.content_index
        self.content_index += 1
        return {"type": "content_block_stop", "index": idx}

    def close_tool_block(self) -> dict | None:
        """Close the current tool_use content block and advance the index.

        Returns a content_block_stop event dict, or None if no tool block
        was open.
        """
        if not self.started_tool_block:
            return None
        self.started_tool_block = False
        self.current_tool_use_id = None
        self.current_tool_use_name = None
        idx = self.content_index
        self.content_index += 1
        return {"type": "content_block_stop", "index": idx}


class AnthropicAdapter:
    """Converts between Anthropic Messages API and ChatGPT Responses API.

    All format differences between the two protocols are centralized here:
    - Anthropic messages → Responses API input_items
    - Anthropic tools → Responses API tools
    - Anthropic tool_choice → Responses API tool_choice
    - Anthropic thinking → Responses API reasoning
    - Responses API SSE events → Anthropic SSE events
    - Responses API response → Anthropic message response
    """

    # ═══════════════════════════════════════════════════════
    # Public: Request conversion
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def to_responses_params(body: AnthropicMessagesRequest) -> dict[str, Any]:
        """Convert an AnthropicMessagesRequest to kwargs for ChatGPTClient.responses().

        Returns a dict suitable for ** unpacking into client.responses().
        """
        instructions = AnthropicAdapter._extract_instructions(body.system)
        input_items = AnthropicAdapter._messages_to_input_items(body.messages)
        tools = AnthropicAdapter._convert_tools(body.tools)
        tool_choice = AnthropicAdapter._convert_tool_choice(body.tool_choice)
        reasoning_effort = AnthropicAdapter._convert_thinking(body.thinking)

        params: dict[str, Any] = {
            "model": body.model,
            "input_items": input_items,
            "stream": body.stream,
        }
        if instructions:
            params["instructions"] = instructions
        if tools:
            params["tools"] = tools
            # Only set tool_choice when tools are present.
            params["tool_choice"] = tool_choice or "auto"
        elif tool_choice is not None:
            log.warn(
                "tool_choice provided without tools, ignoring",
                extra={"tool_choice": tool_choice},
            )
        if reasoning_effort:
            params["reasoning_effort"] = reasoning_effort
        return params

    # ═══════════════════════════════════════════════════════
    # Public: Streaming SSE conversion
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def begin_stream(message_id: str, model: str) -> tuple[StreamState, str]:
        """Initialize stream state and return the message_start event."""
        state = StreamState(message_id, model)
        event = AnthropicAdapter.build_sse({
            "type": "message_start",
            "message": {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        })
        return state, event

    @staticmethod
    def convert_stream_event(
        state: StreamState,
        event_data: dict,
    ) -> list[str]:
        """Convert a single ChatGPT Responses API SSE event to Anthropic SSE lines.

        Returns a list of SSE strings (may be empty if the event is skipped).
        Mutates ``state`` to track content block indices and emission flags.
        """
        event_type = event_data.get("type", "")

        # ── response.created → skip (already emitted message_start) ──
        if event_type == "response.created":
            return []

        # ── response.output_item.added ──
        if event_type == "response.output_item.added":
            return AnthropicAdapter._handle_output_item_added(state, event_data)

        # ── text delta ──
        if event_type == "response.output_text.delta":
            return AnthropicAdapter._handle_text_delta(state, event_data)

        # ── function_call arguments delta ──
        if event_type == "response.function_call_arguments.delta":
            return AnthropicAdapter._handle_tool_delta(state, event_data)

        # ── text done ──
        if event_type == "response.output_text.done":
            return AnthropicAdapter._handle_text_done(state)

        # ── function_call done ──
        if event_type == "response.function_call_arguments.done":
            return AnthropicAdapter._handle_tool_done(state)

        # ── response.completed → message_delta + message_stop ──
        if event_type == "response.completed":
            return AnthropicAdapter._handle_completed(state, event_data)

        return []

    # ═══════════════════════════════════════════════════════
    # Public: Non-streaming response conversion
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def to_anthropic_response(
        response_data: dict,
        message_id: str,
        model: str,
    ) -> dict:
        """Convert a non-streaming ChatGPT Responses API response to Anthropic format."""
        content: list[dict] = []
        has_tool_use = False

        output = response_data.get("output", [])
        for item in output:
            item_type = item.get("type", "")
            if item_type == "message":
                for part in item.get("content", []):
                    text = part.get("text", "")
                    if text:
                        content.append({"type": "text", "text": text})
            elif item_type == "function_call":
                has_tool_use = True
                try:
                    tool_input = json.loads(item.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    log.warn(
                        "Failed to parse tool call arguments as JSON",
                        extra={"call_id": item.get("call_id", ""), "name": item.get("name", "")},
                    )
                    tool_input = {}
                content.append({
                    "type": "tool_use",
                    "id": item.get("call_id", ""),
                    "name": item.get("name", ""),
                    "input": tool_input,
                })

        usage_raw = response_data.get("usage", {})
        usage = {
            "input_tokens": usage_raw.get("input_tokens", 0),
            "output_tokens": usage_raw.get("output_tokens", 0),
        }

        stop_reason = "tool_use" if has_tool_use else "end_turn"

        return {
            "id": message_id,
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": usage,
        }

    # ═══════════════════════════════════════════════════════
    # Public: Error formatting
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def format_error(message: str, error_type: str = "invalid_request_error") -> dict:
        """Build an Anthropic-formatted error response dict."""
        return {
            "type": "error",
            "error": {
                "type": error_type,
                "message": message,
            },
        }

    # ═══════════════════════════════════════════════════════
    # Private: Request conversion helpers
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _extract_instructions(system: str | list[dict] | None) -> str:
        """Extract system prompt into a single instructions string."""
        if system is None:
            return ""
        if isinstance(system, str):
            return system
        # list of TextBlockParam dicts
        parts: list[str] = []
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "\n".join(parts)

    @staticmethod
    def _messages_to_input_items(messages: list) -> list[dict]:
        """Convert Anthropic messages to ChatGPT Responses API input_items.

        Blocks within a single Anthropic message are grouped into one Responses
        API message item when possible (text + image blocks), while tool_use and
        tool_result blocks become their own top-level items.
        """
        items: list[dict] = []
        for msg in messages:
            role = msg.role
            content = msg.content

            if isinstance(content, str):
                items.append(AnthropicAdapter._build_message_item(role, content))
                continue

            # content is a list of blocks — accumulate text/image parts for a
            # single message item, flush when we encounter tool blocks.
            pending_parts: list[dict] = []

            def _flush_pending() -> None:
                if pending_parts:
                    items.append({"type": "message", "role": role, "content": list(pending_parts)})
                    pending_parts.clear()

            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type", "")

                if block_type == "text":
                    part_type = "output_text" if role == "assistant" else "input_text"
                    pending_parts.append({"type": part_type, "text": block.get("text", "")})
                elif block_type == "image":
                    # TODO: Verify ChatGPT backend supports multimodal input
                    # before advertising image support to Anthropic clients.
                    source = block.get("source", {})
                    source_type = source.get("type", "")
                    if source_type == "base64":
                        media_type = source.get("media_type", "image/png")
                        image_url = f"data:{media_type};base64,{source.get('data', '')}"
                    else:
                        image_url = source.get("url", "")
                    pending_parts.append({"type": "input_image", "image_url": image_url})
                elif block_type == "tool_use":
                    # tool_use must be a separate top-level item; flush text first.
                    _flush_pending()
                    if role != "assistant":
                        log.warn(
                            "tool_use block in non-assistant message",
                            extra={"role": role, "block_type": "tool_use"},
                        )
                    items.append({
                        "type": "function_call",
                        "call_id": block.get("id", ""),
                        "name": block.get("name", ""),
                        "arguments": json.dumps(block.get("input", {})),
                    })
                elif block_type == "tool_result":
                    # tool_result must be a separate top-level item; flush text first.
                    _flush_pending()
                    if role != "user":
                        log.warn(
                            "tool_result block in non-user message",
                            extra={"role": role, "block_type": "tool_result"},
                        )
                    output = block.get("content", "")
                    if isinstance(output, list):
                        output = "".join(
                            p.get("text", "") if isinstance(p, dict) else str(p)
                            for p in output
                        )
                    items.append({
                        "type": "function_call_output",
                        "call_id": block.get("tool_use_id", ""),
                        "output": str(output),
                    })

            # Flush remaining text/image parts for this message.
            _flush_pending()

        return items

    @staticmethod
    def _build_message_item(role: str, text: str) -> dict:
        """Build a Responses API message-type input item from a plain text string."""
        part_type = "output_text" if role == "assistant" else "input_text"
        return {"type": "message", "role": role, "content": [{"type": part_type, "text": text}]}

    @staticmethod
    def _convert_tools(tools: list | None) -> list[dict] | None:
        """Convert Anthropic tools to ChatGPT Responses API format.

        Anthropic: {"name":"read","description":"...","input_schema":{...}}
        ChatGPT:   {"type":"function","name":"read","description":"...","parameters":{...}}
        """
        if not tools:
            return None
        converted: list[dict] = []
        for tool in tools:
            converted.append({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema,
            })
        return converted

    @staticmethod
    def _convert_tool_choice(tool_choice: str | dict | None) -> str | dict | None:
        """Convert Anthropic tool_choice to ChatGPT Responses API format.

        "auto" → "auto"
        "any"  → "required"
        "none" → "none"
        {"type":"tool","name":"x"} → {"type":"function","name":"x"}
        """
        if tool_choice is None:
            return None
        if isinstance(tool_choice, str):
            if tool_choice == "any":
                return "required"
            return tool_choice
        if isinstance(tool_choice, dict) and tool_choice.get("type") == "tool":
            return {"type": "function", "name": tool_choice.get("name", "")}
        return tool_choice

    @staticmethod
    def _convert_thinking(thinking: AnthropicThinkingConfig | None) -> str | None:
        """Convert Anthropic thinking config to ChatGPT reasoning.effort.

        disabled → None (no reasoning)
        enabled  → effort based on budget_tokens
        adaptive → "medium"
        """
        if thinking is None:
            return None
        if thinking.type == "disabled":
            return None
        if thinking.type == "adaptive":
            return "medium"
        # enabled — map budget_tokens to effort level
        if thinking.budget_tokens <= 1024:
            return "low"
        if thinking.budget_tokens <= 4096:
            return "medium"
        return "high"

    # ═══════════════════════════════════════════════════════
    # Private: Streaming event handlers
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _handle_output_item_added(state: StreamState, event_data: dict) -> list[str]:
        item = event_data.get("item", {})
        if not isinstance(item, dict):
            return []

        if item.get("type") == "function_call":
            state.current_tool_use_id = item.get("call_id", "")
            state.current_tool_use_name = item.get("name", "")
            state.started_tool_block = True
            state.has_output = True
            return [AnthropicAdapter.build_sse({
                "type": "content_block_start",
                "index": state.content_index,
                "content_block": {
                    "type": "tool_use",
                    "id": state.current_tool_use_id,
                    "name": state.current_tool_use_name,
                    "input": {},
                },
            })]

        # message-type item — track but no SSE event needed
        return []

    @staticmethod
    def _handle_text_delta(state: StreamState, event_data: dict) -> list[str]:
        delta = event_data.get("delta", "")
        if isinstance(delta, dict):
            delta = delta.get("text", "")
        if not delta:
            return []

        events: list[str] = []

        if not state.started_text_block:
            state.started_text_block = True
            state.has_output = True
            events.append(AnthropicAdapter.build_sse({
                "type": "content_block_start",
                "index": state.content_index,
                "content_block": {"type": "text", "text": ""},
            }))

        events.append(AnthropicAdapter.build_sse({
            "type": "content_block_delta",
            "index": state.content_index,
            "delta": {"type": "text_delta", "text": str(delta)},
        }))
        return events

    @staticmethod
    def _handle_tool_delta(state: StreamState, event_data: dict) -> list[str]:
        delta = event_data.get("delta", "")
        if not delta:
            return []
        return [AnthropicAdapter.build_sse({
            "type": "content_block_delta",
            "index": state.content_index,
            "delta": {"type": "input_json_delta", "partial_json": str(delta)},
        })]

    @staticmethod
    def _handle_text_done(state: StreamState) -> list[str]:
        event = state.close_text_block()
        if event is None:
            return []
        return [AnthropicAdapter.build_sse(event)]

    @staticmethod
    def _handle_tool_done(state: StreamState) -> list[str]:
        event = state.close_tool_block()
        if event is None:
            return []
        return [AnthropicAdapter.build_sse(event)]

    @staticmethod
    def _handle_completed(state: StreamState, event_data: dict) -> list[str]:
        response = event_data.get("response", {})
        output = response.get("output", [])

        events: list[str] = []

        # Close any unclosed content blocks before emitting message_delta.
        # The ChatGPT backend may omit output_text.done / function_call_arguments.done
        # in edge cases (e.g. empty responses, early termination).
        for close_fn in (state.close_text_block, state.close_tool_block):
            event = close_fn()
            if event is not None:
                events.append(AnthropicAdapter.build_sse(event))

        # Determine stop_reason
        has_tool = any(
            item.get("type") == "function_call" for item in output
        )
        stop_reason = "tool_use" if has_tool else "end_turn"

        # Extract usage
        usage_raw = response.get("usage", {})
        output_tokens = usage_raw.get("output_tokens", 0)

        events.append(AnthropicAdapter.build_sse({
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None},
            "usage": {"output_tokens": output_tokens},
        }))
        events.append(AnthropicAdapter.build_sse({"type": "message_stop"}))
        return events

    # ═══════════════════════════════════════════════════════
    # Public: SSE formatting
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def build_sse(data: dict) -> str:
        """Build an Anthropic anonymous SSE event line.

        Format: data: <json>\n\n
        """
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
