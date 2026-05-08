"""Unit tests for ChatGPTAdapter — format conversion between Chat Completions and Responses API."""

from __future__ import annotations

import json

from app.models import ChatCompletionRequest, ChatMessage
from app.services.chatgpt_adapter import ChatGPTAdapter


# ═══════════════════════════════════════════════════════════════
# prepare_request
# ═══════════════════════════════════════════════════════════════


class TestPrepareRequest:
    """Tests for ChatGPTAdapter.prepare_request()."""

    def test_basic_request(self):
        """Simple user message should produce correct params."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hello")],
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert params["model"] == "gpt-5.5"
        assert params["stream"] is False
        assert params["instructions"] == ""
        assert len(params["input_items"]) == 1
        assert params["input_items"][0]["role"] == "user"

    def test_system_message_becomes_instructions(self):
        """System messages should be extracted into instructions."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[
                ChatMessage(role="system", content="You are helpful."),
                ChatMessage(role="user", content="Hi"),
            ],
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert params["instructions"] == "You are helpful."
        assert len(params["input_items"]) == 1
        assert params["input_items"][0]["role"] == "user"

    def test_multiple_system_messages_joined(self):
        """Multiple system messages should be joined with newlines."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[
                ChatMessage(role="system", content="Rule 1"),
                ChatMessage(role="system", content="Rule 2"),
                ChatMessage(role="user", content="Hi"),
            ],
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert params["instructions"] == "Rule 1\nRule 2"

    def test_tool_conversion(self):
        """Chat Completions tools should be converted to Responses API format."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get weather",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert len(params["tools"]) == 1
        assert params["tools"][0]["type"] == "function"
        assert params["tools"][0]["name"] == "get_weather"
        assert "function" not in params["tools"][0]  # unwrapped

    def test_tool_choice_string_passthrough(self):
        """String tool_choice should pass through unchanged."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            tool_choice="auto",
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)
        assert params["tool_choice"] == "auto"

    def test_tool_choice_object_conversion(self):
        """Object tool_choice should be converted."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            tool_choice={"type": "function", "function": {"name": "get_weather"}},
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert params["tool_choice"] == {"type": "function", "name": "get_weather"}

    def test_reasoning_effort_included(self):
        """reasoning_effort should be passed through."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            reasoning_effort="high",
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)
        assert params["reasoning_effort"] == "high"

    def test_response_format_json_object(self):
        """json_object response_format should pass through."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            response_format={"type": "json_object"},
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)
        assert params["response_format"] == {"type": "json_object"}

    def test_response_format_json_schema(self):
        """json_schema response_format should be converted."""
        body = ChatCompletionRequest(
            model="gpt-5.5",
            messages=[ChatMessage(role="user", content="Hi")],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "MySchema", "schema": {"type": "object"}},
            },
            stream=False,
        )
        params = ChatGPTAdapter.prepare_request(body)

        assert params["response_format"]["type"] == "json_schema"
        assert params["response_format"]["name"] == "MySchema"
        assert params["response_format"]["schema"] == {"type": "object"}


# ═══════════════════════════════════════════════════════════════
# _messages_to_input_items
# ═══════════════════════════════════════════════════════════════


