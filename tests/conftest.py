"""Shared pytest fixtures for Nexus Codex unit tests.

Integration test fixtures live in tests/integration/conftest.py.
"""

from __future__ import annotations

import pytest

TEST_API_KEY = "sk-test-key-12345678"
TEST_ACCOUNT_ID = "acc-test-001"
TEST_MODEL = "gpt-5.5"


@pytest.fixture(scope="session")
def event_loop():
    """Create a session-scoped event loop for async tests."""
    import asyncio

    loop = asyncio.new_event_loop()
    yield loop
    loop.close()