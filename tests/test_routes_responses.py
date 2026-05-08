"""Integration tests for POST /v1/responses route."""

from __future__ import annotations

import json
from unittest.mock import patch

from tests.conftest import TEST_MODEL


class TestResponsesNonStream:
    """Non-streaming responses endpoint tests."""

    def test_simple_response(self, client):
        """Basic non-streaming response should return Responses API event data."""
        with patch(
            "app.routes.responses.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/responses",
                json={
                    "model": TEST_MODEL,
                    "input": "Hello",
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        # Non-streaming responses returns raw event data with id injected
        assert "id" in data
        assert data["id"].startswith("resp-nexus-")
        assert data["type"] == "response.completed"
        assert data["response"]["object"] == "response"
        assert data["response"]["model"] == TEST_MODEL
        assert data["response"]["status"] == "completed"

    def test_model_not_allowed(self, client):
        """Model not in allowed list should return 404."""
        with patch(
            "app.routes.responses.is_model_allowed_for_key",
            return_value=False,
        ):
            response = client.post(
                "/v1/responses",
                json={
                    "model": "gpt-99",
                    "input": "Hello",
                    "stream": False,
                },
            )

        assert response.status_code == 404
        data = response.json()
        assert "gpt-99" in data["error"]["message"]

    def test_response_with_instructions(self, client):
        """Response with instructions should work."""
        with patch(
            "app.routes.responses.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/responses",
                json={
                    "model": TEST_MODEL,
                    "input": "Hello",
                    "instructions": "You are a helpful assistant.",
                    "stream": False,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["type"] == "response.completed"
        assert data["response"]["status"] == "completed"


class TestResponsesStream:
    """Streaming responses endpoint tests."""

    def test_stream_response(self, client):
        """Streaming response should yield SSE named events."""
        with patch(
            "app.routes.responses.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/responses",
                json={
                    "model": TEST_MODEL,
                    "input": "Hello",
                    "stream": True,
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        # Parse SSE named events
        lines = response.text.strip().split("\n\n")
        events = []
        for block in lines:
            if not block.strip():
                continue
            parts = block.split("\n")
            event_name = None
            event_data = None
            for part in parts:
                if part.startswith("event: "):
                    event_name = part[7:]
                elif part.startswith("data: "):
                    event_data = json.loads(part[6:])
            if event_name and event_data:
                events.append({"event": event_name, "data": event_data})

        assert len(events) >= 1
        # Should have a response.completed event
        completed_events = [e for e in events if e["event"] == "response.completed"]
        assert len(completed_events) >= 1

    def test_stream_response_has_id(self, client):
        """Streaming response events should have the response ID injected."""
        with patch(
            "app.routes.responses.is_model_allowed_for_key",
            return_value=True,
        ):
            response = client.post(
                "/v1/responses",
                json={
                    "model": TEST_MODEL,
                    "input": "Hello",
                    "stream": True,
                },
            )

        lines = response.text.strip().split("\n\n")
        for block in lines:
            if "response.completed" in block:
                for part in block.split("\n"):
                    if part.startswith("data: "):
                        data = json.loads(part[6:])
                        resp_obj = data.get("response", {})
                        assert resp_obj.get("id", "").startswith("resp-nexus-")
                        break
