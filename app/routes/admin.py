"""Admin API routes - /api/admin/*."""

from __future__ import annotations

import asyncio
import json
import secrets
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.exceptions import AccountNotFoundError
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddAccountRequest,
    AddApiKeyRequest,
    AddBannedIpRequest,
    AddModelRequest,
    BulkImportRequest,
    LoginRequest,
    RevealApiKeyRequest,
    UpdateAccountRequest,
    UpdateApiKeyRequest,
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
    add_default_model,
    find_api_key,
    get_api_keys,
    get_default_models,
    get_models_for_key,
    remove_api_key,
    remove_default_model,
    save_banned_ips,
    update_api_key,
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
async def login(body: LoginRequest):
    """Admin login endpoint."""
    if not verify_admin_auth(body.username, body.password):
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Invalid credentials.", "type": "authentication_error", "code": "invalid_credentials"}},
        )
    token = create_session()
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


@router.patch("/accounts/{account_id}", dependencies=[Depends(admin_auth_dependency)])
async def update_account_route(account_id: str, body: UpdateAccountRequest, deps: AppDependencies = Depends(get_deps)):
    """Update an account."""
    updates = body.model_dump(exclude_none=True)
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
            "models": k.models,
            "effectiveModels": effective_models,
            "createdAt": k.created_at,
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
    """Get metrics time series (in-memory ring buffer, fast)."""
    return JSONResponse(content=deps.metrics_collector.get_time_series(range))


@router.get("/metrics/timeseries/persistent", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_time_series_persistent(range: str = "1h", deps: AppDependencies = Depends(get_deps)):
    """Get metrics time series from persistent SQLite store."""
    return JSONResponse(content=deps.metrics_collector.get_persistent_time_series(range))


@router.get("/metrics/breakdown", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_breakdown(deps: AppDependencies = Depends(get_deps)):
    """Get metrics breakdown (in-memory ring buffer, fast)."""
    return JSONResponse(content=deps.metrics_collector.get_breakdown())


@router.get("/metrics/breakdown/persistent", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_breakdown_persistent(deps: AppDependencies = Depends(get_deps)):
    """Get metrics breakdown from persistent SQLite store."""
    return JSONResponse(content=deps.metrics_collector.get_persistent_breakdown())


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
