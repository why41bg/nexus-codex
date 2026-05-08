"""Unified exception hierarchy for Nexus Codex.

All application-level errors should use these exception classes.
The global exception handler in main.py converts them to
OpenAI-compatible error JSON responses.
"""

from __future__ import annotations


class NexusError(Exception):
    """Base exception for all Nexus Codex application errors.

    Attributes:
        message: Human-readable error message.
        code: Machine-readable error code (OpenAI-compatible).
        status_code: HTTP status code.
    """

    def __init__(
        self,
        message: str,
        code: str = "internal_error",
        status_code: int = 500,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class RateLimitError(NexusError):
    """All account concurrency slots are in use."""

    def __init__(self, message: str = "All account concurrency slots are currently in use.") -> None:
        super().__init__(message, code="rate_limit_exceeded", status_code=429)


class ModelNotFoundError(NexusError):
    """The requested model is not available for this API key."""

    def __init__(self, model: str) -> None:
        super().__init__(
            f"The model '{model}' does not exist or is not available.",
            code="model_not_found",
            status_code=404,
        )


class AuthenticationError(NexusError):
    """API key or admin authentication failed."""

    def __init__(self, message: str = "Invalid authentication credentials.") -> None:
        super().__init__(message, code="authentication_error", status_code=401)


class AccountNotFoundError(NexusError):
    """Account not found in the pool."""

    def __init__(self, account_id: str) -> None:
        super().__init__(
            f"Account '{account_id}' not found.",
            code="not_found",
            status_code=404,
        )


class RetryExhaustedError(RuntimeError):
    """All retry attempts have been exhausted.

    This is NOT a NexusError — it is a marker subclass of RuntimeError
    used by with_retry / with_stream_retry to signal that all account
    failover attempts have been exhausted. Route handlers catch this
    specifically and convert it to a RateLimitError.
    """


class BackendError(NexusError):
    """Error from the ChatGPT backend (Cloudflare, token expiry, etc.)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="api_error", status_code=502)


class ValidationError(NexusError):
    """Request validation failed."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="invalid_request_error", status_code=400)