class TestMessagesToInputItems:
    """Tests for _messages_to_input_items()."""

    def test_user_plain_text(self):
        items = ChatGPTAdapter._messages_to_input_items([
            ChatMessage(role="user", content="Hello"),
        ])
        assert items[0]["type"] == "message"
        assert items[0]["role"] == "user"
        assert items[0]["content"][0]["type"] == "input_text"
        assert items[0]["content"][0]["text"] == "Hello"

    def test_assistant_plain_text(self):
        items = ChatGPTAdapter._messages_to_input_items([
            ChatMessage(role="assistant", content="Sure!"),
        ])
        assert items[0]["content"][0]["type"] == "output_text"
        assert items[0]["content"][0]["text"] == "Sure!"

    def test_tool_message(self):
        items = ChatGPTAdapter._messages_to_input_items([
            ChatMessage(role="tool", tool_call_id="call-1", content="result"),
        ])
        assert items[0]["type"] == "function_call_output"
        assert items[0]["call_id"] == "call-1"
        assert items[0]["output"] == "result"

    def test_assistant_with_tool_calls(self):
        items = ChatGPTAdapter._messages_to_input_items([
            ChatMessage(
                role="assistant",
                tool_calls=[
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"city":"Beijing"}',
                        },
                    }
                ],
            ),
        ])
        assert items[0]["type"] == "function_call"
        assert items[0]["call_id"] == "call-1"
        assert items[0]["name"] == "get_weather"
        assert items[0]["arguments"] == '{"city":"Beijing"}'

    def test_multimodal_content(self):
        items = ChatGPTAdapter._messages_to_input_items([
            ChatMessage(
                role="user",
                content=[
                    {"type": "text", "text": "Describe this"},
                    {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
                ],
            ),
        ])
        content = items[0]["content"]
        assert len(content) == 2
        assert content[0]["type"] == "input_text"
        assert content[1]["type"] == "input_image"


# ═══════════════════════════════════════════════════════════════
# convert_stream_event
# ═══════════════════════════════════════════════════════════════


class TestConvertStreamEvent:
    """Tests for convert_stream_event()."""

    def test_text_delta_event(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {"type": "response.output_text.delta", "delta": "Hello"},
            "cmpl-1",
            "gpt-5.5",
        )
        assert len(chunks) == 1
        data = json.loads(chunks[0])
        assert data["choices"][0]["delta"]["content"] == "Hello"

    def test_text_done_skipped(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {"type": "response.output_text.done", "text": "full"},
            "cmpl-1",
            "gpt-5.5",
        )
        assert chunks == []

    def test_completed_event_stop(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {
                "type": "response.completed",
                "response": {"output": [{"type": "message"}]},
            },
            "cmpl-1",
            "gpt-5.5",
        )
        assert len(chunks) == 1
        data = json.loads(chunks[0])
        assert data["choices"][0]["finish_reason"] == "stop"

    def test_completed_event_tool_calls(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {
                "type": "response.completed",
                "response": {"output": [{"type": "function_call"}]},
            },
            "cmpl-1",
            "gpt-5.5",
        )
        data = json.loads(chunks[0])
        assert data["choices"][0]["finish_reason"] == "tool_calls"

    def test_completed_with_usage(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {
                "type": "response.completed",
                "response": {
                    "output": [],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
                },
            },
            "cmpl-1",
            "gpt-5.5",
            include_usage=True,
        )
        assert len(chunks) == 2
        usage_chunk = json.loads(chunks[1])
        assert usage_chunk["usage"]["prompt_tokens"] == 10
        assert usage_chunk["usage"]["completion_tokens"] == 5
        assert usage_chunk["choices"] == []

    def test_tool_call_start_event(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {
                "type": "response.output_item.added",
                "item": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "get_weather",
                },
            },
            "cmpl-1",
            "gpt-5.5",
        )
        data = json.loads(chunks[0])
        delta = data["choices"][0]["delta"]
        assert delta["role"] == "assistant"
        assert delta["tool_calls"][0]["function"]["name"] == "get_weather"

    def test_tool_call_delta_event(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {
                "type": "response.function_call_arguments.delta",
                "item_id": "call-1",
                "delta": '{"city"',
            },
            "cmpl-1",
            "gpt-5.5",
        )
        data = json.loads(chunks[0])
        delta = data["choices"][0]["delta"]
        assert delta["tool_calls"][0]["function"]["arguments"] == '{"city"'

    def test_unknown_event_returns_empty(self):
        chunks = ChatGPTAdapter.convert_stream_event(
            {"type": "unknown.event"},
            "cmpl-1",
            "gpt-5.5",
        )
        assert chunks == []


# ═══════════════════════════════════════════════════════════════
# convert_non_stream_response
# ═══════════════════════════════════════════════════════════════


