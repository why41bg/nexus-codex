"""Integration tests for POST /v1/responses route."""

from __future__ import annotations

import json

from tests.integration.conftest import parse_sse_named_events, TEST_MODEL


class TestResponsesNonStream:
    """Non-streaming responses endpoint tests."""

    def test_simple_response(self, client):
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
        assert "id" in data
        assert data["id"].startswith("resp-nexus-")
        assert data["type"] == "response.completed"
        assert data["response"]["object"] == "response"
        assert data["response"]["model"] == TEST_MODEL
        assert data["response"]["status"] == "completed"

    def test_model_not_allowed(self, client):
        client.app.state.deps.config_store.is_model_allowed_for_key.return_value = False
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

        events = parse_sse_named_events(response.text)
        assert len(events) >= 1
        completed_events = [e for e in events if e["event"] == "response.completed"]
        assert len(completed_events) >= 1

    def test_stream_response_has_id(self, client):
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