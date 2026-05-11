"""ChatGPT backend HTTP client - direct API calls to chatgpt.com/backend-api/codex.

Encapsulates ChatGPT Plus backend HTTP requests with automatic auth header injection,
Cloudflare challenge handling, and SSE streaming support.

This module is a pure HTTP communication layer. All format conversion between
Chat Completions and Responses API lives in chatgpt_adapter.py.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx

from app.services.token_manager import TokenManager
from app.utils.logger import log

# ─── Constants ──────────────────────────────────────────────

CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
USER_AGENT = "nexus-codex/1.0"
DEFAULT_TIMEOUT = 300  # 5 minutes for long completions


# ─── Errors ─────────────────────────────────────────────────


class CloudflareChallengeError(Exception):
    """Raised when Cloudflare blocks the request with a challenge page."""


class TokenExpiredError(Exception):
    """Raised when the access_token is expired and cannot be refreshed."""


class QuotaExhaustedError(Exception):
    """Raised when the account quota is exhausted (HTTP 429)."""


# ─── ChatGPTClient ──────────────────────────────────────────


class ChatGPTClient:
    """ChatGPT backend API client using Plus account quota.

    Uses OAuth token authentication (not API key) to call
    chatgpt.com/backend-api/codex/* endpoints, billing against the
    Plus account's quota.

    A single long-lived ``httpx.AsyncClient`` is reused for all requests
    so that TCP connections / HTTP/2 streams are properly pooled.
    Call :meth:`aclose` during shutdown to release the underlying
    connection pool.
    """

    def __init__(self, token_manager: TokenManager):
        self._token_manager = token_manager
        self._base_url = CODEX_BASE_URL
        self._http: httpx.AsyncClient = httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT,
            http2=False,  # chatgpt.com may not support h2; keep HTTP/1.1
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    # ── Public API ──────────────────────────────────────

    async def get_models(self) -> list[dict]:
        """Get available models from the ChatGPT backend."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "application/json"

        resp = await self._http.get(
            "https://chatgpt.com/backend-api/models",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("models", data) if isinstance(data, dict) else data

    async def get_account_info(self) -> dict:
        """Get account information from /backend-api/me."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "application/json"

        resp = await self._http.get(
            "https://chatgpt.com/backend-api/me",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    async def get_usage(self) -> dict:
        """Get Codex usage/quota from /backend-api/codex/usage."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "application/json"

        resp = await self._http.get(
            f"{self._base_url}/usage",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Responses API ───────────────────────────────────

    async def responses(
        self,
        model: str,
        input_items: list[dict] | str,
        *,
        instructions: str | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | None = None,
        parallel_tool_calls: bool | None = None,
        previous_response_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
        top_p: float | None = None,
        stop: str | list[str] | None = None,
        seed: int | None = None,
        response_format: dict | None = None,
        reasoning_effort: str | None = None,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        """Call the ChatGPT backend Responses API.

        Accepts Responses API parameters directly (no format conversion).
        Yields raw SSE data strings for streaming, or a single JSON string
        for non-streaming.
        """
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "text/event-stream" if stream else "application/json"

        payload: dict = {
            "model": model,
            "input": input_items,
            "stream": stream,
            "store": False,
            "include": [],
            "instructions": instructions or "",
        }
        if tools:
            payload["tools"] = tools
        if tool_choice:
            payload["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = parallel_tool_calls
        if previous_response_id:
            payload["previous_response_id"] = previous_response_id
        if response_format:
            payload["text"] = {"format": response_format}
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}

        # NOTE: The following parameters are NOT supported by the ChatGPT backend
        # (chatgpt.com/backend-api/codex/responses), confirmed by codex-rs source:
        #   codex-rs/codex-api/src/common.rs: ResponsesApiRequest struct
        # and openclaw:
        #   src/agents/openai-transport-stream.ts: OPENAI_CODEX_RESPONSES_UNSUPPORTED_PARAMS
        #
        # - max_output_tokens / max_tokens: backend does not accept token limits
        # - temperature: backend ignores this parameter
        # - top_p: backend does not accept
        # - stop: backend does not accept
        # - seed: backend does not accept
        #
        # These are accepted in the API model but silently dropped here.

        account_id = self._token_manager.get_account_id() or "unknown"
        log.debug("ChatGPT responses request", extra={
            "model": model, "account_id": account_id,
            "payload": json.dumps(payload, ensure_ascii=False)[:500],
        })

        if stream:
            async for chunk in self._stream_sse(headers, payload):
                yield chunk
        else:
            resp = await self._http.post(
                f"{self._base_url}/responses",
                headers=headers,
                json=payload,
                timeout=DEFAULT_TIMEOUT,
            )
            if resp.status_code != 200:
                if resp.status_code == 429:
                    raise QuotaExhaustedError(f"HTTP 429: {resp.text[:200]}")
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            yield json.dumps(resp.json())

    # ── Internal: SSE streaming ─────────────────────────

    async def _stream_sse(
        self,
        headers: dict[str, str],
        payload: dict,
    ) -> AsyncGenerator[str, None]:
        """Stream SSE events from ChatGPT backend."""
        async with self._http.stream(
            "POST",
            f"{self._base_url}/responses",
            headers=headers,
            json=payload,
            timeout=DEFAULT_TIMEOUT,
        ) as resp:
            account_id = self._token_manager.get_account_id() or "unknown"
            log.debug("ChatGPT response status", extra={
                "status": resp.status_code, "account_id": account_id,
            })

            if resp.status_code == 403:
                body = await resp.aread()
                if b"_cf_chl_opt" in body or b"challenge-platform" in body:
                    log.warning("Cloudflare challenge detected", extra={"account_id": account_id})
                    raise CloudflareChallengeError("Blocked by Cloudflare")
                log.error("ChatGPT HTTP 403", extra={"account_id": account_id, "body": body.decode(errors='replace')[:200]})
                raise RuntimeError(f"HTTP {resp.status_code}: {body.decode(errors='replace')[:200]}")

            if resp.status_code == 429:
                body = await resp.aread()
                log.warning("ChatGPT quota exhausted (HTTP 429)", extra={"account_id": account_id})
                raise QuotaExhaustedError(f"HTTP 429: {body.decode(errors='replace')[:200]}")

            if resp.status_code != 200:
                body = await resp.aread()
                log.error("ChatGPT upstream error", extra={
                    "account_id": account_id, "status": resp.status_code,
                    "body": body.decode(errors='replace')[:200],
                })
                raise RuntimeError(f"HTTP {resp.status_code}: {body.decode(errors='replace')[:200]}")

            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        log.debug("ChatGPT SSE: [DONE]")
                        break
                    log.debug("ChatGPT SSE data", extra={"raw": data[:300]})
                    yield data

    # ── Lifecycle ──────────────────────────────────────

    async def aclose(self) -> None:
        """Close the underlying HTTP client and release connections."""
        await self._http.aclose()

    # ── Internal: Helpers ───────────────────────────────

    def _build_headers(self, token: str) -> dict[str, str]:
        """Build request headers with auth and common fields."""
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
        account_id = self._token_manager.get_account_id()
        if account_id:
            headers["ChatGPT-Account-Id"] = account_id
        return headers
