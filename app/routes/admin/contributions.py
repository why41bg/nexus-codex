from __future__ import annotations

from datetime import datetime, timezone

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
    invite = await deps.config_store.update_contribution_invite(
        invite_id,
        **updates,
    )
    if not invite:
        return build_openai_error_response(404, "邀请码不存在")
    return JSONResponse(content={"ok": True})


@router.delete("/contribution-invites/{invite_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_contribution_invite(invite_id: str, deps: AppDependencies = Depends(get_deps)):
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
            max_concurrency=1,
        )
        deps.pool.add_entry(account)
        deps.admin_emitter.emit({"type": "pool_changed"})
        await deps.config_store.update_contribution_record(
            record_id,
            status="approved",
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
