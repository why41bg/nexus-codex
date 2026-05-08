"""Shared route helpers for Chat Completions and Responses API routes.

Extracts common functions that were duplicated across chat_completions.py
and responses.py to reduce code duplication and improve maintainability.
"""

from __future__ import annotations

import asyncio

from fastapi.responses import JSONResponse

from app.services.account_store import increment_usage_count
from app.services.config_store import increment_key_monthly_usage
from app.utils.logger import log


def error_response(message: str, code: str, status: int = 500) -> JSONResponse:
    """Build a standard OpenAI-compatible error JSONResponse."""
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "message": message,
                "type": "server_error",
                "code": code,
            }
        },
    )


async def increment_counters(account_id: str, api_key: str) -> None:
    """Increment usage counters for account and API key (fire-and-forget)."""
    try:
        await increment_usage_count(account_id)
    except Exception as e:
        log.error("Failed to update usage stats", extra={"error": str(e)})
    try:
        await increment_key_monthly_usage(api_key)
    except Exception as e:
        log.error("Failed to update key monthly usage", extra={"error": str(e)})


async def trigger_probe_safe(account_id: str) -> None:
    """Trigger a health probe for an account, swallowing any errors."""
    try:
        from app.services.health_check import trigger_probe
        await trigger_probe(account_id)
    except Exception:
        pass