class TestConvertNonStreamResponse:
    """Tests for convert_non_stream_response()."""

    def test_text_response(self):
        result = ChatGPTAdapter.convert_non_stream_response(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "Hello world"}],
                    }
                ],
                "usage": {"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
            },
            "cmpl-1",
            "gpt-5.5",
        )
        assert result["object"] == "chat.completion"
        assert result["choices"][0]["message"]["content"] == "Hello world"
        assert result["choices"][0]["finish_reason"] == "stop"
        assert result["usage"]["prompt_tokens"] == 5

    def test_tool_call_response(self):
        result = ChatGPTAdapter.convert_non_stream_response(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "get_weather",
                        "arguments": '{"city":"Beijing"}',
                    }
                ],
            },
            "cmpl-1",
            "gpt-5.5",
        )
        assert result["choices"][0]["finish_reason"] == "tool_calls"
        tc = result["choices"][0]["message"]["tool_calls"][0]
        assert tc["function"]["name"] == "get_weather"

    def test_empty_response(self):
        result = ChatGPTAdapter.convert_non_stream_response(
            {"output": []},
            "cmpl-1",
            "gpt-5.5",
        )
        assert result["choices"][0]["message"]["content"] == ""


# ═══════════════════════════════════════════════════════════════
# build_chat_chunk / build_usage_chunk
# ═══════════════════════════════════════════════════════════════


class TestBuildChunk:
    def test_build_chat_chunk_role(self):
        chunk = ChatGPTAdapter.build_chat_chunk("cmpl-1", "gpt-5.5", role="assistant")
        assert chunk["object"] == "chat.completion.chunk"
        assert chunk["choices"][0]["delta"]["role"] == "assistant"

    def test_build_chat_chunk_content(self):
        chunk = ChatGPTAdapter.build_chat_chunk("cmpl-1", "gpt-5.5", content="Hi")
        assert chunk["choices"][0]["delta"]["content"] == "Hi"

    def test_build_chat_chunk_finish_reason(self):
        chunk = ChatGPTAdapter.build_chat_chunk("cmpl-1", "gpt-5.5", finish_reason="stop")
        assert chunk["choices"][0]["finish_reason"] == "stop"

    def test_build_usage_chunk(self):
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        chunk = ChatGPTAdapter.build_usage_chunk("cmpl-1", "gpt-5.5", usage)
        assert chunk["choices"] == []
        assert chunk["usage"] == usage


# ═══════════════════════════════════════════════════════════════
# Named event builders
# ═══════════════════════════════════════════════════════════════


class TestNamedEvents:
    def test_build_named_event(self):
        result = ChatGPTAdapter.build_named_event("test.event", {"key": "val"})
        assert result.startswith("event: test.event\n")
        assert "data: " in result
        assert result.endswith("\n\n")

    def test_build_response_created(self):
        result = ChatGPTAdapter.build_response_created("resp-1", "gpt-5.5")
        assert "event: response.created" in result
        data_part = result.split("data: ")[1].rstrip("\n\n")
        data = json.loads(data_part)
        assert data["response"]["status"] == "in_progress"

    def test_build_text_delta(self):
        result = ChatGPTAdapter.build_text_delta("Hello")
        data_part = result.split("data: ")[1].rstrip("\n\n")
        data = json.loads(data_part)
        assert data["delta"] == "Hello"

    def test_build_response_completed(self):
        result = ChatGPTAdapter.build_response_completed(
            "resp-1", "gpt-5.5", "msg-1", "Full text",
            usage={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
        )
        data_part = result.split("data: ")[1].rstrip("\n\n")
        data = json.loads(data_part)
        assert data["response"]["status"] == "completed"
        assert data["response"]["output"][0]["content"][0]["text"] == "Full text"

    def test_build_response_failed(self):
        result = ChatGPTAdapter.build_response_failed("resp-1", "gpt-5.5", "Something broke")
        data_part = result.split("data: ")[1].rstrip("\n\n")
        data = json.loads(data_part)
        assert data["response"]["status"] == "failed"
        assert data["error"]["message"] == "Something broke"
