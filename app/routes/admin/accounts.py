"""Admin account CRUD, bootstrap, quota, import/export/backup routes."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.exceptions import AccountNotFoundError
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AccountListResponse,
    AddAccountRequest,
    BootstrapAccountRequest,
    BulkImportRequest,
    OkResponse,
    UpdateAccountRequest,
)
from app.services.account_bootstrap import session_to_dict
from app.services.token_manager import TokenManager

router = APIRouter()


# ─── Account CRUD ────────────────────────────────────────────


@router.get("/accounts", dependencies=[Depends(admin_auth_dependency)], response_model=AccountListResponse)
async def list_accounts(deps: AppDependencies = Depends(get_deps)):
    """List all accounts."""
    accounts = await deps.account_store.load_accounts()
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
    acc = await deps.account_store.add_account(body.codex_home, body.remark, body.max_concurrency)
    deps.pool.add_entry(acc)
    deps.admin_emitter.emit({"type": "pool_changed"})
    return JSONResponse(content=acc.model_dump())


# ─── Account Bootstrap ────────────────────────────────────────


@router.post("/accounts/bootstrap", dependencies=[Depends(admin_auth_dependency)])
async def bootstrap_account(body: BootstrapAccountRequest, deps: AppDependencies = Depends(get_deps)):
    """Start account bootstrap: create CODEX_HOME and launch codex login --device-auth."""
    if not deps.bootstrap_manager:
        return JSONResponse(status_code=503, content={"error": {"message": "Bootstrap manager not available"}})
    session = await deps.bootstrap_manager.start_bootstrap(body.remark, body.max_concurrency)
    return JSONResponse(content=session_to_dict(session))


@router.get("/accounts/bootstrap/{session_id}", dependencies=[Depends(admin_auth_dependency)])
async def get_bootstrap_status(session_id: str, deps: AppDependencies = Depends(get_deps)):
    """Poll bootstrap session status."""
    if not deps.bootstrap_manager:
        return JSONResponse(status_code=503, content={"error": {"message": "Bootstrap manager not available"}})
    session = deps.bootstrap_manager.get_session(session_id)
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
    if not deps.bootstrap_manager:
        return JSONResponse(status_code=503, content={"error": {"message": "Bootstrap manager not available"}})
    data = await deps.bootstrap_manager.confirm_bootstrap(session_id)
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
    acc = await deps.account_store.add_account(data["codex_home"], data["remark"], data["max_concurrency"])
    deps.pool.add_entry(acc)
    deps.admin_emitter.emit({"type": "pool_changed"})
    return JSONResponse(content=acc.model_dump())


@router.post("/accounts/bootstrap/{session_id}/cancel", dependencies=[Depends(admin_auth_dependency)])
async def cancel_bootstrap_account(session_id: str, deps: AppDependencies = Depends(get_deps)):
    """Cancel bootstrap and clean up."""
    if not deps.bootstrap_manager:
        return JSONResponse(status_code=503, content={"error": {"message": "Bootstrap manager not available"}})
    ok = await deps.bootstrap_manager.cancel_bootstrap(session_id)
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


@router.patch("/accounts/{account_id}", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def update_account_route(account_id: str, body: UpdateAccountRequest, deps: AppDependencies = Depends(get_deps)):
    """Update an account."""
    updates = body.model_dump(exclude_unset=True)
    acc = await deps.account_store.update_account(account_id, **updates)
    if not acc:
        raise AccountNotFoundError(account_id)

    # Update pool entry
    if body.healthy is not None:
        deps.pool.update_entry(account_id, healthy=body.healthy)
    if body.max_concurrency is not None:
        deps.pool.update_entry(account_id, max_concurrency=body.max_concurrency)

    deps.admin_emitter.emit({"type": "pool_changed"})
    return JSONResponse(content={"ok": True})


@router.delete("/accounts/{account_id}", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def delete_account(account_id: str, deps: AppDependencies = Depends(get_deps)):
    """Delete an account."""
    removed = await deps.account_store.remove_account(account_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Account not found"}})
    deps.pool.remove_entry(account_id)
    deps.admin_emitter.emit({"type": "pool_changed"})
    return JSONResponse(content={"ok": True})


@router.post("/accounts/import", dependencies=[Depends(admin_auth_dependency)])
async def bulk_import(body: BulkImportRequest, deps: AppDependencies = Depends(get_deps)):
    """Bulk import accounts."""
    items = [item.model_dump() for item in body.accounts]
    result = await deps.account_store.bulk_import_accounts(items, body.mode)

    # Add imported accounts to pool
    accounts = await deps.account_store.load_accounts()
    imported_ids = {a["id"] for a in result["imported_accounts"]}
    for acc in accounts:
        if acc.id in imported_ids:
            deps.pool.add_entry(acc)

    deps.admin_emitter.emit({"type": "pool_changed"})
    return JSONResponse(content=result)


@router.get("/accounts/export", dependencies=[Depends(admin_auth_dependency)])
async def export_accounts(deps: AppDependencies = Depends(get_deps)):
    """Export all accounts as JSON."""
    accounts = await deps.account_store.load_accounts()
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
async def backup_all(deps: AppDependencies = Depends(get_deps)):
    """Download full backup (accounts + config)."""
    accounts = await deps.account_store.load_accounts()
    keys = deps.config_store.get_api_keys()
    models = deps.config_store.get_default_models()
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
async def get_account_quota(account_id: str, deps: AppDependencies = Depends(get_deps)):
    """Get account quota info."""
    accounts = await deps.account_store.load_accounts()
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

    if not deps.quota_probe_service:
        return JSONResponse(status_code=503, content={"error": {"message": "Quota probe service not available"}})

    # Reuse the TokenManager from the pool if available
    pool_entry = next((e for e in deps.pool.entries() if e.account_id == account_id), None)
    tm = pool_entry.token_manager if pool_entry else None
    quota = await deps.quota_probe_service.probe_quota(account.codex_home, token_manager=tm)
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
async def refresh_account_quota(account_id: str, deps: AppDependencies = Depends(get_deps)):
    """Refresh account quota (bypasses cache)."""
    accounts = await deps.account_store.load_accounts()
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

    if not deps.quota_probe_service:
        return JSONResponse(status_code=503, content={"error": {"message": "Quota probe service not available"}})

    pool_entry = next((e for e in deps.pool.entries() if e.account_id == account_id), None)
    tm = pool_entry.token_manager if pool_entry else None
    quota = await deps.quota_probe_service.refresh_quota(account.codex_home, token_manager=tm)
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
async def batch_refresh_quota(deps: AppDependencies = Depends(get_deps)):
    """Batch refresh quota for all accounts (bypasses cache)."""
    if not deps.quota_probe_service:
        return JSONResponse(status_code=503, content={"error": {"message": "Quota probe service not available"}})

    accounts = await deps.account_store.load_accounts()
    results: dict[str, dict[str, Any]] = {}
    # Build a lookup for reusing existing TokenManagers
    _pool_tm: dict[str, TokenManager] = {
        e.account_id: e.token_manager for e in deps.pool.entries() if e.token_manager
    }

    async def _fetch_one(acc) -> None:
        quota = await deps.quota_probe_service.refresh_quota(acc.codex_home, token_manager=_pool_tm.get(acc.id))
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


# ─── Pool Status ──────────────────────────────────────────────


@router.get("/pool-status", dependencies=[Depends(admin_auth_dependency)])
async def get_pool_status(deps: AppDependencies = Depends(get_deps)):
    """Get current pool status."""
    return JSONResponse(content=deps.pool.get_status())
