"""Pydantic models for the application."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(name: str) -> str:
    """Convert snake_case to camelCase for alias generation."""
    parts = name.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


class CamelModel(BaseModel):
    """Base model that accepts both camelCase and snake_case input."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


# ─── Account & Pool ────────────────────────────────────────


class Account(BaseModel):
    id: str
    codex_home: str
    enabled: bool = True
    healthy: bool = True
    remark: str = ""
    usage_count: int = 0
    last_used_at: str | None = None
    max_concurrency: int | None = None


# ─── Config ────────────────────────────────────────────────


class ApiKeyEntry(BaseModel):
    key: str
    name: str
    models: list[str] = Field(default_factory=list)
    created_at: str
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    monthly_usage: int = 0
    monthly_reset_at: str | None = None
    ip_whitelist: list[str] = Field(default_factory=list)


class BannedIP(BaseModel):
    ip: str
    reason: str = ""
    banned_at: str = ""
    hit_count: int = 1


class AppConfig(BaseModel):
    default_models: list[str] = Field(
        default_factory=lambda: [
            "gpt-5.4",
            "gpt-5.5",
            "gpt-5.4-mini",
            "gpt-5.3-codex",
            "gpt-5.2",
        ]
    )
    api_keys: list[ApiKeyEntry] = Field(default_factory=list)
    banned_ips: list[BannedIP] = Field(default_factory=list)


# ─── Chat Completions API ──────────────────────────────────


class ToolCallFunction(BaseModel):
    """Function definition within a tool call."""
    name: str
    arguments: str


class ToolCall(BaseModel):
    """A tool call requested by the model."""
    id: str
    type: str = "function"
    function: ToolCallFunction


class ChatMessage(BaseModel):
    """A single message in a Chat Completions conversation.

    Supports:
    - Plain text: role="user", content="hello"
    - Multimodal: role="user", content=[{"type":"text","text":"..."}, {"type":"image_url",...}]
    - Tool calls: role="assistant", content=None, tool_calls=[...]
    - Tool results: role="tool", tool_call_id="...", content="result"
    """
    role: str
    content: str | list[dict] | None = None
    name: str | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible Chat Completions request.

    All standard Chat Completions API parameters are supported.
    Aliases (e.g. max_tokens/max_completion_tokens) are unified at the adapter layer.
    """
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    codex_events: bool | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    max_completion_tokens: int | None = None
    reasoning_effort: str | None = None
    tools: list[dict] | None = None
    tool_choice: str | dict | None = None
    top_p: float | None = None
    stop: str | list[str] | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    response_format: dict | None = None
    seed: int | None = None
    parallel_tool_calls: bool | None = None
    stream_options: dict | None = None


class ChatCompletionChoice(BaseModel):
    index: int = 0
    message: dict[str, str] = Field(default_factory=dict)
    finish_reason: str | None = "stop"


class ChatCompletionUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: ChatCompletionUsage = Field(default_factory=ChatCompletionUsage)


class ChatCompletionChunkDelta(BaseModel):
    role: str | None = None
    content: str | None = None
    tool_calls: list[dict] | None = None


class ChatCompletionChunkChoice(BaseModel):
    index: int = 0
    delta: ChatCompletionChunkDelta = Field(default_factory=ChatCompletionChunkDelta)
    finish_reason: str | None = None


class ChatCompletionChunk(BaseModel):
    id: str
    object: str = "chat.completion.chunk"
    created: int
    model: str
    choices: list[ChatCompletionChunkChoice]
    usage: dict | None = None


# ─── Responses API ─────────────────────────────────────────


class ContentPart(BaseModel):
    type: str
    text: str | None = None


class ResponsesInputItem(BaseModel):
    role: str
    content: str | list[ContentPart]


class ResponsesRequest(BaseModel):
    model: str
    input: str | list[dict]
    stream: bool = False
    codex_events: bool | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    previous_response_id: str | None = None
    instructions: str | None = None
    store: bool | None = None
    reasoning_effort: str | None = None
    tools: list[dict] | None = None
    tool_choice: str | None = None
    parallel_tool_calls: bool | None = None


class ResponsesUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class ResponsesOutputContent(BaseModel):
    type: str = "output_text"
    text: str = ""


class ResponsesOutputItem(BaseModel):
    id: str
    type: str = "message"
    role: str = "assistant"
    content: list[ResponsesOutputContent] = Field(default_factory=list)


class ResponsesObject(BaseModel):
    id: str
    object: str = "response"
    created_at: int
    model: str
    output: list[ResponsesOutputItem] = Field(default_factory=list)
    status: str = "completed"
    usage: ResponsesUsage = Field(default_factory=ResponsesUsage)


# ─── Models API ────────────────────────────────────────────


class ModelObject(BaseModel):
    id: str
    object: str = "model"
    created: int
    owned_by: str = "nexus-codex"


class ModelsListResponse(BaseModel):
    object: str = "list"
    data: list[ModelObject]


# ─── Admin API ─────────────────────────────────────────────


class LoginRequest(BaseModel):
    username: str
    password: str


class AddAccountRequest(CamelModel):
    codex_home: str
    remark: str = ""
    max_concurrency: int | None = None


class BootstrapAccountRequest(CamelModel):
    remark: str = ""
    max_concurrency: int | None = None


class UpdateAccountRequest(CamelModel):
    enabled: bool | None = None
    healthy: bool | None = None
    remark: str | None = None
    max_concurrency: int | None = None


class BulkImportItem(CamelModel):
    codex_home: str
    remark: str | None = None
    max_concurrency: int | None = None
    enabled: bool | None = None


class BulkImportRequest(BaseModel):
    accounts: list[BulkImportItem]
    mode: str = "merge"  # "merge" | "replace"


class AddApiKeyRequest(CamelModel):
    key: str | None = None
    name: str = ""
    models: list[str] = Field(default_factory=list)
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    ip_whitelist: list[str] = Field(default_factory=list)


class UpdateApiKeyRequest(CamelModel):
    name: str | None = None
    models: list[str] | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    ip_whitelist: list[str] | None = None


class RevealApiKeyRequest(CamelModel):
    key_prefix: str
    password: str


class AddModelRequest(BaseModel):
    """Request to add a default model."""
    model: str


class AddBannedIpRequest(BaseModel):
    """Request to manually ban an IP address."""
    ip: str
    reason: str = "Manually banned"


class BatchUnbanRequest(BaseModel):
    """Request to unban multiple IPs at once."""
    ips: list[str]


# ─── Error ─────────────────────────────────────────────────


class ErrorDetail(BaseModel):
    message: str
    type: str
    code: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
