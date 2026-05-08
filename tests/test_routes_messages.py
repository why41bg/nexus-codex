"""Integration tests for POST /v1/messages route (Anthropic Messages API)."""

from __future__ import annotations

import json
from unittest.mock import patch

from tests.conftest import TEST_MODEL


# ═══════════════════════════════════════════════════════════════
# Non-streaming tests
# ═══════════════════════════════════════════════════════════════


class TestMessagesNonStream:
    """Non-streaming messages endpoint tests."""

    def test_simple_message(self, client):
        """Basic non-streaming message should return Anthropic format."""
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
        """Response content should be a list of content blocks."""
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
        """Model not in allowed list should return Anthropic-formatted error."""
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
        """Message with system prompt should work."""
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
        """Message with tools should work."""
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
                                "properties": {
                                    "city": {"type": "string"}
                                },
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
        """Message with thinking config should work."""
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


# ═══════════════════════════════════════════════════════════════
# Streaming tests
# ═══════════════════════════════════════════════════════════════


class TestMessagesStream:
    """Streaming messages endpoint tests."""

    def test_stream_message(self, client):
        """Streaming message should yield Anthropic SSE events."""
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

        # Parse SSE lines
        lines = response.text.strip().split("\n\n")
        events = []
        for block in lines:
            if block.startswith("data: "):
                events.append(json.loads(block[6:]))

        assert len(events) >= 2
        # First event should be message_start
        assert events[0]["type"] == "message_start"
        assert events[0]["message"]["role"] == "assistant"
        # Last event should be message_stop
        assert events[-1]["type"] == "message_stop"

    def test_stream_has_message_delta(self, client):
        """Streaming response should include message_delta before message_stop."""
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

        lines = response.text.strip().split("\n\n")
        events = []
        for block in lines:
            if block.startswith("data: "):
                events.append(json.loads(block[6:]))

        event_types = [e["type"] for e in events]
        assert "message_delta" in event_types
        assert "message_stop" in event_types
        # message_delta should come before message_stop
        delta_idx = event_types.index("message_delta")
        stop_idx = event_types.index("message_stop")
        assert delta_idx < stop_idx

    def test_stream_message_start_has_usage(self, client):
        """message_start event should include usage field."""
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

        lines = response.text.strip().split("\n\n")
        for block in lines:
            if block.startswith("data: "):
                event = json.loads(block[6:])
                if event["type"] == "message_start":
                    assert "usage" in event["message"]
                    assert "input_tokens" in event["message"]["usage"]
                    break

    def test_stream_error_format(self, client):
        """Error during streaming should return Anthropic-formatted error SSE."""
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

        # Non-streaming error (model check happens before stream starts)
        assert response.status_code == 404
        data = response.json()
        assert data["type"] == "error"
