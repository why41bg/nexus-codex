"""Integration tests for POST /v1/messages route (Anthropic Messages API)."""

from __future__ import annotations

import json
from unittest.mock import patch

from tests.integration.conftest import parse_sse_data_lines, TEST_MODEL


class TestMessagesNonStream:
    """Non-streaming messages endpoint tests."""

    def test_simple_message(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "message"
        assert data["role"] == "assistant"
        assert data["model"] == TEST_MODEL
        assert "id" in data
        assert "content" in data
        assert "stop_reason" in data
        assert "usage" in data

    def test_message_content_is_list(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": False,
                },
            )

        data = response.json()
        assert isinstance(data["content"], list)
        assert len(data["content"]) >= 1
        assert data["content"][0]["type"] == "text"

    def test_model_not_allowed(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=False,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": "gpt-99",
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": False,
                },
            )

        assert response.status_code == 404
        data = response.json()
        assert data["type"] == "error"
        assert "gpt-99" in data["error"]["message"]

    def test_message_with_system_prompt(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "system": "You are a helpful assistant.",
                    "max_tokens": 1024,
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "message"

    def test_message_with_tools(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "What's the weather?"}],
                    "max_tokens": 1024,
                    "tools": [
                        {
                            "name": "get_weather",
                            "description": "Get weather for a city",
                            "input_schema": {
                                "type": "object",
                                "properties": {"city": {"type": "string"}},
                            },
                        }
                    ],
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "message"

    def test_message_with_thinking(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Solve this problem"}],
                    "max_tokens": 1024,
                    "thinking": {"type": "enabled", "budget_tokens": 2048},
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "message"


class TestMessagesStream:
    """Streaming messages endpoint tests."""

    def test_stream_message(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": True,
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        events = parse_sse_data_lines(response.text)
        assert len(events) >= 2
        assert events[0]["type"] == "message_start"
        assert events[0]["message"]["role"] == "assistant"
        assert events[-1]["type"] == "message_stop"

    def test_stream_has_message_delta(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": True,
                },
            )

        events = parse_sse_data_lines(response.text)
        event_types = [e["type"] for e in events]
        assert "message_delta" in event_types
        assert "message_stop" in event_types
        delta_idx = event_types.index("message_delta")
        stop_idx = event_types.index("message_stop")
        assert delta_idx < stop_idx

    def test_stream_message_start_has_usage(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": True,
                },
            )

        events = parse_sse_data_lines(response.text)
        for event in events:
            if event["type"] == "message_start":
                assert "usage" in event["message"]
                assert "input_tokens" in event["message"]["usage"]
                break

    def test_stream_error_format(self, client):
        with patch(
            "app.routes.messages.is_model_allowed_for_key",
            return_value=False,
        ):
            response = client.post(
                "/v1/messages",
                json={
                    "model": "gpt-99",
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 1024,
                    "stream": True,
                },
            )

        assert response.status_code == 404
        data = response.json()
        assert data["type"] == "error"