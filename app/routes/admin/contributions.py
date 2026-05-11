from __future__ import annotations

import re
from datetime import datetime, timezone

from app.config import settings
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddContributionInviteRequest,
    ReviewContributionRequest,
    UpdateContributionInviteRequest,
)
from app.utils.route_helpers import build_openai_error_response

router = APIRouter()
_INVITE_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


def _mask_code(code: str) -> str:
    if len(code) <= 8:
        return code[:2] + "***"
    return code[:4] + "***" + code[-4:]


def _invite_to_dict(invite) -> dict:
    return {
        "id": invite.id,
        "name": invite.name,
        "note": invite.note,
        "enabled": invite.enabled,
        "code": invite.code,
        "codeMasked": _mask_code(invite.code),
        "createdAt": invite.created_at,
        "expiresAt": invite.expires_at,
        "maxUses": invite.max_uses,
        "usedCount": invite.used_count,
        "maxActiveSessions": invite.max_active_sessions,
        "perIpLimitMax": invite.per_ip_limit_max,
        "perIpLimitWindowMs": invite.per_ip_limit_window_ms,
    }


def _record_to_dict(record) -> dict:
    return {
        "id": record.id,
        "inviteId": record.invite_id,
        "inviteName": record.invite_name,
        "applicantName": record.applicant_name,
        "applicantContact": record.applicant_contact,
        "note": record.note,
        "clientIp": record.client_ip,
        "requestedMaxConcurrency": record.requested_max_concurrency,
        "approvedMaxConcurrency": record.approved_max_concurrency,
        "status": record.status,
        "createdAt": record.created_at,
        "expiresAt": record.expires_at,
        "completedAt": record.completed_at,
        "reviewedAt": record.reviewed_at,
        "reviewedBy": record.reviewed_by,
        "reviewerNote": record.reviewer_note,
        "error": record.error,
        "accountId": record.account_id,
        "accountPlanType": record.account_plan_type,
        "duplicateAccountId": record.duplicate_account_id,
    }


def _validate_invite_payload(
    *,
    deps: AppDependencies,
    name: str,
    code: str | None,
    max_uses: int | None,
    max_active_sessions: int | None,
    per_ip_limit_max: int | None,
    per_ip_limit_window_ms: int | None,
    invite_id: str | None = None,
) -> str | None:
    if not name.strip():
        return "邀请码名称不能为空"
    if code is not None:
        if not _INVITE_CODE_RE.fullmatch(code):
            return "邀请码只能包含字母、数字、下划线和短横线，长度 6-64"
        existing = deps.config_store.find_contribution_invite_by_code(code)
        if existing and existing.id != invite_id:
            return "邀请码已存在，请更换一个"
    if max_uses is not None and max_uses <= 0:
        return "最大使用次数必须大于 0"
    if max_active_sessions is not None and max_active_sessions <= 0:
        return "最大活跃登录流程数必须大于 0"
    if per_ip_limit_max is not None and per_ip_limit_max <= 0:
        return "单 IP 发起次数限制必须大于 0"
    if per_ip_limit_window_ms is not None and per_ip_limit_window_ms < 60_000:
        return "单 IP 发起限制窗口不能小于 60000ms"
    return None


@router.get("/contribution-invites", dependencies=[Depends(admin_auth_dependency)])
async def list_contribution_invites(deps: AppDependencies = Depends(get_deps)):
    invites = [_invite_to_dict(invite) for invite in deps.config_store.get_contribution_invites()]
    return JSONResponse(content={"invites": invites})


@router.post("/contribution-invites", dependencies=[Depends(admin_auth_dependency)])
async def create_contribution_invite(
    body: AddContributionInviteRequest,
    deps: AppDependencies = Depends(get_deps),
):
    data = body.model_dump(exclude_unset=True)
    data["name"] = body.name.strip()
    data["note"] = body.note.strip()
    if body.code is not None:
        data["code"] = body.code.strip()
    error = _validate_invite_payload(
        deps=deps,
        name=data["name"],
        code=data.get("code"),
        max_uses=data.get("max_uses"),
        max_active_sessions=data.get("max_active_sessions"),
        per_ip_limit_max=data.get("per_ip_limit_max"),
        per_ip_limit_window_ms=data.get("per_ip_limit_window_ms"),
    )
    if error:
        return build_openai_error_response(400, error)
    invite = await deps.config_store.add_contribution_invite(**data)
    return JSONResponse(content=_invite_to_dict(invite))


