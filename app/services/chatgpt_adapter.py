"""ChatGPT adapter - format conversion between Responses API and Chat Completions.

The ChatGPT backend uses OpenAI Responses API format (SSE named events),
while nexus-codex exposes both Chat Completions and Responses interfaces.
This adapter is the **single source of truth** for all format conversions
between the two APIs.

Architecture:
- Public methods: called by route handlers (chat_completions.py, responses.py)
- Private methods (_prefix): internal conversion helpers
"""

from __future__ import annotations

import json
import time
from typing import Any

from app.models import ChatCompletionRequest
from app.utils.logger import log


class ChatGPTAdapter:
    """Converts between Chat Completions API and Responses API formats.

    All format differences between the two APIs are centralized here:
    - system messages → instructions
    - Chat Completions tools → Responses API tools
    - Chat Completions tool_choice → Responses API tool_choice
    - Chat Completions messages → Responses API input_items
    - Responses API SSE events → Chat Completion chunks
    - Responses API response → Chat Completion response
    """

    # ═══════════════════════════════════════════════════════
    # Public: Request preparation
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def prepare_request(body: ChatCompletionRequest) -> dict:
        """Convert ChatCompletionRequest to kwargs for ChatGPTClient.responses().

        Handles all request-level format differences:
        - Extracts system messages → instructions
        - Converts messages to Responses API input_items (including tool calls)
        - Converts Chat Completions tool format → Responses API tool format
        - Maps Chat Completions parameters to Responses API parameters

        NOTE: Several Chat Completions parameters (max_tokens, temperature, top_p,
        stop, seed) are NOT supported by the ChatGPT backend and are silently
        dropped. See chatgpt_client.py for the authoritative list.

        Returns a dict suitable for ** unpacking into client.responses().
        """
        instructions, messages = ChatGPTAdapter._extract_system_instructions(body.messages)
        input_items = ChatGPTAdapter._messages_to_input_items(messages)
        tools = ChatGPTAdapter._convert_tools_for_responses(body.tools)
        tool_choice = ChatGPTAdapter._convert_tool_choice(body.tool_choice)

        params: dict[str, Any] = {
            "model": body.model,
            "input_items": input_items,
            "instructions": instructions,
            "tools": tools or [],
            "tool_choice": tool_choice or "auto",
            "stream": body.stream,
        }
        if body.reasoning_effort:
            params["reasoning_effort"] = body.reasoning_effort
        if body.parallel_tool_calls is not None:
            params["parallel_tool_calls"] = body.parallel_tool_calls
        if body.response_format:
            params["response_format"] = ChatGPTAdapter._convert_response_format(
                body.response_format
            )
        return params

    # ═══════════════════════════════════════════════════════
    # Public: Response conversion (streaming)
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def convert_stream_event(
        event_data: dict,
        completion_id: str,
        model: str,
        *,
        include_usage: bool = False,
    ) -> list[str]:
        """Convert a Responses API SSE event to chat chunk JSON strings.

        Returns a list of JSON chunk strings (usually one, but may be two
        when include_usage=True and the event is response.completed).
        Returns an empty list if the event should be skipped.

        The final chunk with finish_reason is produced from the
        response.completed event, which carries the authoritative output
        state (text vs tool_calls) and usage statistics.

        When include_usage=True, response.completed produces two chunks:
        1. finish_reason chunk (standard)
        2. usage-only chunk with empty choices (OpenAI stream_options spec)
        """
        event_type = event_data.get("type", "")

        # Skip events whose content is already covered by incremental deltas
        if event_type in ("response.output_text.done", "response.function_call_arguments.done"):
            return []

        # response.completed — extract finish_reason and optionally usage
        if event_type == "response.completed":
            finish_reason = ChatGPTAdapter._finish_reason_from_completed(event_data)
            chunks: list[str] = []

            # Chunk 1: finish_reason
            chunks.append(json.dumps(ChatGPTAdapter.build_chat_chunk(
                completion_id, model, finish_reason=finish_reason
            )))

            # Chunk 2: usage-only (per stream_options.include_usage spec)
            if include_usage:
                usage = ChatGPTAdapter._extract_usage_from_event(event_data)
                if usage:
                    chunks.append(json.dumps(ChatGPTAdapter.build_usage_chunk(
                        completion_id, model, usage
                    )))
            return chunks

        # Tool call events
        tool_call = ChatGPTAdapter._extract_tool_call_from_event(event_data)
        if tool_call:
            log.debug(
                "Adapter: tool call event",
                extra={"tool_call_type": tool_call["type"], "event_type": event_type},
            )
            chunk = ChatGPTAdapter._build_tool_call_chunk(
                completion_id,
                model,
                tool_call["tool_call_id"],
                name=tool_call.get("name"),
                arguments=tool_call.get("arguments"),
            )
            return [json.dumps(chunk)]

        # Text delta events
        text = ChatGPTAdapter._extract_text_from_event(event_data)
        if text:
            chunk = ChatGPTAdapter.build_chat_chunk(completion_id, model, content=text)
            return [json.dumps(chunk)]

        return []

    # ═══════════════════════════════════════════════════════
    # Public: Response conversion (non-streaming)
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def convert_non_stream_response(
        response_data: dict,
        completion_id: str,
        model: str,
    ) -> dict:
        """Convert a non-streaming Responses API response to Chat Completion format.

        Handles:
        - Pure text responses
        - Tool call responses (function_call items in output)
        - Mixed text + tool call responses
        - Real usage statistics from the backend
        """
        text = ChatGPTAdapter._extract_text_from_response(response_data)
        tool_calls = ChatGPTAdapter._extract_tool_calls_from_response(response_data)
        usage = ChatGPTAdapter._extract_usage_from_response(response_data)

        finish_reason = "tool_calls" if tool_calls else "stop"

        return ChatGPTAdapter._build_chat_response(
            completion_id,
            model,
            text=text or None,
            tool_calls=tool_calls or None,
            finish_reason=finish_reason,
            usage=usage,
        )

    # ═══════════════════════════════════════════════════════
    # Public: Chat Completion chunk builders
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def build_chat_chunk(
        completion_id: str,
        model: str,
        *,
        role: str | None = None,
        content: str | None = None,
        finish_reason: str | None = None,
        usage: dict | None = None,
    ) -> dict:
        """Build a Chat Completion Chunk dict.

        Used for:
        - Initial chunk (role="assistant")
        - Content delta chunks (content="...")
        - Final chunk (finish_reason="stop" or "tool_calls")
        - Usage chunk (usage={...}, choices=[])
        """
        delta: dict[str, Any] = {}
        if role:
            delta["role"] = role
        if content:
            delta["content"] = content

        choices: list[dict] = []
        if usage is None:
            choices = [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": finish_reason,
                }
            ]

        result: dict[str, Any] = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": choices,
        }
        if usage is not None:
            result["usage"] = usage
        return result

    @staticmethod
    def build_usage_chunk(
        completion_id: str,
        model: str,
        usage: dict,
    ) -> dict:
        """Build a usage-only chunk for stream_options.include_usage.

        Per OpenAI spec, this chunk has empty choices and only carries usage data.
        """
        return {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [],
            "usage": usage,
        }

    # ═══════════════════════════════════════════════════════
    # Public: Responses API named event builders
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def build_named_event(event_name: str, data: dict) -> str:
        """Build an SSE named event string.

        Format: event: <name>\\ndata: <json>\\n\\n
        """
        return f"event: {event_name}\ndata: {json.dumps(data)}\n\n"

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

    # ═══════════════════════════════════════════════════════
    # Private: message / tool conversion
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _extract_system_instructions(messages: list) -> tuple[str, list]:
        """Extract system messages and convert to instructions string.

        ChatGPT Codex backend (Responses API) does not support system-role
        messages. System messages are extracted and joined into an
        instructions string; non-system messages are returned as-is.

        Handles both plain text and multimodal system message content.
        """
        system_texts: list[str] = []
        filtered: list = []
        for m in messages:
            if m.role == "system":
                system_texts.append(ChatGPTAdapter._flatten_content(m.content))
            else:
                filtered.append(m)
        instructions = "\n".join(system_texts) if system_texts else ""
        return instructions, filtered

    @staticmethod
    def _messages_to_input_items(messages: list) -> list[dict]:
        """Convert Chat Completions messages to Responses API input_items.

        Handles all message types per the OpenAI Chat Completions spec:

        - role="user" (plain text):
            → {"type":"message", "role":"user", "content":[{"type":"input_text","text":"..."}]}

        - role="user" (multimodal):
            → {"type":"message", "role":"user", "content":[
                {"type":"input_text","text":"..."},
                {"type":"input_image","image_url":"..."}
              ]}

        - role="assistant" (plain text):
            → {"type":"message", "role":"assistant", "content":[{"type":"output_text","text":"..."}]}

        - role="assistant" (with tool_calls):
            → {"type":"function_call", "call_id":"...", "name":"...", "arguments":"..."}

        - role="tool" (function result):
            → {"type":"function_call_output", "call_id":"...", "output":"..."}

        - role="system": already extracted by _extract_system_instructions, not expected here.
        """
        items: list[dict] = []
        for m in messages:
            role = m.role

            if role == "tool":
                items.append({
                    "type": "function_call_output",
                    "call_id": m.tool_call_id or "",
                    "output": ChatGPTAdapter._flatten_content(m.content),
                })
                continue

            if role == "assistant" and m.tool_calls:
                for tc in m.tool_calls:
                    fn = tc.get("function", {})
                    items.append({
                        "type": "function_call",
                        "call_id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "arguments": fn.get("arguments", ""),
                    })
                continue

            # user / assistant plain text (including multimodal for user)
            content_parts = ChatGPTAdapter._convert_content_to_parts(m.content, role)
            items.append({
                "type": "message",
                "role": role,
                "content": content_parts,
            })

        return items

    @staticmethod
    def _convert_content_to_parts(content: str | list[dict] | None, role: str) -> list[dict]:
        """Convert message content to Responses API content parts.

        - Plain string → [{"type": "input_text"/"output_text", "text": "..."}]
        - Multimodal list → converts image_url parts to input_image format
        """
        if content is None:
            return [{"type": "input_text" if role != "assistant" else "output_text", "text": ""}]

        if isinstance(content, str):
            part_type = "output_text" if role == "assistant" else "input_text"
            return [{"type": part_type, "text": content}]

        # Multimodal content array
        parts: list[dict] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            part_type = part.get("type", "")
            if part_type == "text":
                parts.append({
                    "type": "input_text",
                    "text": part.get("text", ""),
                })
            elif part_type == "image_url":
                image_url = part.get("image_url", {})
                url = image_url.get("url", "") if isinstance(image_url, dict) else str(image_url)
                parts.append({
                    "type": "input_image",
                    "image_url": url,
                })
        return parts or [{"type": "input_text", "text": ""}]

    @staticmethod
    def _flatten_content(content: str | list[dict] | None) -> str:
        """Extract plain text from potentially multimodal content."""
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        texts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                texts.append(part.get("text", ""))
        return " ".join(texts)

    @staticmethod
    def _convert_tools_for_responses(tools: list[dict] | None) -> list[dict] | None:
        """Convert Chat Completions tool format to Responses API format.

        Chat Completions: {"type":"function", "function":{"name":"x", ...}}
        Responses API:    {"type":"function", "name":"x", ...}

        Tools already in Responses API format are passed through unchanged.
        """
        if not tools:
            return None
        converted: list[dict] = []
        for tool in tools:
            if tool.get("type") == "function" and "function" in tool:
                fn = tool["function"]
                converted.append({
                    "type": "function",
                    "name": fn.get("name", ""),
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {}),
                })
            else:
                converted.append(tool)
        return converted

    @staticmethod
    def _convert_tool_choice(tool_choice: str | dict | None) -> str | dict | None:
        """Convert Chat Completions tool_choice to Responses API format.

        String forms ("none"/"auto"/"required") pass through unchanged.
        Object form {"type":"function","function":{"name":"x"}} →
                     {"type":"function","name":"x"}
        """
        if tool_choice is None:
            return None
        if isinstance(tool_choice, str):
            return tool_choice
        if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
            fn = tool_choice.get("function", {})
            return {
                "type": "function",
                "name": fn.get("name", "") if isinstance(fn, dict) else "",
            }
        return tool_choice

    @staticmethod
    def _convert_response_format(response_format: dict) -> dict:
        """Convert Chat Completions response_format to Responses API text.format.

        Chat Completions:
          {"type": "json_object"}
          {"type": "json_schema", "json_schema": {"name": "...", "schema": {...}}}

        Responses API:
          {"type": "json_object"}
          {"type": "json_schema", "schema": {...}}
        """
        fmt_type = response_format.get("type", "")
        if fmt_type == "json_schema":
            json_schema = response_format.get("json_schema", {})
            return {
                "type": "json_schema",
                "name": json_schema.get("name", "") if isinstance(json_schema, dict) else "",
                "schema": json_schema.get("schema", {}) if isinstance(json_schema, dict) else {},
            }
        return response_format

    # ═══════════════════════════════════════════════════════
    # Private: event extraction
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _extract_text_from_event(event_data: dict) -> str:
        """Extract text content from a Responses API SSE event.

        Handles:
        - response.output_text.delta: {"delta": "text"}
        - response.output_text.done:  {"text": "full text"}
        - Legacy formats with "text", "content", etc.

        Explicitly skips function_call events to avoid treating tool call
        arguments as text output.
        """
        if not isinstance(event_data, dict):
            return ""

        event_type = event_data.get("type", "")

        # Never extract text from function call events
        if event_type.startswith("response.function_call"):
            return ""

        # response.output_text.delta
        if "delta" in event_data:
            delta = event_data["delta"]
            if isinstance(delta, str):
                return delta
            if isinstance(delta, dict):
                return delta.get("text", "")

        event_type = event_data.get("type", "")

        # response.output_text.done
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
    def _extract_tool_call_from_event(event_data: dict) -> dict | None:
        """Extract tool call info from a Responses API SSE event.

        The ChatGPT backend uses these event types for function calls:
        - response.output_item.added (item.type == "function_call"): start
        - response.function_call_arguments.delta: argument fragments

        Returns a dict with keys: type ("start"|"delta"), tool_call_id,
        name (for start), arguments (for delta).
        Returns None if the event is not tool-call-related.
        """
        event_type = event_data.get("type", "")

        # response.output_item.added with function_call item → start
        if event_type == "response.output_item.added":
            item = event_data.get("item", {})
            if isinstance(item, dict) and item.get("type") == "function_call":
                return {
                    "type": "start",
                    "tool_call_id": item.get("call_id", ""),
                    "name": item.get("name", ""),
                }

        # response.function_call_arguments.delta → argument fragment
        if event_type == "response.function_call_arguments.delta":
            return {
                "type": "delta",
                "tool_call_id": event_data.get("item_id", ""),
                "arguments": event_data.get("delta", ""),
            }

        return None

    @staticmethod
    def _finish_reason_from_completed(event_data: dict) -> str:
        """Determine finish_reason from a response.completed event.

        Inspects the response output to decide whether the model produced
        text ("stop") or requested tool calls ("tool_calls").
        """
        response = event_data.get("response", {})
        output = response.get("output", [])
        for item in output:
            if item.get("type") == "function_call":
                return "tool_calls"
        return "stop"

    @staticmethod
    def _extract_usage_from_event(event_data: dict) -> dict | None:
        """Extract usage statistics from a response.completed event.

        Converts Responses API token names to Chat Completions names:
        input_tokens → prompt_tokens, output_tokens → completion_tokens.
        """
        response = event_data.get("response", {})
        usage = response.get("usage")
        if not usage or not isinstance(usage, dict):
            return None
        return {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }

    # ═══════════════════════════════════════════════════════
    # Private: response extraction (non-streaming)
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _extract_text_from_response(response_data: dict) -> str:
        """Extract full text from message-type items in a Responses API response.

        Response format:
        {"output": [{"type":"message", "content": [{"type":"output_text", "text":"..."}]}]}
        """
        output = response_data.get("output", [])
        parts: list[str] = []
        for item in output:
            if item.get("type") != "message":
                continue
            for part in item.get("content", []):
                text = part.get("text", "")
                if text:
                    parts.append(text)
        return "".join(parts)

    @staticmethod
    def _extract_tool_calls_from_response(response_data: dict) -> list[dict]:
        """Extract tool calls from function_call items in a Responses API response.

        Converts:
          {"type":"function_call", "call_id":"x", "name":"f", "arguments":"{}"}
        To Chat Completions format:
          {"id":"x", "type":"function", "function":{"name":"f", "arguments":"{}"}}
        """
        output = response_data.get("output", [])
        tool_calls: list[dict] = []
        for item in output:
            if item.get("type") != "function_call":
                continue
            tool_calls.append({
                "id": item.get("call_id", ""),
                "type": "function",
                "function": {
                    "name": item.get("name", ""),
                    "arguments": item.get("arguments", ""),
                },
            })
        return tool_calls

    @staticmethod
    def _extract_usage_from_response(response_data: dict) -> dict:
        """Extract and convert usage statistics from a Responses API response.

        Converts Responses API token names to Chat Completions names:
        input_tokens → prompt_tokens, output_tokens → completion_tokens.
        """
        usage = response_data.get("usage", {})
        if not isinstance(usage, dict):
            return {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
        return {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }

    # ═══════════════════════════════════════════════════════
    # Private: response builders
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _build_tool_call_chunk(
        completion_id: str,
        model: str,
        tool_call_id: str,
        *,
        name: str | None = None,
        arguments: str | None = None,
    ) -> dict:
        """Build a Chat Completion Chunk with tool_calls in the delta.

        Follows the OpenAI streaming tool_call format:
        - First chunk (name present): delta includes role="assistant" plus
          tool_calls with id, type, function.name, and empty arguments.
        - Subsequent chunks (arguments present): delta only includes
          tool_calls with index and function.arguments — no id, type, or role.

        Per OpenAI spec, the first tool_call chunk MUST carry role="assistant"
        so clients can correctly transition from text to tool_call state.
        """
        tool_call: dict[str, Any] = {"index": 0}
        delta: dict[str, Any] = {}

        if name is not None:
            tool_call["id"] = tool_call_id
            tool_call["type"] = "function"
            tool_call["function"] = {"name": name, "arguments": ""}
            delta["role"] = "assistant"
        elif arguments is not None:
            tool_call["function"] = {"arguments": arguments}

        delta["tool_calls"] = [tool_call]

        return {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": None,
                }
            ],
        }

    @staticmethod
    def _build_chat_response(
        completion_id: str,
        model: str,
        *,
        text: str | None = None,
        tool_calls: list[dict] | None = None,
        finish_reason: str = "stop",
        usage: dict | None = None,
    ) -> dict:
        """Build a non-streaming Chat Completion response dict.

        Handles:
        - Pure text: message={"role":"assistant", "content":"..."}
        - Tool calls: message={"role":"assistant", "content":null, "tool_calls":[...]}
        - Mixed: message={"role":"assistant", "content":"...", "tool_calls":[...]}
        """
        message: dict[str, Any] = {"role": "assistant"}

        if tool_calls:
            message["tool_calls"] = tool_calls
            message["content"] = text
        else:
            message["content"] = text or ""

        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": finish_reason,
                }
            ],
            "usage": usage
            or {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }
