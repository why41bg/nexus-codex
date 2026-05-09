"""Unit tests for AnthropicAdapter — format conversion between Anthropic Messages API and ChatGPT Responses API."""

from __future__ import annotations

import json

from app.adapters.anthropic_adapter import AnthropicAdapter, StreamState
from app.models_anthropic import (
    AnthropicMessagesRequest,
    AnthropicMessage,
    AnthropicThinkingConfig,
    AnthropicTool,
)


# ═══════════════════════════════════════════════════════════════
# to_responses_params
# ═══════════════════════════════════════════════════════════════


class TestToResponsesParams:
    """Tests for AnthropicAdapter.to_responses_params()."""

    def test_basic_request(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hello")],
            max_tokens=100,
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)

        assert params["model"] == "gpt-5.5"
        assert params["stream"] is False
        assert len(params["input_items"]) == 1

    def test_system_string_becomes_instructions(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            system="You are helpful.",
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["instructions"] == "You are helpful."

    def test_system_list_becomes_instructions(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            system=[{"type": "text", "text": "Rule 1"}, {"type": "text", "text": "Rule 2"}],
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["instructions"] == "Rule 1\nRule 2"

    def test_tools_converted(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            tools=[
                AnthropicTool(
                    name="get_weather",
                    description="Get weather",
                    input_schema={"type": "object", "properties": {}},
                )
            ],
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)

        assert len(params["tools"]) == 1
        assert params["tools"][0]["type"] == "function"
        assert params["tools"][0]["name"] == "get_weather"
        assert params["tool_choice"] == "auto"

    def test_tool_choice_any_to_required(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            tools=[AnthropicTool(name="f", input_schema={})],
            tool_choice="any",
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["tool_choice"] == "required"

    def test_tool_choice_object_converted(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            tools=[AnthropicTool(name="f", input_schema={})],
            tool_choice={"type": "tool", "name": "f"},
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["tool_choice"] == {"type": "function", "name": "f"}

    def test_tool_choice_without_tools_ignored(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            tool_choice="auto",
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert "tool_choice" not in params

    def test_thinking_disabled(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            thinking=AnthropicThinkingConfig(type="disabled", budget_tokens=0),
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert "reasoning_effort" not in params

    def test_thinking_enabled_low(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            thinking=AnthropicThinkingConfig(type="enabled", budget_tokens=512),
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["reasoning_effort"] == "low"

    def test_thinking_enabled_medium(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            thinking=AnthropicThinkingConfig(type="enabled", budget_tokens=2048),
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["reasoning_effort"] == "medium"

    def test_thinking_enabled_high(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            thinking=AnthropicThinkingConfig(type="enabled", budget_tokens=8192),
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["reasoning_effort"] == "high"

    def test_thinking_adaptive(self):
        body = AnthropicMessagesRequest(
            model="gpt-5.5",
            messages=[AnthropicMessage(role="user", content="Hi")],
            max_tokens=100,
            thinking=AnthropicThinkingConfig(type="adaptive", budget_tokens=0),
            stream=False,
        )
        params = AnthropicAdapter.to_responses_params(body)
        assert params["reasoning_effort"] == "medium"


# ═══════════════════════════════════════════════════════════════
# _messages_to_input_items
# ═══════════════════════════════════════════════════════════════


class TestMessagesToInputItems:
    """Tests for _messages_to_input_items()."""

    def test_user_plain_text(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(role="user", content="Hello"),
        ])
        assert items[0]["type"] == "message"
        assert items[0]["role"] == "user"
        assert items[0]["content"][0]["type"] == "input_text"

    def test_assistant_plain_text(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(role="assistant", content="Sure!"),
        ])
        assert items[0]["content"][0]["type"] == "output_text"

    def test_tool_use_block(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(
                role="assistant",
                content=[
                    {"type": "tool_use", "id": "tu-1", "name": "get_weather", "input": {"city": "Beijing"}},
                ],
            ),
        ])
        assert items[0]["type"] == "function_call"
        assert items[0]["call_id"] == "tu-1"
        assert items[0]["name"] == "get_weather"
        assert json.loads(items[0]["arguments"]) == {"city": "Beijing"}

    def test_tool_result_block(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(
                role="user",
                content=[
                    {"type": "tool_result", "tool_use_id": "tu-1", "content": "Sunny, 25°C"},
                ],
            ),
        ])
        assert items[0]["type"] == "function_call_output"
        assert items[0]["call_id"] == "tu-1"
        assert items[0]["output"] == "Sunny, 25°C"

    def test_tool_result_list_content(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(
                role="user",
                content=[
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu-1",
                        "content": [{"type": "text", "text": "Sunny"}, {"type": "text", "text": "25°C"}],
                    },
                ],
            ),
        ])
        assert items[0]["output"] == "Sunny25°C"

    def test_image_block(self):
        items = AnthropicAdapter._messages_to_input_items([
            AnthropicMessage(
                role="user",
                content=[
                    {"type": "text", "text": "Describe"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": "abc123",
                        },
                    },
                ],
            ),
        ])
        content = items[0]["content"]
        assert content[0]["type"] == "input_text"
        assert content[1]["type"] == "input_image"
        assert "base64" in content[1]["image_url"]


# ═══════════════════════════════════════════════════════════════
# begin_stream
# ═══════════════════════════════════════════════════════════════


class TestBeginStream:
    def test_begin_stream(self):
        state, event = AnthropicAdapter.begin_stream("msg-1", "gpt-5.5")

        assert state.message_id == "msg-1"
        assert state.model == "gpt-5.5"
        assert state.content_index == 0

        data = json.loads(event.split("data: ")[1].rstrip("\n\n"))
        assert data["type"] == "message_start"
        assert data["message"]["id"] == "msg-1"


# ═══════════════════════════════════════════════════════════════
# convert_stream_event
# ═══════════════════════════════════════════════════════════════


class TestConvertStreamEvent:
    """Tests for convert_stream_event()."""

    def test_response_created_skipped(self):
        state = StreamState("msg-1", "gpt-5.5")
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "response.created"}
        )
        assert events == []

    def test_text_delta_first(self):
        state = StreamState("msg-1", "gpt-5.5")
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "response.output_text.delta", "delta": "Hello"}
        )
        assert len(events) == 2  # content_block_start + content_block_delta
        start_data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert start_data["type"] == "content_block_start"
        delta_data = json.loads(events[1].split("data: ")[1].rstrip("\n\n"))
        assert delta_data["type"] == "content_block_delta"
        assert delta_data["delta"]["text"] == "Hello"

    def test_text_delta_subsequent(self):
        state = StreamState("msg-1", "gpt-5.5")
        state.started_text_block = True
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "response.output_text.delta", "delta": " world"}
        )
        assert len(events) == 1  # only delta, no start
        delta_data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert delta_data["delta"]["text"] == " world"

    def test_text_done(self):
        state = StreamState("msg-1", "gpt-5.5")
        state.started_text_block = True
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "response.output_text.done"}
        )
        assert len(events) == 1
        data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert data["type"] == "content_block_stop"
        assert state.started_text_block is False
        assert state.content_index == 1

    def test_tool_use_start(self):
        state = StreamState("msg-1", "gpt-5.5")
        events = AnthropicAdapter.convert_stream_event(
            state,
            {
                "type": "response.output_item.added",
                "item": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "get_weather",
                },
            },
        )
        assert len(events) == 1
        data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert data["type"] == "content_block_start"
        assert data["content_block"]["type"] == "tool_use"
        assert data["content_block"]["name"] == "get_weather"

    def test_tool_delta(self):
        state = StreamState("msg-1", "gpt-5.5")
        state.started_tool_block = True
        events = AnthropicAdapter.convert_stream_event(
            state,
            {
                "type": "response.function_call_arguments.delta",
                "delta": '{"city"',
            },
        )
        assert len(events) == 1
        data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert data["delta"]["partial_json"] == '{"city"'

    def test_tool_done(self):
        state = StreamState("msg-1", "gpt-5.5")
        state.started_tool_block = True
        state.current_tool_use_id = "call-1"
        state.current_tool_use_name = "get_weather"
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "response.function_call_arguments.done"}
        )
        assert len(events) == 1
        data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert data["type"] == "content_block_stop"
        assert state.started_tool_block is False

    def test_completed_text(self):
        state = StreamState("msg-1", "gpt-5.5")
        state.started_text_block = True
        events = AnthropicAdapter.convert_stream_event(
            state,
            {
                "type": "response.completed",
                "response": {
                    "output": [{"type": "message"}],
                    "usage": {"output_tokens": 10},
                },
            },
        )
        # content_block_stop + message_delta + message_stop
        assert len(events) == 3
        delta_data = json.loads(events[1].split("data: ")[1].rstrip("\n\n"))
        assert delta_data["type"] == "message_delta"
        assert delta_data["delta"]["stop_reason"] == "end_turn"

    def test_completed_tool_use(self):
        state = StreamState("msg-1", "gpt-5.5")
        events = AnthropicAdapter.convert_stream_event(
            state,
            {
                "type": "response.completed",
                "response": {
                    "output": [{"type": "function_call"}],
                    "usage": {"output_tokens": 5},
                },
            },
        )
        # No blocks were open, so only message_delta + message_stop
        assert len(events) == 2
        delta_data = json.loads(events[0].split("data: ")[1].rstrip("\n\n"))
        assert delta_data["type"] == "message_delta"
        assert delta_data["delta"]["stop_reason"] == "tool_use"

    def test_unknown_event(self):
        state = StreamState("msg-1", "gpt-5.5")
        events = AnthropicAdapter.convert_stream_event(
            state, {"type": "unknown.event"}
        )
        assert events == []


