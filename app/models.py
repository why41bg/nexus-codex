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
    enabled: bool = True
    models: list[str] = Field(default_factory=list)
    created_at: str
    expires_at: str | None = None
    source: str = "admin"
    template_id: str | None = None
    template_name: str | None = None
    applicant_name: str | None = None
    applicant_contact: str | None = None
    applicant_note: str | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    monthly_usage: int = 0
    monthly_reset_at: str | None = None
    ip_whitelist: list[str] = Field(default_factory=list)


class ApiKeyTemplate(BaseModel):
    id: str
    name: str
    description: str = ""
    enabled: bool = True
    models: list[str] = Field(default_factory=list)
    require_claim_code: bool = True
    claim_code: str = ""
    claim_code_max_usage: int | None = None
    claim_code_used_count: int = 0
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    claim_ip_limit_max: int = 1
    claim_ip_limit_window_ms: int = 24 * 60 * 60 * 1000
    created_at: str
    updated_at: str | None = None


class ClaimRateLimitEntry(BaseModel):
    ip: str
    template_id: str
    timestamps_ms: list[int] = Field(default_factory=list)


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
    api_key_templates: list[ApiKeyTemplate] = Field(default_factory=list)
    claim_rate_limits: list[ClaimRateLimitEntry] = Field(default_factory=list)
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
    expires_at: str | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    ip_whitelist: list[str] = Field(default_factory=list)


class UpdateApiKeyRequest(CamelModel):
    name: str | None = None
    enabled: bool | None = None
    models: list[str] | None = None
    expires_at: str | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    ip_whitelist: list[str] | None = None


class AddApiKeyTemplateRequest(CamelModel):
    name: str
    description: str = ""
    enabled: bool = True
    models: list[str] = Field(default_factory=list)
    require_claim_code: bool = True
    claim_code: str = ""
    claim_code_max_usage: int | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    claim_ip_limit_max: int = 1
    claim_ip_limit_window_ms: int = 24 * 60 * 60 * 1000


class UpdateApiKeyTemplateRequest(CamelModel):
    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    models: list[str] | None = None
    require_claim_code: bool | None = None
    claim_code: str | None = None
    claim_code_max_usage: int | None = None
    rate_limit_max: int | None = None
    rate_limit_window_ms: int | None = None
    monthly_quota: int | None = None
    claim_ip_limit_max: int | None = None
    claim_ip_limit_window_ms: int | None = None


class ClaimApiKeyRequest(CamelModel):
    template_id: str
    applicant_name: str
    applicant_contact: str
    note: str = ""
    claim_code: str = ""


class RevealApiKeyRequest(CamelModel):
    key_prefix: str
    password: str


class AddModelRequest(BaseModel):
    """Request to add a default model."""
    model: str


class BatchKeyActionRequest(BaseModel):
    """Request to perform batch action on API keys."""
    key_prefixes: list[str]
    action: str  # "delete" | "enable" | "disable"


class AddBannedIpRequest(BaseModel):
    """Request to manually ban an IP address."""
    ip: str
    reason: str = "Manually banned"


class BatchUnbanRequest(BaseModel):
    """Request to unban multiple IPs at once."""
    ips: list[str]


# ─── Settings ─────────────────────────────────────────────


class UpdateSettingsRequest(CamelModel):
    """Request to update runtime settings."""
    codex_cli_path: str | None = None


# ─── Error ─────────────────────────────────────────────────


class ErrorDetail(BaseModel):
    message: str
    type: str
    code: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


# ─── Admin Response Models ──────────────────────────────────


class OkResponse(BaseModel):
    """Generic success response."""
    ok: bool = True


class TokenResponse(BaseModel):
    """Login response with session token."""
    token: str


class AccountRuntime(BaseModel):
    """Runtime info for an account."""
    healthy: bool
    activeCount: int
    maxConcurrency: int


class AccountListItem(BaseModel):
    """Account item in list response."""
    id: str
    codexHome: str
    remark: str
    enabled: bool
    usageCount: int
    lastUsedAt: str | None = None
    runtime: AccountRuntime | None = None


class AccountListResponse(BaseModel):
    """Response for list accounts."""
    accounts: list[AccountListItem]


# ─── Dashboard ────────────────────────────────────────────


class DashboardResponse(BaseModel):
    """Dashboard summary response."""
    total: int
    totalSlots: int
    activeSlots: int
    availableSlots: int
    unhealthy: int
    disabled: int
    totalUsage: int
    recentRequests1h: int
    recentErrors1h: int
    avgLatency1h: int | None = None


# ─── API Key Responses ────────────────────────────────────


class ApiKeyListItem(BaseModel):
    """Masked API key item."""
    keyMasked: str
    keyPrefix: str
    name: str
    enabled: bool
    models: list[str]
    effectiveModels: list[str]
    createdAt: str
    expiresAt: str | None = None
    source: str = "admin"
    templateId: str | None = None
    templateName: str | None = None
    applicantName: str | None = None
    applicantContact: str | None = None
    applicantNote: str | None = None
    rateLimitMax: int | None = None
    rateLimitWindowMs: int | None = None
    monthlyQuota: int | None = None
    monthlyUsage: int = 0
    ipWhitelist: list[str] = Field(default_factory=list)


class ApiKeyListResponse(BaseModel):
    """Response for list API keys."""
    keys: list[ApiKeyListItem]


class RevealKeyResponse(BaseModel):
    """Response for revealing full API key."""
    key: str


class CreateKeyResponse(BaseModel):
    """Response for creating an API key."""
    key: str


class BatchKeyActionResponse(BaseModel):
    """Response for batch key actions."""
    succeeded: int
    failed: int


# ─── Models Responses ─────────────────────────────────────


class ModelsAdminResponse(BaseModel):
    """Response for admin models list."""
    models: list[str]


class OkModelsResponse(BaseModel):
    """Response for model add/delete with updated list."""
    ok: bool = True
    models: list[str]


# ─── Banned IP Responses ──────────────────────────────────


class BannedIpItem(BaseModel):
    """Banned IP list item."""
    ip: str
    reason: str
    bannedAt: str
    hitCount: int


class BannedIpListResponse(BaseModel):
    """Response for list banned IPs."""
    bannedIps: list[BannedIpItem]


class OkIpResponse(BaseModel):
    """Response for ban/unban IP."""
    ok: bool = True
    ip: str | None = None


class BatchUnbanResponse(BaseModel):
    """Response for batch unban."""
    ok: bool = True
    removedCount: int


# ─── Settings Responses ───────────────────────────────────


class SettingsResponse(BaseModel):
    """Response for get settings."""
    codexCliPath: str


class UpdateSettingsResponse(BaseModel):
    """Response for update settings."""
    updated: dict


# ─── Key Template Responses ───────────────────────────────


class KeyTemplateItem(BaseModel):
    """Key template item for admin responses."""
    id: str
    name: str
    description: str = ""
    enabled: bool = True
    models: list[str] = Field(default_factory=list)
    requireClaimCode: bool = True
    claimCode: str = ""
    claimCodeMaxUsage: int | None = None
    claimCodeUsedCount: int = 0
    rateLimitMax: int | None = None
    rateLimitWindowMs: int | None = None
    monthlyQuota: int | None = None
    claimIpLimitMax: int = 1
    claimIpLimitWindowMs: int = Field(default=24 * 60 * 60 * 1000)
    createdAt: str
    updatedAt: str | None = None


class KeyTemplateListResponse(BaseModel):
    """Response for list key templates."""
    templates: list[KeyTemplateItem]


class KeyTemplateResponse(BaseModel):
    """Response for single key template."""
    template: KeyTemplateItem
