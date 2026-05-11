"""Admin API key CRUD routes."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddApiKeyRequest,
    BatchKeyActionRequest,
    RevealApiKeyRequest,
    UpdateApiKeyRequest,
)
from app.routes.admin._helpers import resolve_key

router = APIRouter()


@router.get("/keys", dependencies=[Depends(admin_auth_dependency)])
async def list_api_keys(deps: AppDependencies = Depends(get_deps)):
    """List all API keys (no full key returned for security)."""
    keys = deps.config_store.get_api_keys()
    result = []
    for k in keys:
        masked = k.key[:7] + "..." + k.key[-4:] if len(k.key) > 11 else k.key
        prefix = k.key[:12] if len(k.key) >= 12 else k.key
        effective_models = k.models if k.models else deps.config_store.get_default_models()
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
async def reveal_api_key(body: RevealApiKeyRequest, deps: AppDependencies = Depends(get_deps)):
    """Reveal full API key after admin password verification."""
    if not deps.config_store.verify_admin_password(body.password):
        return JSONResponse(
            status_code=403,
            content={"error": {"message": "密码错误", "type": "authentication_error", "code": "invalid_password"}},
        )
    full_key = resolve_key(deps.config_store, body.key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"key": full_key})


@router.post("/keys", dependencies=[Depends(admin_auth_dependency)])
async def create_api_key(body: AddApiKeyRequest, deps: AppDependencies = Depends(get_deps)):
    """Add a new API key."""
    key = body.key or f"sk-{secrets.token_hex(16)}"
    entry = await deps.config_store.add_api_key(
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
async def update_api_key_route(key_prefix: str, body: UpdateApiKeyRequest, deps: AppDependencies = Depends(get_deps)):
    """Update an API key by prefix or full key."""
    full_key = resolve_key(deps.config_store, key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    updates = body.model_dump(exclude_unset=True)
    entry = await deps.config_store.update_api_key(full_key, **updates)
    if not entry:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"ok": True})


@router.delete("/keys/{key_prefix}", dependencies=[Depends(admin_auth_dependency)])
async def delete_api_key(key_prefix: str, deps: AppDependencies = Depends(get_deps)):
    """Delete an API key by prefix or full key."""
    full_key = resolve_key(deps.config_store, key_prefix)
    if not full_key:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    removed = await deps.config_store.remove_api_key(full_key)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "API key not found"}})
    return JSONResponse(content={"ok": True})


@router.post("/keys/batch", dependencies=[Depends(admin_auth_dependency)])
async def batch_key_action(body: BatchKeyActionRequest, deps: AppDependencies = Depends(get_deps)):
    """Perform batch action on multiple API keys."""
    if body.action not in ("delete", "enable", "disable"):
        return JSONResponse(status_code=400, content={"error": {"message": "Invalid action. Must be: delete, enable, disable"}})
    succeeded = 0
    failed = 0
    for prefix in body.key_prefixes:
        full_key = resolve_key(deps.config_store, prefix)
        if not full_key:
            failed += 1
            continue
        if body.action == "delete":
            ok = await deps.config_store.remove_api_key(full_key)
            if ok:
                succeeded += 1
            else:
                failed += 1
        elif body.action == "enable":
            entry = await deps.config_store.update_api_key(full_key, enabled=True)
            if entry:
                succeeded += 1
            else:
                failed += 1
        elif body.action == "disable":
            entry = await deps.config_store.update_api_key(full_key, enabled=False)
            if entry:
                succeeded += 1
            else:
                failed += 1
    return JSONResponse(content={"succeeded": succeeded, "failed": failed})
