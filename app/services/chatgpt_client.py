"""ChatGPT backend HTTP client - direct API calls to chatgpt.com/backend-api/codex.

Encapsulates ChatGPT Plus backend HTTP requests with automatic auth header injection,
Cloudflare challenge handling, and SSE streaming support.
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


# ─── ChatGPTClient ──────────────────────────────────────────


class ChatGPTClient:
    """ChatGPT backend API client using Plus account quota.

    Uses OAuth token authentication (not API key) to call
    chatgpt.com/backend-api/codex/* endpoints, billing against the
    Plus account's quota.
    """

    def __init__(self, token_manager: TokenManager):
        self._token_manager = token_manager
        self._base_url = CODEX_BASE_URL

    # ── Public API ──────────────────────────────────────

    async def chat(
        self,
        model: str,
        messages: list[dict],
        *,
        stream: bool = True,
        temperature: float | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Initiate a chat request via the Responses API.

        Yields raw SSE data strings (JSON payloads) from the stream.
        For non-streaming, yields a single JSON string.
        """
        input_items = self._messages_to_input_items(messages)
        if stream:
            async for chunk in self._responses_stream(
                model=model,
                input_items=input_items,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
            ):
                yield chunk
        else:
            result = await self._responses_non_stream(
                model=model,
                input_items=input_items,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
            )
            yield json.dumps(result)

    async def get_models(self) -> list[dict]:
        """Get available models from the ChatGPT backend."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "application/json"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
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

        async with httpx.AsyncClient() as client:
            resp = await client.get(
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

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self._base_url}/usage",
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    # ── Responses API pass-through ─────────────────────

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
        reasoning_effort: str | None = None,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        """Pass-through Responses API call to ChatGPT backend.

        Directly forwards the Responses API request fields to the ChatGPT
        backend without reinterpretation. Yields raw SSE data strings for
        streaming, or a single JSON string for non-streaming.
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
        }
        if instructions:
            payload["instructions"] = instructions
        if tools:
            payload["tools"] = tools
        if tool_choice:
            payload["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = parallel_tool_calls
        if previous_response_id:
            payload["previous_response_id"] = previous_response_id
        if temperature is not None:
            payload["temperature"] = temperature
        if max_output_tokens is not None:
            payload["max_output_tokens"] = max_output_tokens
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}

        log.debug("ChatGPT responses request", extra={"model": model, "payload": json.dumps(payload, ensure_ascii=False)[:500]})

        if stream:
            async for chunk in self._stream_sse(headers, payload):
                yield chunk
        else:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self._base_url}/responses",
                    headers=headers,
                    json=payload,
                    timeout=DEFAULT_TIMEOUT,
                )
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                yield json.dumps(resp.json())

    async def _stream_sse(
        self,
        headers: dict[str, str],
        payload: dict,
    ) -> AsyncGenerator[str, None]:
        """Stream SSE events from ChatGPT backend."""
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/responses",
                headers=headers,
                json=payload,
                timeout=DEFAULT_TIMEOUT,
            ) as resp:
                log.debug("ChatGPT response status", extra={"status": resp.status_code})

                if resp.status_code == 403:
                    body = await resp.aread()
                    if b"_cf_chl_opt" in body or b"challenge-platform" in body:
                        raise CloudflareChallengeError("Blocked by Cloudflare")
                    raise RuntimeError(f"HTTP {resp.status_code}: {body.decode(errors='replace')[:200]}")

                if resp.status_code != 200:
                    body = await resp.aread()
                    raise RuntimeError(f"HTTP {resp.status_code}: {body.decode(errors='replace')[:200]}")

                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            log.debug("ChatGPT SSE: [DONE]")
                            break
                        log.debug("ChatGPT SSE data", extra={"raw": data[:300]})
                        yield data

    # ── Internal: Chat Completions (legacy) ─────────────

    async def _responses_stream(
        self,
        model: str,
        input_items: list[dict],
        *,
        instructions: str = "",
        tools: list[dict] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming dialogue via Responses API (SSE named events)."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "text/event-stream"

        payload = {
            "model": model,
            "input": input_items,
            "instructions": instructions,
            "tools": tools or [],
            "tool_choice": "auto",
            "parallel_tool_calls": True,
            "stream": True,
            "store": False,
            "include": [],
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_output_tokens"] = max_tokens
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}

        async for chunk in self._stream_sse(headers, payload):
            yield chunk

    async def _responses_non_stream(
        self,
        model: str,
        input_items: list[dict],
        *,
        instructions: str = "",
        tools: list[dict] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> dict:
        """Non-streaming dialogue via Responses API."""
        token = await self._token_manager.get_access_token()
        if not token:
            raise TokenExpiredError("No valid access token")

        headers = self._build_headers(token)
        headers["Accept"] = "application/json"

        payload = {
            "model": model,
            "input": input_items,
            "instructions": instructions,
            "tools": tools or [],
            "tool_choice": "auto",
            "parallel_tool_calls": True,
            "stream": False,
            "store": False,
            "include": [],
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_output_tokens"] = max_tokens
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base_url}/responses",
                headers=headers,
                json=payload,
                timeout=DEFAULT_TIMEOUT,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            return resp.json()

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

    @staticmethod
    def _messages_to_input_items(messages: list[dict]) -> list[dict]:
        """Convert chat messages to Responses API input_items format."""
        items = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            part_type = "output_text" if role == "assistant" else "input_text"
            items.append({
                "type": "message",
                "role": role,
                "content": [{"type": part_type, "text": content}],
            })
        return items
