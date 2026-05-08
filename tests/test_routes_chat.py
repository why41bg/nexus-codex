"""Integration tests for POST /v1/chat/completions route."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from tests.conftest import sse_text_response, sse_tool_call_response, TEST_MODEL


# ═══════════════════════════════════════════════════════════════
# Non-streaming tests
# ═══════════════════════════════════════════════════════════════


class TestChatCompletionsNonStream:
    """Non-streaming chat completions endpoint tests."""

    def test_simple_text_completion(self, client):
        """Basic non-streaming text completion should return Chat Completion format."""
        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["object"] == "chat.completion"
        assert data["model"] == TEST_MODEL
        assert len(data["choices"]) == 1
        assert data["choices"][0]["finish_reason"] == "stop"
        assert "Hello! How can I help you?" in data["choices"][0]["message"]["content"]
        assert "usage" in data

    def test_model_not_allowed(self, client):
        """Model not in allowed list should return 404."""
        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=False,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": "gpt-99",
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": False,
                },
            )

        assert response.status_code == 404
        data = response.json()
        assert "gpt-99" in data["error"]["message"]

    def test_tool_call_response(self):
        """Non-streaming response with tool calls should include tool_calls in message."""
        from tests.conftest import (
            MockChatGPTClient,
            MockPoolEntry,
            MockAccountPool,
            sse_tool_call_response,
            build_test_app,
        )
        from app.dependencies import AppDependencies
        from app.services.metrics_collector import MetricsCollector

        mock_client = MockChatGPTClient(
            responses_data=sse_tool_call_response(
                call_id="call_001",
                name="get_weather",
                arguments='{"city":"Beijing"}',
            )
        )
        mock_entry = MockPoolEntry(chatgpt_client=mock_client)
        mock_pool = MockAccountPool(entry=mock_entry)
        mock_deps = AppDependencies(
            pool=mock_pool,  # type: ignore[arg-type]
            metrics_collector=MetricsCollector(),
        )

        app = build_test_app(mock_deps)
        from fastapi.testclient import TestClient
        tc = TestClient(app)

        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=True,
        ):
            response = tc.post(
                "/v1/chat/completions",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "What's the weather?"}],
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["choices"][0]["finish_reason"] == "tool_calls"
        assert len(data["choices"][0]["message"]["tool_calls"]) == 1
        assert data["choices"][0]["message"]["tool_calls"][0]["function"]["name"] == "get_weather"


# ═══════════════════════════════════════════════════════════════
# Streaming tests
# ═══════════════════════════════════════════════════════════════


class TestChatCompletionsStream:
    """Streaming chat completions endpoint tests."""

    def test_stream_text_completion(self, client):
        """Streaming text completion should yield SSE chunks."""
        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": True,
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        # Parse SSE lines
        lines = response.text.strip().split("\n\n")
        chunks = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                chunks.append(json.loads(line[6:]))

        assert len(chunks) >= 2  # At least init chunk + completion chunk
        # First chunk should have role
        assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"
        # Last chunk should have finish_reason
        assert chunks[-1]["choices"][0]["finish_reason"] is not None

    def test_stream_ends_with_done(self, client):
        """Streaming response should end with [DONE]."""
        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": True,
                },
            )

        assert response.text.strip().endswith("data: [DONE]")

    def test_stream_with_usage(self, client):
        """Streaming with stream_options.include_usage should include usage chunk."""
        with patch(
            "app.routes.chat_completions.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/chat/completions",
                json={
                    "model": TEST_MODEL,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "stream": True,
                    "stream_options": {"include_usage": True},
                },
            )

        lines = response.text.strip().split("\n\n")
        usage_chunks = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                chunk = json.loads(line[6:])
                if "usage" in chunk and chunk.get("usage"):
                    usage_chunks.append(chunk)

        assert len(usage_chunks) >= 1
        assert "prompt_tokens" in usage_chunks[0]["usage"]
