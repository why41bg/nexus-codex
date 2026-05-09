"""Fixtures and mocks for integration tests (route handlers)."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import api_key_auth_dependency, admin_auth_dependency
from app.middleware.rate_limit import rate_limit_dependency
from app.services.account_pool import PoolEntry
from app.services.metrics_collector import MetricsCollector

TEST_API_KEY = "sk-test-key-12345678"
TEST_ACCOUNT_ID = "acc-test-001"
TEST_MODEL = "gpt-5.5"


# ─── Mock PoolEntry ─────────────────────────────────────────


@dataclass
class MockPoolEntry:
    """Minimal mock of PoolEntry for testing."""

    account_id: str = TEST_ACCOUNT_ID
    codex_home: str = "/tmp/mock-codex-home"
    chatgpt_client: Any = None
    active_count: int = 0
    max_concurrency: int = 1
    healthy: bool = True


# ─── Mock ChatGPTClient ─────────────────────────────────────


class MockChatGPTClient:
    """Mock ChatGPTClient that yields controlled SSE data."""

    def __init__(self, responses_data: list[dict] | None = None):
        self._data = responses_data or []
        self._call_count = 0

    async def responses(self, **kwargs) -> AsyncGenerator[str, None]:
        self._call_count += 1
        for item in self._data:
            yield json.dumps(item)

    async def get_account_info(self) -> dict:
        return {"plan_type": "plus", "account_id": TEST_ACCOUNT_ID}


# ─── Mock AccountPool ───────────────────────────────────────


class MockAccountPool:
    """Mock AccountPool for testing route handlers."""

    def __init__(self, entry: MockPoolEntry | None = None):
        self._entry = entry or MockPoolEntry()
        self._status: list[dict] = [
            {
                "account_id": self._entry.account_id,
                "active_count": 0,
                "max_concurrency": 1,
                "healthy": True,
                "token_info": {},
            }
        ]

    async def acquire_async(self, timeout_ms: int | None = None) -> PoolEntry | None:
        return self._entry  # type: ignore[return-value]

    def acquire(self) -> PoolEntry | None:
        return self._entry  # type: ignore[return-value]

    def release(self, account_id: str) -> None:
        pass

    def get_status(self) -> list[dict]:
        return self._status

    def entries(self) -> list:
        return [self._entry]

    def add_entry(self, account) -> None:
        pass

    def update_entry(self, account_id: str, **kwargs) -> None:
        pass

    def remove_entry(self, account_id: str) -> None:
        pass

    async def close(self) -> None:
        pass


# ─── SSE response builders ──────────────────────────────────


def sse_text_response(text: str, model: str = TEST_MODEL) -> list[dict]:
    """Build mock SSE response data for a simple text completion."""
    return [
        {
            "type": "response.completed",
            "output": [
                {
                    "id": "msg-test-001",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": text}],
                }
            ],
            "response": {
                "id": "resp-test-001",
                "object": "response",
                "created_at": 1700000000,
                "model": model,
                "status": "completed",
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            },
        }
    ]


def sse_tool_call_response(
    call_id: str = "call_001",
    name: str = "get_weather",
    arguments: str = '{"city":"Beijing"}',
    model: str = TEST_MODEL,
) -> list[dict]:
    """Build mock SSE response data for a tool call."""
    return [
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": "item_001",
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": "",
            },
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": call_id,
            "output_index": 0,
            "delta": arguments,
        },
        {
            "type": "response.function_call_arguments.done",
            "item_id": call_id,
            "output_index": 0,
            "arguments": arguments,
        },
        {
            "type": "response.completed",
            "output": [
                {
                    "id": "item_001",
                    "type": "function_call",
                    "call_id": call_id,
                    "name": name,
                    "arguments": arguments,
                }
            ],
            "response": {
                "id": "resp-test-001",
                "object": "response",
                "created_at": 1700000000,
                "model": model,
                "status": "completed",
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            },
        },
    ]


# ─── SSE parsing helpers ────────────────────────────────────


def parse_sse_data_lines(text: str) -> list[dict]:
    """Parse SSE text into a list of JSON data dicts (data: lines only, skip [DONE])."""
    events = []
    for block in text.strip().split("\n\n"):
        if block.startswith("data: ") and block != "data: [DONE]":
            events.append(json.loads(block[6:]))
    return events


def parse_sse_named_events(text: str) -> list[dict]:
    """Parse SSE text with named events into list of {event, data} dicts."""
    events = []
    for block in text.strip().split("\n\n"):
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
    return events


# ─── App builder ────────────────────────────────────────────


def build_test_app(mock_deps: AppDependencies) -> FastAPI:
    """Create a FastAPI test app with mocked dependencies."""
    app = FastAPI()

    from app.routes.chat_completions import router as chat_completions_router
    from app.routes.responses import router as responses_router
    from app.routes.messages import router as messages_router
    from app.routes.models import router as models_router
    from app.routes.admin import router as admin_router

    app.include_router(chat_completions_router, prefix="/v1")
    app.include_router(responses_router, prefix="/v1")
    app.include_router(messages_router, prefix="/v1")
    app.include_router(models_router, prefix="/v1")
    app.include_router(admin_router, prefix="/api/admin")

    from app.exceptions import NexusError
    from app.adapters.anthropic_adapter import AnthropicAdapter
    from fastapi import Request
    from fastapi.responses import JSONResponse

    def _is_anthropic_request(request: Request) -> bool:
        protocol = getattr(request.state, "protocol", None)
        if protocol == "anthropic":
            return True
        return request.url.path.rstrip("/") == "/v1/messages"

    @app.exception_handler(NexusError)
    async def nexus_exception_handler(request: Request, exc: NexusError):
        if _is_anthropic_request(request):
            return JSONResponse(
                status_code=exc.status_code,
                content=AnthropicAdapter.format_error(exc.message),
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "message": exc.message,
                    "type": "server_error",
                    "code": exc.code,
                }
            },
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        if _is_anthropic_request(request):
            return JSONResponse(
                status_code=500,
                content=AnthropicAdapter.format_error(
                    "An internal server error occurred. Please try again later.",
                    "server_error",
                ),
            )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "message": "An internal server error occurred. Please try again later.",
                    "type": "server_error",
                    "code": "internal_error",
                }
            },
        )

    async def override_get_deps():
        return mock_deps

    async def override_api_key_auth():
        return TEST_API_KEY

    async def override_rate_limit(request: Request, api_key: str):
        return None

    app.dependency_overrides[get_deps] = override_get_deps
    app.dependency_overrides[api_key_auth_dependency] = override_api_key_auth
    app.dependency_overrides[rate_limit_dependency] = override_rate_limit

    return app


# ─── Fixtures ───────────────────────────────────────────────


@pytest.fixture
def mock_chatgpt_client():
    """Create a MockChatGPTClient with default text response."""
    return MockChatGPTClient(
        responses_data=[
            {
                "type": "response.completed",
                "output": [
                    {
                        "id": "msg-test-001",
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Hello! How can I help you?"}
                        ],
                    }
                ],
                "response": {
                    "id": "resp-test-001",
                    "object": "response",
                    "created_at": 1700000000,
                    "model": TEST_MODEL,
                    "status": "completed",
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 20,
                        "total_tokens": 30,
                    },
                },
            }
        ]
    )


@pytest.fixture
def mock_pool_entry(mock_chatgpt_client):
    """Create a MockPoolEntry with a mock ChatGPT client."""
    return MockPoolEntry(
        account_id=TEST_ACCOUNT_ID,
        chatgpt_client=mock_chatgpt_client,
    )


@pytest.fixture
def mock_pool(mock_pool_entry):
    """Create a MockAccountPool."""
    return MockAccountPool(entry=mock_pool_entry)


@pytest.fixture
def metrics_collector():
    """Create a MetricsCollector with a mock MetricsStore for testing."""
    mock_store = MagicMock()
    return MetricsCollector(mock_store)


@pytest.fixture
def mock_deps(mock_pool, metrics_collector):
    """Create mock AppDependencies."""
    return AppDependencies(
        pool=mock_pool,  # type: ignore[arg-type]
        metrics_collector=metrics_collector,
        metrics_store=MagicMock(),
    )


@pytest.fixture
def test_app(mock_deps):
    """Create a FastAPI test app with mocked dependencies."""
    return build_test_app(mock_deps)


@pytest.fixture
def client(test_app):
    """Create a TestClient for the test app."""
    return TestClient(test_app)