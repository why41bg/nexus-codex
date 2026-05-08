"""Tests for retry helper module."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils.retry import is_retryable, MAX_RETRIES, with_retry, with_stream_retry
from app.services.chatgpt_client import CloudflareChallengeError, TokenExpiredError


class TestIsRetryable:
    def test_cloudflare_is_retryable(self):
        assert is_retryable(CloudflareChallengeError("cf challenge"))

    def test_token_expired_is_retryable(self):
        assert is_retryable(TokenExpiredError("token expired"))

    def test_connection_error_is_retryable(self):
        assert is_retryable(ConnectionError("connection refused"))

    def test_timeout_is_retryable(self):
        assert is_retryable(TimeoutError("timeout"))

    def test_os_error_is_retryable(self):
        assert is_retryable(OSError("network error"))

    def test_value_error_is_not_retryable(self):
        assert not is_retryable(ValueError("bad value"))

    def test_key_error_is_not_retryable(self):
        assert not is_retryable(KeyError("missing key"))

    def test_runtime_error_is_not_retryable(self):
        assert not is_retryable(RuntimeError("generic error"))

    def test_httpx_error_names_are_retryable(self):
        """httpx error class names should be recognized as retryable."""
        # Simulate httpx errors by name matching
        class ConnectError(Exception):
            pass

        class ReadTimeout(Exception):
            pass

        assert is_retryable(ConnectError("connect failed"))
        assert is_retryable(ReadTimeout("read timeout"))


class TestMaxRetries:
    def test_max_retries_is_3(self):
        assert MAX_RETRIES == 3


# ═══════════════════════════════════════════════════════════════
# with_retry tests
# ═══════════════════════════════════════════════════════════════


class TestWithRetry:
    """Tests for with_retry() — non-streaming retry with account failover."""

    @pytest.fixture
    def mock_deps(self):
        """Create mock AppDependencies with a controllable pool."""
        from app.dependencies import AppDependencies
        from app.services.metrics_collector import MetricsCollector

        pool = MagicMock()
        pool.acquire_async = AsyncMock()
        pool.release = MagicMock()
        metrics = MetricsCollector()
        return AppDependencies(pool=pool, metrics_collector=metrics)

    @pytest.mark.asyncio
    async def test_successful_first_attempt(self, mock_deps):
        """Operation succeeds on first attempt — no retry needed."""
        from app.services.account_pool import PoolEntry

        entry = MagicMock(spec=PoolEntry)
        entry.account_id = "acc-001"
        mock_deps.pool.acquire_async.return_value = entry

        async def operation(e: PoolEntry) -> str:
            return "success"

        result = await with_retry(mock_deps, operation)
        assert result == "success"
        mock_deps.pool.acquire_async.assert_called_once()
        mock_deps.pool.release.assert_called_once_with("acc-001")

    @pytest.mark.asyncio
    async def test_retry_on_cloudflare_error(self, mock_deps):
        """CloudflareChallengeError should trigger retry with different account."""
        from app.services.account_pool import PoolEntry

        entry1 = MagicMock(spec=PoolEntry)
        entry1.account_id = "acc-001"
        entry2 = MagicMock(spec=PoolEntry)
        entry2.account_id = "acc-002"
        mock_deps.pool.acquire_async.side_effect = [entry1, entry2]

        call_count = 0

        async def operation(e: PoolEntry) -> str:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise CloudflareChallengeError("cf challenge")
            return "success"

        with patch("app.utils.retry.asyncio.sleep", new_callable=AsyncMock):
            result = await with_retry(mock_deps, operation)

        assert result == "success"
        assert call_count == 2
        assert mock_deps.pool.acquire_async.call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_token_expired(self, mock_deps):
        """TokenExpiredError should trigger retry."""
        from app.services.account_pool import PoolEntry

        entry1 = MagicMock(spec=PoolEntry)
        entry1.account_id = "acc-001"
        entry2 = MagicMock(spec=PoolEntry)
        entry2.account_id = "acc-002"
        mock_deps.pool.acquire_async.side_effect = [entry1, entry2]

        call_count = 0

        async def operation(e: PoolEntry) -> str:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise TokenExpiredError("token expired")
            return "success"

        with patch("app.utils.retry.asyncio.sleep", new_callable=AsyncMock):
            result = await with_retry(mock_deps, operation)

        assert result == "success"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_non_retryable_error_raises_immediately(self, mock_deps):
        """Non-retryable error should raise immediately without retry."""
        from app.services.account_pool import PoolEntry

        entry = MagicMock(spec=PoolEntry)
        entry.account_id = "acc-001"
        mock_deps.pool.acquire_async.return_value = entry

        async def operation(e: PoolEntry) -> str:
            raise ValueError("bad input")

        with pytest.raises(ValueError, match="bad input"):
            await with_retry(mock_deps, operation)

        # Should only try once
        mock_deps.pool.acquire_async.assert_called_once()

    @pytest.mark.asyncio
    async def test_exhausted_retries_raises_last_error(self, mock_deps):
        """When all retries are exhausted, the last error should be re-raised."""
        from app.services.account_pool import PoolEntry

        entries = [MagicMock(spec=PoolEntry) for _ in range(MAX_RETRIES + 1)]
        for i, e in enumerate(entries):
            e.account_id = f"acc-{i:03d}"
        mock_deps.pool.acquire_async.side_effect = entries

        async def operation(e: PoolEntry) -> str:
            raise CloudflareChallengeError("persistent cf challenge")

        with patch("app.utils.retry.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(CloudflareChallengeError, match="persistent cf challenge"):
                await with_retry(mock_deps, operation)

        assert mock_deps.pool.acquire_async.call_count == MAX_RETRIES + 1

    @pytest.mark.asyncio
    async def test_no_slot_available_raises(self, mock_deps):
        """When no account slot is available, RuntimeError should be raised."""
        mock_deps.pool.acquire_async.return_value = None

        async def operation(e: PoolEntry) -> str:
            return "should not reach"

        with pytest.raises(RuntimeError, match="concurrency slots"):
            await with_retry(mock_deps, operation)


# ═══════════════════════════════════════════════════════════════
# with_stream_retry tests
# ═══════════════════════════════════════════════════════════════


class TestWithStreamRetry:
    """Tests for with_stream_retry() — streaming retry with account failover."""

    @pytest.fixture
    def mock_deps(self):
        """Create mock AppDependencies."""
        from app.dependencies import AppDependencies
        from app.services.metrics_collector import MetricsCollector

        pool = MagicMock()
        pool.acquire_async = AsyncMock()
        pool.release = MagicMock()
        metrics = MetricsCollector()
        return AppDependencies(pool=pool, metrics_collector=metrics)

    @pytest.mark.asyncio
    async def test_successful_stream(self, mock_deps):
        """Stream succeeds on first attempt."""
        from app.services.account_pool import PoolEntry

        entry = MagicMock(spec=PoolEntry)
        entry.account_id = "acc-001"
        mock_deps.pool.acquire_async.return_value = entry

        async def stream_fn(e: PoolEntry):
            yield "chunk1"
            yield "chunk2"

        def no_slot_error():
            return "no-slot-error"

        def format_error(msg):
            return f"error:{msg}"

        chunks = []
        async for chunk in with_stream_retry(
            mock_deps,
            stream_fn,
            model="gpt-5.5",
            api_key="sk-test",
            req_start=1000.0,
            format_no_slot_error=no_slot_error,
            format_error=format_error,
        ):
            chunks.append(chunk)

        assert chunks == ["chunk1", "chunk2"]
        mock_deps.pool.release.assert_called_once_with("acc-001")

    @pytest.mark.asyncio
    async def test_stream_retry_on_error(self, mock_deps):
        """Stream retries on retryable error with different account."""
        from app.services.account_pool import PoolEntry

        entry1 = MagicMock(spec=PoolEntry)
        entry1.account_id = "acc-001"
        entry2 = MagicMock(spec=PoolEntry)
        entry2.account_id = "acc-002"
        mock_deps.pool.acquire_async.side_effect = [entry1, entry2]

        call_count = 0

        async def stream_fn(e: PoolEntry):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise CloudflareChallengeError("cf challenge")
            yield "success-chunk"

        def no_slot_error():
            return "no-slot-error"

        def format_error(msg):
            return f"error:{msg}"

        with patch("app.utils.retry.asyncio.sleep", new_callable=AsyncMock):
            chunks = []
            async for chunk in with_stream_retry(
                mock_deps,
                stream_fn,
                model="gpt-5.5",
                api_key="sk-test",
                req_start=1000.0,
                format_no_slot_error=no_slot_error,
                format_error=format_error,
            ):
                chunks.append(chunk)

        assert chunks == ["success-chunk"]
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_stream_no_slot_available(self, mock_deps):
        """When no slot available, error event should be yielded."""
        mock_deps.pool.acquire_async.return_value = None

        async def stream_fn(e):
            yield "should not reach"
            if False:
                yield None  # pragma: no cover

        def no_slot_error():
            return "no-slot-error"

        def format_error(msg):
            return f"error:{msg}"

        chunks = []
        async for chunk in with_stream_retry(
            mock_deps,
            stream_fn,
            model="gpt-5.5",
            api_key="sk-test",
            req_start=1000.0,
            format_no_slot_error=no_slot_error,
            format_error=format_error,
        ):
            chunks.append(chunk)

        assert chunks == ["no-slot-error"]

    @pytest.mark.asyncio
    async def test_stream_non_retryable_error(self, mock_deps):
        """Non-retryable error during stream should yield error and stop."""
        from app.services.account_pool import PoolEntry

        entry = MagicMock(spec=PoolEntry)
        entry.account_id = "acc-001"
        mock_deps.pool.acquire_async.return_value = entry

        async def stream_fn(e: PoolEntry):
            raise ValueError("bad input")
            yield "never"  # pragma: no cover

        def no_slot_error():
            return "no-slot-error"

        def format_error(msg):
            return f"error:{msg}"

        chunks = []
        async for chunk in with_stream_retry(
            mock_deps,
            stream_fn,
            model="gpt-5.5",
            api_key="sk-test",
            req_start=1000.0,
            format_no_slot_error=no_slot_error,
            format_error=format_error,
        ):
            chunks.append(chunk)

        assert len(chunks) == 1
        assert chunks[0].startswith("error:")

    @pytest.mark.asyncio
    async def test_stream_with_append_done(self, mock_deps):
        """append_done=True should append [DONE] after error events."""
        mock_deps.pool.acquire_async.return_value = None

        async def stream_fn(e):
            yield "never"
            if False:
                yield None  # pragma: no cover

        def no_slot_error():
            return "no-slot-error"

        def format_error(msg):
            return f"error:{msg}"

        chunks = []
        async for chunk in with_stream_retry(
            mock_deps,
            stream_fn,
            model="gpt-5.5",
            api_key="sk-test",
            req_start=1000.0,
            format_no_slot_error=no_slot_error,
            format_error=format_error,
            append_done=True,
        ):
            chunks.append(chunk)

        assert chunks == ["no-slot-error", "data: [DONE]\n\n"]
