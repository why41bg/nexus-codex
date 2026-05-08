"""Tests for retry helper module."""

import pytest

from app.utils.retry import is_retryable, MAX_RETRIES
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


class TestMaxRetries:
    def test_max_retries_is_3(self):
        assert MAX_RETRIES == 3