# ═══════════════════════════════════════════════════════════════
# to_anthropic_response (non-streaming)
# ═══════════════════════════════════════════════════════════════


class TestToAnthropicResponse:
    """Tests for to_anthropic_response()."""

    def test_text_response(self):
        result = AnthropicAdapter.to_anthropic_response(
            {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "Hello world"}],
                    }
                ],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            },
            "msg-1",
            "gpt-5.5",
        )
        assert result["id"] == "msg-1"
        assert result["role"] == "assistant"
        assert result["stop_reason"] == "end_turn"
        assert result["content"][0]["type"] == "text"
        assert result["content"][0]["text"] == "Hello world"

    def test_tool_use_response(self):
        result = AnthropicAdapter.to_anthropic_response(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "get_weather",
                        "arguments": '{"city":"Beijing"}',
                    }
                ],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            },
            "msg-1",
            "gpt-5.5",
        )
        assert result["stop_reason"] == "tool_use"
        assert result["content"][0]["type"] == "tool_use"
        assert result["content"][0]["name"] == "get_weather"
        assert result["content"][0]["input"] == {"city": "Beijing"}

    def test_invalid_json_arguments(self):
        result = AnthropicAdapter.to_anthropic_response(
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "bad_tool",
                        "arguments": "not-json",
                    }
                ],
            },
            "msg-1",
            "gpt-5.5",
        )
        assert result["content"][0]["input"] == {}

    def test_empty_output(self):
        result = AnthropicAdapter.to_anthropic_response(
            {"output": []},
            "msg-1",
            "gpt-5.5",
        )
        assert result["content"] == []
        assert result["stop_reason"] == "end_turn"


# ═══════════════════════════════════════════════════════════════
# format_error
# ═══════════════════════════════════════════════════════════════


class TestFormatError:
    def test_format_error(self):
        result = AnthropicAdapter.format_error("Something went wrong")
        assert result["type"] == "error"
        assert result["error"]["type"] == "invalid_request_error"
        assert result["error"]["message"] == "Something went wrong"

    def test_format_error_custom_type(self):
        result = AnthropicAdapter.format_error("Rate limited", error_type="rate_limit_error")
        assert result["error"]["type"] == "rate_limit_error"


# ═══════════════════════════════════════════════════════════════
# build_sse
# ═══════════════════════════════════════════════════════════════


class TestBuildSSE:
    def test_build_sse(self):
        result = AnthropicAdapter.build_sse({"type": "message_stop"})
        assert result.startswith("data: ")
        assert result.endswith("\n\n")
        data = json.loads(result.split("data: ")[1].rstrip("\n\n"))
        assert data["type"] == "message_stop"
