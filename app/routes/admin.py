"""Admin API routes - /api/admin/*."""

from __future__ import annotations

import asyncio
import json
import secrets
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.exceptions import AccountNotFoundError
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddAccountRequest,
    AddApiKeyRequest,
    AddApiKeyTemplateRequest,
    AddBannedIpRequest,
    AddModelRequest,
    BatchKeyActionRequest,
    BatchUnbanRequest,
    BootstrapAccountRequest,
    BulkImportRequest,
    LoginRequest,
    RevealApiKeyRequest,
    UpdateAccountRequest,
    UpdateApiKeyRequest,
    UpdateApiKeyTemplateRequest,
    UpdateSettingsRequest,
)
from app.services.account_bootstrap import (
    cancel_bootstrap,
    confirm_bootstrap,
    get_session,
    session_to_dict,
    start_bootstrap,
)
from app.services.account_store import (
    add_account,
    bulk_import_accounts,
    load_accounts,
    remove_account,
    update_account,
)
from app.services.admin_emitter import emit_admin_event, subscribe, unsubscribe
from app.services.config_store import (
    add_api_key,
    add_api_key_template,
    add_default_model,
    find_api_key,
    get_api_key_templates,
    get_api_keys,
    get_default_models,
    get_models_for_key,
    remove_api_key,
    remove_api_key_template,
    remove_default_model,
    reset_claim_code_usage,
    save_banned_ips,
    update_api_key,
    update_api_key_template,
    verify_admin_auth,
    verify_admin_password,
)
from app.services.ip_ban_store import (
    ban_ip,
    get_banned_ips,
    unban_ip,
)
from app.services.quota_probe import probe_quota, refresh_quota
from app.services.session_manager import create_session, destroy_session

router = APIRouter()


def _resolve_key(key_prefix: str) -> str | None:
    """Resolve a key prefix to the full key string."""
    keys = get_api_keys()
    # Try exact match first
    for k in keys:
        if k.key == key_prefix:
            return k.key
    # Try prefix match
    for k in keys:
        if k.key.startswith(key_prefix):
            return k.key
    return None


def _template_to_admin_dict(template) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "enabled": template.enabled,
        "models": template.models,
        "requireClaimCode": template.require_claim_code,
        "claimCode": template.claim_code,
        "claimCodeMaxUsage": template.claim_code_max_usage,
        "claimCodeUsedCount": template.claim_code_used_count,
        "rateLimitMax": template.rate_limit_max,
        "rateLimitWindowMs": template.rate_limit_window_ms,
        "monthlyQuota": template.monthly_quota,
        "claimIpLimitMax": template.claim_ip_limit_max,
        "claimIpLimitWindowMs": template.claim_ip_limit_window_ms,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
    }


# ─── SSE Stream ──────────────────────────────────────────────


@router.get("/stream", dependencies=[Depends(admin_auth_dependency)])
async def admin_stream():
    """SSE stream for real-time admin panel updates."""

    async def event_generator() -> AsyncGenerator[str, None]:
        queue = subscribe()
        try:
            # Send initial snapshot
            yield f"data: {json.dumps({'type': 'pool_changed'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield ": heartbeat\n\n"
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Auth ────────────────────────────────────────────────────


@router.post("/login")
async def login(body: LoginRequest, request: Request, deps: AppDependencies = Depends(get_deps)):
    """Admin login endpoint."""
    client_ip = request.client.host if request.client else "-"

    if not verify_admin_auth(body.username, body.password):
        if deps.log_collector:
            deps.log_collector.emit(
                "login_failure", f"Admin login failed: {body.username}",
                context={"username": body.username},
                client_ip=client_ip,
            )
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Invalid credentials.", "type": "authentication_error", "code": "invalid_credentials"}},
        )
    token = create_session()
    if deps.log_collector:
        deps.log_collector.emit(
            "login_success", f"Admin login: {body.username}",
            context={"username": body.username},
            session_id=token,
            client_ip=client_ip,
        )
    return JSONResponse(content={"token": token})