@router.patch("/contribution-invites/{invite_id}", dependencies=[Depends(admin_auth_dependency)])
async def update_contribution_invite(
    invite_id: str,
    body: UpdateContributionInviteRequest,
    deps: AppDependencies = Depends(get_deps),
):
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()
    if "note" in updates:
        updates["note"] = str(updates["note"]).strip()
    if "code" in updates and updates["code"] is not None:
        updates["code"] = str(updates["code"]).strip()
    existing = deps.config_store.find_contribution_invite_by_id(invite_id)
    if not existing:
        return build_openai_error_response(404, "邀请码不存在")
    merged = {
        "name": updates.get("name", existing.name),
        "code": updates.get("code", existing.code),
        "max_uses": updates.get("max_uses", existing.max_uses),
        "max_active_sessions": updates.get("max_active_sessions", existing.max_active_sessions),
        "per_ip_limit_max": updates.get("per_ip_limit_max", existing.per_ip_limit_max),
        "per_ip_limit_window_ms": updates.get("per_ip_limit_window_ms", existing.per_ip_limit_window_ms),
    }
    error = _validate_invite_payload(
        deps=deps,
        name=str(merged["name"]),
        code=merged["code"],
        max_uses=merged["max_uses"],
        max_active_sessions=merged["max_active_sessions"],
        per_ip_limit_max=merged["per_ip_limit_max"],
        per_ip_limit_window_ms=merged["per_ip_limit_window_ms"],
        invite_id=invite_id,
    )
    if error:
        return build_openai_error_response(400, error)
    invite = await deps.config_store.update_contribution_invite(
        invite_id,
        **updates,
    )
    return JSONResponse(content={"ok": True})


@router.delete("/contribution-invites/{invite_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_contribution_invite(invite_id: str, deps: AppDependencies = Depends(get_deps)):
    if deps.public_contribution_service and deps.public_contribution_service.has_active_sessions_for_invite(invite_id):
        return build_openai_error_response(409, "该邀请码仍有活跃共享登录流程，暂不能删除")
    removed = await deps.config_store.remove_contribution_invite(invite_id)
    if not removed:
        return build_openai_error_response(404, "邀请码不存在")
    return JSONResponse(content={"ok": True})


@router.get("/contributions", dependencies=[Depends(admin_auth_dependency)])
async def list_contributions(deps: AppDependencies = Depends(get_deps)):
    records = sorted(
        deps.config_store.get_contribution_records(),
        key=lambda item: item.created_at,
        reverse=True,
    )
    return JSONResponse(content={"records": [_record_to_dict(record) for record in records]})


@router.post("/contributions/{record_id}/review", dependencies=[Depends(admin_auth_dependency)])
async def review_contribution(
    record_id: str,
    body: ReviewContributionRequest,
    deps: AppDependencies = Depends(get_deps),
):
    record = deps.config_store.find_contribution_record(record_id)
    if not record:
        return build_openai_error_response(404, "贡献记录不存在")
    if body.action not in {"approve", "reject"}:
        return build_openai_error_response(400, "非法审核动作")

    if body.action == "approve":
        if record.status != "pending_review":
            return build_openai_error_response(409, "当前状态不可批准")
        requested = max(1, record.requested_max_concurrency)
        approved = body.approved_max_concurrency or requested
        approved = max(1, min(approved, settings.public_contribution_max_concurrency_cap))
        duplicate = next(
            (item for item in await deps.account_store.load_accounts() if item.codex_home == record.codex_home),
            None,
        )
        if not duplicate and record.account_id:
            duplicate = next(
                (item for item in await deps.account_store.load_accounts() if item.id == record.account_id),
                None,
            )
        if duplicate:
            await deps.config_store.update_contribution_record(
                record_id,
                status="rejected",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
                reviewed_by="admin",
                reviewer_note=body.reviewer_note.strip() or "账号已存在，拒绝重复入池",
                duplicate_account_id=duplicate.id,
            )
            if deps.public_contribution_service:
                await deps.public_contribution_service.finalize_record(
                    record_id,
                    remove_directory=True,
                )
            return build_openai_error_response(409, "账号已存在于池中")

        account = await deps.account_store.add_account(
            record.codex_home,
            remark=f"shared:{record.applicant_name}",
            max_concurrency=approved,
        )
        deps.pool.add_entry(account)
        deps.admin_emitter.emit({"type": "pool_changed"})
        await deps.config_store.update_contribution_record(
            record_id,
            status="approved",
            approved_max_concurrency=approved,
            reviewed_at=datetime.now(timezone.utc).isoformat(),
            reviewed_by="admin",
            reviewer_note=body.reviewer_note.strip(),
        )
        if deps.public_contribution_service:
            await deps.public_contribution_service.finalize_record(
                record_id,
                remove_directory=False,
            )
        return JSONResponse(content={"ok": True})

    await deps.config_store.update_contribution_record(
        record_id,
        status="rejected",
        reviewed_at=datetime.now(timezone.utc).isoformat(),
        reviewed_by="admin",
        reviewer_note=body.reviewer_note.strip(),
    )
    if deps.public_contribution_service:
        await deps.public_contribution_service.finalize_record(
            record_id,
            remove_directory=True,
        )
    return JSONResponse(content={"ok": True})
