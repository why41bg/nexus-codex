"""Anthropic Messages API Pydantic models.

Separated from the main models.py to keep each API protocol's models
independent and avoid bloating a single file as more protocols are added.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AnthropicMessage(BaseModel):
    """Anthropic 单条消息 — role + content（字符串或 content block 数组）."""

    role: str
    content: str | list[dict]


class AnthropicTool(BaseModel):
    """Anthropic 工具定义."""

    name: str
    description: str = ""
    input_schema: dict = Field(default_factory=dict)


class AnthropicThinkingConfig(BaseModel):
    """Anthropic thinking 配置."""

    type: str = "enabled"
    budget_tokens: int = 1024


class AnthropicMessagesRequest(BaseModel):
    """Anthropic POST /v1/messages 请求体.

    NOTE: max_tokens, temperature, top_p, top_k, and stop_sequences are
    accepted for protocol compatibility but silently dropped by the ChatGPT
    backend which does not support them.
    """

    model: str
    messages: list[AnthropicMessage]
    system: str | list[dict] | None = None
    max_tokens: int | None = None
    stream: bool = False
    temperature: float | None = None
    tools: list[AnthropicTool] | None = None
    tool_choice: str | dict | None = None
    thinking: AnthropicThinkingConfig | None = None
    stop_sequences: list[str] | None = None
    top_p: float | None = None
    top_k: int | None = None
    metadata: dict | None = None


class AnthropicContentBlock(BaseModel):
    """Anthropic 响应内容块 — text / tool_use / thinking."""

    type: str
    text: str | None = None
    id: str | None = None
    name: str | None = None
    input: dict | None = None
    thinking: str | None = None
    signature: str | None = None


class AnthropicUsage(BaseModel):
    """Anthropic token 用量."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


class AnthropicMessagesResponse(BaseModel):
    """Anthropic 非流式响应."""

    id: str
    type: str = "message"
    role: str = "assistant"
    model: str
    content: list[AnthropicContentBlock] = Field(default_factory=list)
    stop_reason: str | None = "end_turn"
    stop_sequence: str | None = None
    usage: AnthropicUsage = Field(default_factory=AnthropicUsage)
