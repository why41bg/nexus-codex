from __future__ import annotations

"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server
    port: int = 3000
    host: str = "0.0.0.0"

    # Admin auth
    admin_username: str = "admin"
    admin_password: str = "admin"
    admin_session_ttl_ms: int = 24 * 60 * 60 * 1000  # 24 hours

    # Rate limiting
    rate_limit_max: int = 60
    rate_limit_window_ms: int = 60_000  # 1 minute

    # Account pool
    default_max_concurrency: int = 1
    acquire_timeout_ms: int = 30_000

    # Request
    request_timeout_ms: int = 5 * 60 * 1000  # 5 minutes

    # Thread pool
    thread_pool_enabled: bool = False
    thread_pool_max_idle: int = 2
    thread_pool_max_age_ms: int = 30 * 60 * 1000
    thread_pool_max_usage: int = 50

    # Health check
    health_local_interval_ms: int = 60_000
    health_remote_interval_ms: int = 15 * 60_000
    health_remote_timeout_ms: int = 15_000
    health_token_expiry_buffer_sec: int = 300
    health_fail_threshold: int = 2

    # Quota probe
    quota_cache_ttl_ms: int = 10 * 60 * 1000

    # IP Ban
    ban_threshold: int = 5  # number of 404 hits before auto-ban
    ban_window_seconds: int = 60  # sliding window for counting hits
    ban_duration_hours: int = 0  # 0 = permanent until manually removed

    # Logging
    log_level: str = "info"
    log_format: str = "pretty"  # "json" or "pretty"

    # Log store (structured event collection)
    log_store_enabled: bool = True
    log_store_retention_days: int = 30
    log_store_level: str = "info"  # min level to collect: debug/info/warn/error
    log_store_max_context_size: int = 8192

    # Extended events
    codex_chat_completions_extended_events: bool = False
    codex_stream_extended_events: bool = True

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
