"""Tests for unified exception hierarchy."""

from app.exceptions import (
    NexusError,
    RateLimitError,
    ModelNotFoundError,
    AuthenticationError,
    AccountNotFoundError,
    BackendError,
    ValidationError,
)


class TestNexusError:
    def test_base_error_defaults(self):
        err = NexusError("something went wrong")
        assert err.message == "something went wrong"
        assert err.code == "internal_error"
        assert err.status_code == 500
        assert str(err) == "something went wrong"

    def test_base_error_custom(self):
        err = NexusError("custom", code="custom_code", status_code=418)
        assert err.code == "custom_code"
        assert err.status_code == 418


class TestRateLimitError:
    def test_default_message(self):
        err = RateLimitError()
        assert "concurrency" in err.message.lower()
        assert err.code == "rate_limit_exceeded"
        assert err.status_code == 429

    def test_custom_message(self):
        err = RateLimitError("too many requests")
        assert err.message == "too many requests"


class TestModelNotFoundError:
    def test_formats_model_name(self):
        err = ModelNotFoundError("gpt-5")
        assert "gpt-5" in err.message
        assert err.code == "model_not_found"
        assert err.status_code == 404


class TestAuthenticationError:
    def test_defaults(self):
        err = AuthenticationError()
        assert err.code == "authentication_error"
        assert err.status_code == 401


class TestAccountNotFoundError:
    def test_formats_account_id(self):
        err = AccountNotFoundError("acc-123")
        assert "acc-123" in err.message
        assert err.code == "not_found"
        assert err.status_code == 404


class TestBackendError:
    def test_defaults(self):
        err = BackendError("backend timeout")
        assert err.code == "api_error"
        assert err.status_code == 502


class TestValidationError:
    def test_defaults(self):
        err = ValidationError("field required")
        assert err.code == "invalid_request_error"
        assert err.status_code == 400
