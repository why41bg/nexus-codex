"""Admin IP ban management routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddBannedIpRequest,
    BannedIpListResponse,
    BatchUnbanRequest,
    BatchUnbanResponse,
    OkIpResponse,
    OkResponse,
)

router = APIRouter()


@router.get("/banned-ips", dependencies=[Depends(admin_auth_dependency)], response_model=BannedIpListResponse)
async def list_banned_ips(deps: AppDependencies = Depends(get_deps)):
    """List all banned IPs."""
    banned = deps.ip_ban_store.get_banned_ips()
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


@router.post("/banned-ips", dependencies=[Depends(admin_auth_dependency)], response_model=OkIpResponse)
async def add_banned_ip(body: AddBannedIpRequest, deps: AppDependencies = Depends(get_deps)):
    """Manually ban an IP address."""
    ip = body.ip.strip()
    reason = body.reason

    if not ip:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "IP address is required.", "type": "invalid_request_error", "code": "missing_ip"}},
        )

    entry = deps.ip_ban_store.ban_ip(ip, reason=reason)
    if not entry:
        return JSONResponse(
            status_code=409,
            content={"error": {"message": "IP is already banned.", "type": "conflict", "code": "already_banned"}},
        )

    # Persist
    await deps.config_store.save_banned_ips(deps.ip_ban_store.get_banned_ips())
    deps.admin_emitter.emit({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True, "ip": entry.ip})


@router.delete("/banned-ips/{ip}", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def remove_banned_ip(ip: str, deps: AppDependencies = Depends(get_deps)):
    """Unban an IP address."""
    removed = deps.ip_ban_store.unban_ip(ip)
    if not removed:
        return JSONResponse(
            status_code=404,
            content={"error": {"message": "IP not found in ban list.", "type": "invalid_request_error", "code": "not_found"}},
        )

    # Persist
    await deps.config_store.save_banned_ips(deps.ip_ban_store.get_banned_ips())
    deps.admin_emitter.emit({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True})


@router.post("/banned-ips/batch-unban", dependencies=[Depends(admin_auth_dependency)], response_model=BatchUnbanResponse)
async def batch_unban_ips(body: BatchUnbanRequest, deps: AppDependencies = Depends(get_deps)):
    """Unban multiple IP addresses at once."""
    if not body.ips:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "IP list is empty.", "type": "invalid_request_error", "code": "empty_list"}},
        )

    removed_count = 0
    for ip in body.ips:
        if deps.ip_ban_store.unban_ip(ip):
            removed_count += 1

    # Persist
    await deps.config_store.save_banned_ips(deps.ip_ban_store.get_banned_ips())
    deps.admin_emitter.emit({"type": "banned_ips_changed"})
    return JSONResponse(content={"ok": True, "removedCount": removed_count})