@router.post("/logout", dependencies=[Depends(admin_auth_dependency)])
async def logout(request: Request):
    """Admin logout endpoint."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        destroy_session(token)
    return JSONResponse(content={"ok": True})


# ─── Dashboard ────────────────────────────────────────────────


@router.get("/dashboard", dependencies=[Depends(admin_auth_dependency)])
async def get_dashboard(deps: AppDependencies = Depends(get_deps)):
    """Dashboard summary data."""
    accounts = await load_accounts()
    status = deps.pool.get_status()

    total = len(accounts)
    total_slots = sum(e["max_concurrency"] for e in status)
    active_slots = sum(e["active_count"] for e in status)
    available_slots = total_slots - active_slots
    unhealthy = sum(1 for e in status if not e["healthy"])
    disabled = sum(1 for a in accounts if not a.enabled)
    total_usage = sum(a.usage_count for a in accounts)

    metrics_1h = deps.metrics_collector.get_time_series("1h")
    buckets = metrics_1h.get("buckets", [])
    recent_requests = sum(b.get("requestCount", 0) for b in buckets)
    recent_errors = sum(b.get("errorCount", 0) for b in buckets)
    latencies = [b.get("avgLatencyMs", 0) for b in buckets if b.get("avgLatencyMs")]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else None

    return JSONResponse(content={
        "total": total,
        "totalSlots": total_slots,
        "activeSlots": active_slots,
        "availableSlots": available_slots,
        "unhealthy": unhealthy,
        "disabled": disabled,
        "totalUsage": total_usage,
        "recentRequests1h": recent_requests,
        "recentErrors1h": recent_errors,
        "avgLatency1h": avg_latency,
    })


# ─── Account CRUD ────────────────────────────────────────────


@router.get("/accounts", dependencies=[Depends(admin_auth_dependency)])
async def list_accounts(deps: AppDependencies = Depends(get_deps)):
    """List all accounts."""
    accounts = await load_accounts()
    pool_status = {e["account_id"]: e for e in deps.pool.get_status()}
    result = []
    for acc in accounts:
        ps = pool_status.get(acc.id)
        runtime = None
        if ps:
            runtime = {
                "healthy": ps["healthy"],
                "activeCount": ps["active_count"],
                "maxConcurrency": ps["max_concurrency"],
            }
        result.append({
            "id": acc.id,
            "codexHome": acc.codex_home,
            "remark": acc.remark,
            "enabled": acc.enabled,
            "usageCount": acc.usage_count,
            "lastUsedAt": acc.last_used_at,
            "runtime": runtime,
        })
    return JSONResponse(content={"accounts": result})


@router.post("/accounts", dependencies=[Depends(admin_auth_dependency)])
async def create_account(body: AddAccountRequest, deps: AppDependencies = Depends(get_deps)):
    """Add a new account."""
    acc = await add_account(body.codex_home, body.remark, body.max_concurrency)
    deps.pool.add_entry(acc)
    emit_admin_event({"type": "pool_changed"})
    return JSONResponse(content=acc.model_dump())


# ─── Account Bootstrap ────────────────────────────────────────


@router.post("/accounts/bootstrap", dependencies=[Depends(admin_auth_dependency)])
async def bootstrap_account(body: BootstrapAccountRequest):
    """Start account bootstrap: create CODEX_HOME and launch codex login --device-auth."""
    session = await start_bootstrap(body.remark, body.max_concurrency)
    return JSONResponse(content=session_to_dict(session))


@router.get("/accounts/bootstrap/{session_id}", dependencies=[Depends(admin_auth_dependency)])
async def get_bootstrap_status(session_id: str):
    """Poll bootstrap session status."""
    session = get_session(session_id)
    if not session:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": "Bootstrap session not found",
                    "type": "not_found",
                    "code": "session_not_found",
                }
            },
        )
    return JSONResponse(content=session_to_dict(session))


@router.post("/accounts/bootstrap/{session_id}/confirm", dependencies=[Depends(admin_auth_dependency)])
async def confirm_bootstrap_account(session_id: str, deps: AppDependencies = Depends(get_deps)):
    """Confirm bootstrap and register the account."""
    data = await confirm_bootstrap(session_id)
    if not data:
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": "Bootstrap session is not in success state",
                    "type": "invalid_request",
                    "code": "not_ready",
                }
            },
        )
    acc = await add_account(data["codex_home"], data["remark"], data["max_concurrency"])
    deps.pool.add_entry(acc)
    emit_admin_event({"type": "pool_changed"})
    return JSONResponse(content=acc.model_dump())


@router.post("/accounts/bootstrap/{session_id}/cancel", dependencies=[Depends(admin_auth_dependency)])
async def cancel_bootstrap_account(session_id: str):
    """Cancel bootstrap and clean up."""
    ok = await cancel_bootstrap(session_id)
    if not ok:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": "Bootstrap session not found",
                    "type": "not_found",
                    "code": "session_not_found",
                }
            },
        )
    return JSONResponse(content={"ok": True})


@router.patch("/accounts/{account_id}", dependencies=[Depends(admin_auth_dependency)])
async def update_account_route(account_id: str, body: UpdateAccountRequest, deps: AppDependencies = Depends(get_deps)):
    """Update an account."""
    updates = body.model_dump(exclude_unset=True)
    acc = await update_account(account_id, **updates)
    if not acc:
        raise AccountNotFoundError(account_id)

    # Update pool entry
    if body.healthy is not None:
        deps.pool.update_entry(account_id, healthy=body.healthy)
    if body.max_concurrency is not None:
        deps.pool.update_entry(account_id, max_concurrency=body.max_concurrency)

    emit_admin_event({"type": "pool_changed"})
    return JSONResponse(content={"ok": True})


@router.delete("/accounts/{account_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_account(account_id: str, deps: AppDependencies = Depends(get_deps)):
    """Delete an account."""
    removed = await remove_account(account_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Account not found"}})
    deps.pool.remove_entry(account_id)
    emit_admin_event({"type": "pool_changed"})
    return JSONResponse(content={"ok": True})


@router.post("/accounts/import", dependencies=[Depends(admin_auth_dependency)])
async def bulk_import(body: BulkImportRequest, deps: AppDependencies = Depends(get_deps)):
    """Bulk import accounts."""
    items = [item.model_dump() for item in body.accounts]
    result = await bulk_import_accounts(items, body.mode)

    # Add imported accounts to pool
    accounts = await load_accounts()
    imported_ids = {a["id"] for a in result["imported_accounts"]}
    for acc in accounts:
        if acc.id in imported_ids:
            deps.pool.add_entry(acc)

    emit_admin_event({"type": "pool_changed"})
    return JSONResponse(content=result)


@router.get("/accounts/export", dependencies=[Depends(admin_auth_dependency)])
async def export_accounts():
    """Export all accounts as JSON."""
    accounts = await load_accounts()
    result = []
    for acc in accounts:
        result.append({
            "codexHome": acc.codex_home,
            "remark": acc.remark,
            "enabled": acc.enabled,
            "maxConcurrency": acc.max_concurrency,
        })
    return JSONResponse(content={"accounts": result})


@router.get("/backup", dependencies=[Depends(admin_auth_dependency)])
async def backup_all():
    """Download full backup (accounts + config)."""
    accounts = await load_accounts()
    keys = get_api_keys()
    models = get_default_models()
    return JSONResponse(content={
        "accounts": [
            {
                "codexHome": acc.codex_home,
                "remark": acc.remark,
                "enabled": acc.enabled,
                "maxConcurrency": acc.max_concurrency,
            }
            for acc in accounts
        ],
        "apiKeys": [
            {
                "key": k.key,
                "name": k.name,
                "models": k.models,
            }
            for k in keys
        ],
        "defaultModels": models,
    })


# ─── Account Quota ────────────────────────────────────────────


@router.get("/accounts/{account_id}/quota", dependencies=[Depends(admin_auth_dependency)])
async def get_account_quota(account_id: str):
    """Get account quota info."""
    accounts = await load_accounts()
    account = next((a for a in accounts if a.id == account_id), None)
    if not account:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": f"Account '{account_id}' not found.",
                    "type": "invalid_request_error",
                    "code": "not_found",
                }
            },
        )

    quota = await probe_quota(account.codex_home)
    if not quota:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Failed to retrieve quota. The access token may be expired or the API may be unavailable.",
                    "type": "server_error",
                    "code": "quota_unavailable",
                }
            },
        )

    return JSONResponse(content={"quota": quota.to_dict()})


@router.post("/accounts/{account_id}/quota/refresh", dependencies=[Depends(admin_auth_dependency)])
async def refresh_account_quota(account_id: str):
    """Refresh account quota (bypasses cache)."""
    accounts = await load_accounts()
    account = next((a for a in accounts if a.id == account_id), None)
    if not account:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": f"Account '{account_id}' not found.",
                    "type": "invalid_request_error",
                    "code": "not_found",
                }
            },
        )

    quota = await refresh_quota(account.codex_home)
    if not quota:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Failed to retrieve quota. The access token may be expired or the API may be unavailable.",
                    "type": "server_error",
                    "code": "quota_unavailable",
                }
            },
        )

    return JSONResponse(content={"quota": quota.to_dict()})


@router.post("/accounts/quota/batch", dependencies=[Depends(admin_auth_dependency)])
async def batch_refresh_quota():
    """Batch refresh quota for all accounts (bypasses cache)."""
    accounts = await load_accounts()
    results: dict[str, dict[str, Any]] = {}

    async def _fetch_one(acc) -> None:
        quota = await refresh_quota(acc.codex_home)
        if quota:
            results[acc.id] = {"quota": quota.to_dict()}
        else:
            results[acc.id] = {
                "error": {
                    "message": "Failed to retrieve quota. The access token may be expired or the API may be unavailable.",
                    "type": "server_error",
                    "code": "quota_unavailable",
                }
            }

    await asyncio.gather(*(_fetch_one(acc) for acc in accounts))
    return JSONResponse(content={"quotas": results})


# ─── API Key CRUD ────────────────────────────────────────────


@router.get("/keys", dependencies=[Depends(admin_auth_dependency)])
async def list_api_keys():
    """List all API keys (no full key returned for security)."""
    keys = get_api_keys()
    result = []
    for k in keys:
        masked = k.key[:7] + "..." + k.key[-4:] if len(k.key) > 11 else k.key
        prefix = k.key[:12] if len(k.key) >= 12 else k.key
        effective_models = k.models if k.models else get_default_models()
        result.append({
            "keyMasked": masked,
            "keyPrefix": prefix,
            "name": k.name,
            "enabled": k.enabled,
            "models": k.models,
            "effectiveModels": effective_models,
            "createdAt": k.created_at,
            "expiresAt": k.expires_at,
            "source": k.source,
            "templateId": k.template_id,
            "templateName": k.template_name,
            "applicantName": k.applicant_name,
            "applicantContact": k.applicant_contact,
            "applicantNote": k.applicant_note,
            "rateLimitMax": k.rate_limit_max,
            "rateLimitWindowMs": k.rate_limit_window_ms,
            "monthlyQuota": k.monthly_quota,
            "monthlyUsage": k.monthly_usage,
            "ipWhitelist": k.ip_whitelist,
        })
    return JSONResponse(content={"keys": result})


@router.post("/keys/reveal", dependencies=[Depends(admin_auth_dependency)])
async def reveal_api_key(body: RevealApiKeyRequest):
    """Reveal full API key after admin password verification."""
    if not verify_admin_password(body.password):
        return JSONResponse(
            status_code=403,
            content={"error": {"message": "密码错误", "type": "authentication_error", "code": "invalid_password"}},
        )
    full_key = _resolve_key(body.key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"key": full_key})


@router.post("/keys", dependencies=[Depends(admin_auth_dependency)])
async def create_api_key(body: AddApiKeyRequest):
    """Add a new API key."""
    key = body.key or f"sk-{secrets.token_hex(16)}"
    entry = await add_api_key(
        key=key,
        name=body.name,
        models=body.models,
        expires_at=body.expires_at,
        rate_limit_max=body.rate_limit_max,
        rate_limit_window_ms=body.rate_limit_window_ms,
        monthly_quota=body.monthly_quota,
        ip_whitelist=body.ip_whitelist,
    )
    return JSONResponse(content={"key": entry.key})


@router.patch("/keys/{key_prefix}", dependencies=[Depends(admin_auth_dependency)])
async def update_api_key_route(key_prefix: str, body: UpdateApiKeyRequest):
    """Update an API key by prefix or full key."""
    full_key = _resolve_key(key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    updates = body.model_dump(exclude_none=True)
    entry = await update_api_key(full_key, **updates)
    if not entry:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"ok": True})


@router.delete("/keys/{key_prefix}", dependencies=[Depends(admin_auth_dependency)])
async def delete_api_key(key_prefix: str):
    """Delete an API key by prefix or full key."""
    full_key = _resolve_key(key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    removed = await remove_api_key(full_key)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"ok": True})


@router.post("/keys/batch", dependencies=[Depends(admin_auth_dependency)])
async def batch_key_action(body: BatchKeyActionRequest):
    """Perform batch action on multiple API keys."""
    if body.action not in ("delete", "enable", "disable"):
        return JSONResponse(status_code=400, content={"error": {"message": "Invalid action. Must be: delete, enable, disable"}})
    succeeded = 0
    failed = 0
    for prefix in body.key_prefixes:
        full_key = _resolve_key(prefix)
        if not full_key:
            failed += 1
            continue
        if body.action == "delete":
            ok = await remove_api_key(full_key)
            if ok:
                succeeded += 1
            else:
                failed += 1
        elif body.action == "enable":
            entry = await update_api_key(full_key, enabled=True)
            if entry:
                succeeded += 1
            else:
                failed += 1
        elif body.action == "disable":
            entry = await update_api_key(full_key, enabled=False)
            if entry:
                succeeded += 1
            else:
                failed += 1
    return JSONResponse(content={"succeeded": succeeded, "failed": failed})


# ─── API Key Claim Templates ─────────────────────────────────


@router.get("/key-templates", dependencies=[Depends(admin_auth_dependency)])
async def list_api_key_templates():
    """List API key self-service claim templates."""
    templates = [_template_to_admin_dict(t) for t in get_api_key_templates()]
    return JSONResponse(content={"templates": templates})


def _validate_template_payload(data: dict) -> str | None:
    name = str(data.get("name") or "").strip()
    if not name:
        return "模板名称不能为空"
    models = data.get("models")
    if not isinstance(models, list) or len([m for m in models if str(m).strip()]) == 0:
        return "模板至少需要配置一个可用模型"
    if data.get("require_claim_code") and not str(data.get("claim_code") or "").strip():
        return "启用申领码时必须填写申领码"
    try:
        if int(data.get("claim_ip_limit_max") or 0) <= 0:
            return "IP 限流次数必须大于 0"
        if int(data.get("claim_ip_limit_window_ms") or 0) < 60000:
            return "IP 限流窗口不能小于 60000ms"
    except (TypeError, ValueError):
        return "IP 限流配置必须是数字"
    return None


@router.post("/key-templates", dependencies=[Depends(admin_auth_dependency)])
async def create_api_key_template(body: AddApiKeyTemplateRequest):
    """Create an API key self-service claim template."""
    data = body.model_dump()
    data["name"] = body.name.strip()
    data["description"] = body.description.strip()
    data["models"] = [m.strip() for m in body.models if m.strip()]
    data["claim_code"] = body.claim_code.strip()
    error = _validate_template_payload(data)
    if error:
        return JSONResponse(status_code=400, content={"error": {"message": error}})
    template = await add_api_key_template(**data)
    return JSONResponse(content={"template": _template_to_admin_dict(template)})


@router.patch("/key-templates/{template_id}", dependencies=[Depends(admin_auth_dependency)])
async def update_api_key_template_route(template_id: str, body: UpdateApiKeyTemplateRequest):
    """Update an API key self-service claim template."""
    existing = next((t for t in get_api_key_templates() if t.id == template_id), None)
    if not existing:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})

    updates = body.model_dump(exclude_none=True)
    merged = existing.model_dump()
    merged.update(updates)
    merged["name"] = str(merged.get("name") or "").strip()
    merged["description"] = str(merged.get("description") or "").strip()
    merged["models"] = [str(m).strip() for m in merged.get("models", []) if str(m).strip()]
    merged["claim_code"] = str(merged.get("claim_code") or "").strip()
    error = _validate_template_payload(merged)
    if error:
        return JSONResponse(status_code=400, content={"error": {"message": error}})

    template = await update_api_key_template(
        template_id,
        name=merged["name"],
        description=merged["description"],
        enabled=merged["enabled"],
        models=merged["models"],
        require_claim_code=merged["require_claim_code"],
        claim_code=merged["claim_code"],
        claim_code_max_usage=merged.get("claim_code_max_usage"),
        rate_limit_max=merged.get("rate_limit_max"),
        rate_limit_window_ms=merged.get("rate_limit_window_ms"),
        monthly_quota=merged.get("monthly_quota"),
        claim_ip_limit_max=merged["claim_ip_limit_max"],
        claim_ip_limit_window_ms=merged["claim_ip_limit_window_ms"],
    )
    if not template:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})
    return JSONResponse(content={"template": _template_to_admin_dict(template)})


@router.delete("/key-templates/{template_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_api_key_template(template_id: str):
    """Delete an API key self-service claim template."""
    removed = await remove_api_key_template(template_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})
    return JSONResponse(content={"ok": True})


@router.post("/key-templates/{template_id}/reset-usage", dependencies=[Depends(admin_auth_dependency)])
async def reset_template_claim_usage(template_id: str):
    """Reset the claim code used count for a template."""
    ok = await reset_claim_code_usage(template_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})
    return JSONResponse(content={"ok": True})


# ─── Models CRUD ─────────────────────────────────────────────


@router.get("/models", dependencies=[Depends(admin_auth_dependency)])
async def list_default_models():
    """List default models."""
    return JSONResponse(content={"models": get_default_models()})


@router.post("/models", dependencies=[Depends(admin_auth_dependency)])
async def add_model(body: AddModelRequest):
    """Add a default model."""
    model_id = body.model.strip()
    if not model_id:
        return JSONResponse(status_code=400, content={"error": {"message": "model is required"}})
    added = await add_default_model(model_id)
    if not added:
        return JSONResponse(status_code=409, content={"error": {"message": "Model already exists"}})
    return JSONResponse(content={"ok": True, "models": get_default_models()})


@router.delete("/models/{model_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_model(model_id: str):
    """Remove a default model."""
    removed = await remove_default_model(model_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Model not found"}})
    return JSONResponse(content={"ok": True, "models": get_default_models()})


# ─── Pool Status ──────────────────────────────────────────────


@router.get("/pool-status", dependencies=[Depends(admin_auth_dependency)])
async def get_pool_status(deps: AppDependencies = Depends(get_deps)):
    """Get current pool status."""
    return JSONResponse(content=deps.pool.get_status())


# ─── Metrics ──────────────────────────────────────────────────


@router.get("/metrics/timeseries", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_time_series(range: str = "1h", deps: AppDependencies = Depends(get_deps)):
    """Get metrics time series from persistent SQLite store."""
    return JSONResponse(content=deps.metrics_collector.get_time_series(range))


@router.get("/metrics/breakdown", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_breakdown(deps: AppDependencies = Depends(get_deps)):
    """Get metrics breakdown from persistent SQLite store."""
    return JSONResponse(content=deps.metrics_collector.get_breakdown())


@router.get("/metrics/percentiles", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_percentiles(range: str = "24h", deps: AppDependencies = Depends(get_deps)):
    """Get latency percentiles (P50/P95/P99) from persistent store."""
    return JSONResponse(content=deps.metrics_collector.get_percentiles(range))


@router.get("/metrics/summary", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_summary(range: str = "24h", deps: AppDependencies = Depends(get_deps)):
    """Get KPI summary with period-over-period comparison."""
    return JSONResponse(content=deps.metrics_collector.get_summary(range))


@router.get("/metrics/per-key", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_per_key(range: str = "24h", deps: AppDependencies = Depends(get_deps)):
    """Get per API key usage statistics."""
    return JSONResponse(content=deps.metrics_collector.get_per_key_stats(range))


# ─── IP Ban Management ────────────────────────────────────────


@router.get("/banned-ips", dependencies=[Depends(admin_auth_dependency)])
async def list_banned_ips():
    """List all banned IPs."""
    banned = get_banned_ips()
    result = [
        {
            "ip": entry.ip,
            "reason": entry.reason,
            "bannedAt": entry.banned_at,
            "hitCount": entry.hit_count,
        }
        for entry in banned
    ]
    return JSONResponse(content={"bannedIps": result})


@router.post("/banned-ips", dependencies=[Depends(admin_auth_dependency)])
async def add_banned_ip(body: AddBannedIpRequest):
    """Manually ban an IP address."""
    ip = body.ip.strip()
    reason = body.reason

    if not ip:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "IP address is required.", "type": "invalid_request_error", "code": "missing_ip"}},
        )

    entry = ban_ip(ip, reason=reason)
    if not entry:
        return JSONResponse(
            status_code=409,
            content={"error": {"message": "IP is already banned.", "type": "conflict", "code": "already_banned"}},
        )

    # Persist
    await save_banned_ips(get_banned_ips())
    emit_admin_event({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True, "ip": entry.ip})


@router.delete("/banned-ips/{ip}", dependencies=[Depends(admin_auth_dependency)])
async def remove_banned_ip(ip: str):
    """Unban an IP address."""
    removed = unban_ip(ip)
    if not removed:
        return JSONResponse(
            status_code=404,
            content={"error": {"message": "IP not found in ban list.", "type": "invalid_request_error", "code": "not_found"}},
        )

    # Persist
    await save_banned_ips(get_banned_ips())
    emit_admin_event({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True})


@router.post("/banned-ips/batch-unban", dependencies=[Depends(admin_auth_dependency)])
async def batch_unban_ips(body: BatchUnbanRequest):
    """Unban multiple IP addresses at once."""
    if not body.ips:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "IP list is empty.", "type": "invalid_request_error", "code": "empty_list"}},
        )

    removed_count = 0
    for ip in body.ips:
        if unban_ip(ip):
            removed_count += 1

    # Persist
    await save_banned_ips(get_banned_ips())
    emit_admin_event({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True, "removedCount": removed_count})


# ─── Logs ─────────────────────────────────────────────────────


@router.get("/logs", dependencies=[Depends(admin_auth_dependency)])
async def query_logs(
    request: Request,
    keyword: str | None = None,
    level: str | None = None,
    source: str | None = None,
    event: str | None = None,
    tag: str | None = None,
    trace_id: str | None = None,
    account_id: str | None = None,
    api_key_id: str | None = None,
    client_ip: str | None = None,
    since: int | None = None,
    until: int | None = None,
    min_duration_ms: int | None = None,
    limit: int = 50,
    offset: int = 0,
    order: str = "desc",
    deps: AppDependencies = Depends(get_deps),
):
    """Query structured logs with flexible filtering."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )

    # Parse comma-separated multi-values
    levels = level.split(",") if level and "," in level else None
    events = event.split(",") if event and "," in event else None
    tags_all = tag.split(",") if tag and "," in tag else None

    # Determine source_prefix vs exact source
    source_prefix = None
    exact_source = source
    if source and source.endswith("*"):
        source_prefix = source.rstrip("*")
        exact_source = None

    # Clamp limit
    limit = min(max(1, limit), 200)

    result = deps.log_store.query(
        keyword=keyword,
        level=None if levels else level,
        levels=levels,
        source=exact_source,
        source_prefix=source_prefix,
        event=None if events else event,
        events=events,
        tag=tag if (tag and "," not in tag) else None,
        tags_all=tags_all,
        trace_id=trace_id,
        account_id=account_id,
        api_key_id=api_key_id,
        client_ip=client_ip,
        since=since,
        until=until,
        min_duration_ms=min_duration_ms,
        limit=limit,
        offset=offset,
        order=order,
    )
    return JSONResponse(content=result)


@router.get("/logs/error-summary", dependencies=[Depends(admin_auth_dependency)])
async def logs_error_summary(
    range: str = "24h",
    deps: AppDependencies = Depends(get_deps),
):
    """Get error event statistics summary."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )
    result = deps.log_store.get_error_summary(range)
    return JSONResponse(content=result)


@router.get("/logs/trace/{trace_id}", dependencies=[Depends(admin_auth_dependency)])
async def logs_trace(
    trace_id: str,
    deps: AppDependencies = Depends(get_deps),
):
    """Get all log entries for a specific trace ID."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )
    items = deps.log_store.get_trace(trace_id)
    return JSONResponse(content={"items": items, "trace_id": trace_id})


# ─── Settings ────────────────────────────────────────────────


@router.get("/settings", dependencies=[Depends(admin_auth_dependency)])
async def get_settings():
    """Get current runtime settings."""
    from app.config import settings

    return JSONResponse(content={
        "codexCliPath": settings.codex_cli_path,
    })


@router.patch("/settings", dependencies=[Depends(admin_auth_dependency)])
async def update_settings(body: UpdateSettingsRequest):
    """Update runtime settings (persisted to data/settings.json)."""
    import os
    from pathlib import Path

    from app.config import settings

    updated: dict[str, Any] = {}

    if body.codex_cli_path is not None:
        # Validate path if it looks like an absolute path
        if body.codex_cli_path.startswith("/") and not os.path.isfile(body.codex_cli_path):
            return JSONResponse(
                status_code=400,
                content={
                    "error": {
                        "message": f"File not found: {body.codex_cli_path}",
                        "type": "invalid_request",
                        "code": "invalid_path",
                    }
                },
            )
        settings.codex_cli_path = body.codex_cli_path
        updated["codexCliPath"] = body.codex_cli_path

    # Persist to data/settings.json
    settings_file = Path("data/settings.json")
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if settings_file.exists():
        try:
            existing = json.loads(settings_file.read_text())
        except (json.JSONDecodeError, OSError):
            existing = {}
    if body.codex_cli_path is not None:
        existing["codex_cli_path"] = body.codex_cli_path
    settings_file.write_text(json.dumps(existing, indent=2))

    return JSONResponse(content={"updated": updated})
