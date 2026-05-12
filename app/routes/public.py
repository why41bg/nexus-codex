"""Public portal API routes - /api/public/*."""

from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.config import settings
from app.models import ClaimApiKeyRequest, PublicContributionStartRequest
from app.services.ip_ban_store import get_client_ip
from app.utils.route_helpers import build_openai_error_response

router = APIRouter()


@router.get("/pool-quota")
async def public_pool_quota(deps: AppDependencies = Depends(get_deps)):
    """Public read-only pool quota snapshot."""
    if not deps.pool_quota_snapshot_service:
        return JSONResponse(content={
            "status": "unavailable",
            "snapshotAt": None,
            "staleAt": None,
            "window5hRemainingPercent": None,
            "window1wRemainingPercent": None,
            "healthyAccountCount": 0,
            "eligibleAccountCount": 0,
            "sampledAccountCount": 0,
            "eligibleWeight": 0,
            "sampledWeight": 0,
        })
    return JSONResponse(content=deps.pool_quota_snapshot_service.get_snapshot())


def _template_to_public_dict(template) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "models": template.models,
        "requireClaimCode": template.require_claim_code,
        "claimCodeMaxUsage": template.claim_code_max_usage,
        "claimCodeRemaining": (
            max(0, template.claim_code_max_usage - template.claim_code_used_count)
            if template.claim_code_max_usage is not None
            else None
        ),
        "rateLimitMax": template.rate_limit_max,
        "rateLimitWindowMs": template.rate_limit_window_ms,
        "monthlyQuota": template.monthly_quota,
        "claimIpLimitMax": template.claim_ip_limit_max,
        "claimIpLimitWindowMs": template.claim_ip_limit_window_ms,
    }


@router.get("/key-templates")
async def list_public_key_templates(deps: AppDependencies = Depends(get_deps)):
    """List enabled API key claim templates available to portal users."""
    templates = [
        _template_to_public_dict(template)
        for template in deps.config_store.get_api_key_templates()
        if template.enabled
    ]
    return JSONResponse(content={"templates": templates})


@router.post("/keys/claim")
async def claim_api_key(body: ClaimApiKeyRequest, request: Request, deps: AppDependencies = Depends(get_deps)):
    """Claim a new API key from an enabled self-service template."""
    template = deps.config_store.find_api_key_template(body.template_id)
    if not template or not template.enabled:
        return build_openai_error_response(404, "申领模板不存在或未启用")

    # Validate input fields first — don't consume rate limit quota for bad requests
    applicant_name = body.applicant_name.strip()
    applicant_contact = body.applicant_contact.strip()
    note = body.note.strip()
    if not applicant_name:
        return build_openai_error_response(400, "申请人名称不能为空")
    if not applicant_contact:
        return build_openai_error_response(400, "联系方式不能为空")
    if not template.models:
        return build_openai_error_response(409, "申领模板未配置可用模型")
    if template.require_claim_code and not hmac.compare_digest(
        body.claim_code.strip(),
        template.claim_code,
    ):
        return build_openai_error_response(403, "申领码错误")

    if (
        template.require_claim_code
        and template.claim_code_max_usage is not None
        and template.claim_code_used_count >= template.claim_code_max_usage
    ):
        return build_openai_error_response(403, "申领码已达到使用次数上限")

    # IP rate limit — last check before actually creating the key
    client_ip = get_client_ip(request)
    allowed, retry_after_ms = await deps.config_store.record_claim_attempt(
        client_ip,
        template.id,
        limit_max=template.claim_ip_limit_max,
        window_ms=template.claim_ip_limit_window_ms,
    )
    if not allowed:
        retry_after_sec = max(1, (retry_after_ms + 999) // 1000)
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after_sec)},
            content={
                "error": {
                    "message": f"申领过于频繁，请 {retry_after_sec} 秒后再试",
                    "retryAfterMs": retry_after_ms,
                }
            },
        )

    key = f"sk-{secrets.token_hex(16)}"
    entry = await deps.config_store.add_api_key(
        key=key,
        name=applicant_name,
        models=list(template.models),
        source="self_service",
        template_id=template.id,
        template_name=template.name,
        applicant_name=applicant_name,
        applicant_contact=applicant_contact,
        applicant_note=note,
        rate_limit_max=template.rate_limit_max,
        rate_limit_window_ms=template.rate_limit_window_ms,
        monthly_quota=template.monthly_quota,
    )

    if template.require_claim_code and template.claim_code_max_usage is not None:
        await deps.config_store.increment_claim_code_usage(template.id)
    return JSONResponse(
        content={
            "key": entry.key,
            "keyPrefix": entry.key[:12],
            "models": entry.models,
            "rateLimitMax": entry.rate_limit_max,
            "rateLimitWindowMs": entry.rate_limit_window_ms,
            "monthlyQuota": entry.monthly_quota,
        }
    )


@router.post("/contributions/start")
async def start_public_contribution(
    body: PublicContributionStartRequest,
    request: Request,
    deps: AppDependencies = Depends(get_deps),
):
    invite = deps.config_store.find_contribution_invite_by_code(body.invite_code.strip())
    if not invite or not invite.enabled:
        return build_openai_error_response(404, "邀请码不存在或已停用")

    if invite.expires_at:
        expires_at = datetime.fromisoformat(invite.expires_at)
        if datetime.now(timezone.utc) >= expires_at:
            return build_openai_error_response(403, "邀请码已过期")
    if invite.max_uses is not None and invite.used_count >= invite.max_uses:
        return build_openai_error_response(403, "邀请码已达到使用上限")

    applicant_name = body.applicant_name.strip()
    applicant_contact = body.applicant_contact.strip()
    note = body.note.strip()
    requested_max_concurrency = body.requested_max_concurrency or 1
    if not applicant_name:
        return build_openai_error_response(400, "申请人名称不能为空")
    if not applicant_contact:
        return build_openai_error_response(400, "联系方式不能为空")
    if requested_max_concurrency < 1:
        return build_openai_error_response(400, "建议并发名额必须大于等于 1")
    if requested_max_concurrency > settings.public_contribution_max_concurrency_cap:
        return build_openai_error_response(
            400,
            f"建议并发名额不能超过系统上限 {settings.public_contribution_max_concurrency_cap}",
        )

    client_ip = get_client_ip(request)
    allowed, retry_after_ms = await deps.config_store.record_contribution_attempt(
        client_ip,
        invite.id,
        limit_max=invite.per_ip_limit_max,
        window_ms=invite.per_ip_limit_window_ms,
    )
    if not allowed:
        retry_after_sec = max(1, (retry_after_ms + 999) // 1000)
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry_after_sec)},
            content={"error": {"message": f"发起过于频繁，请 {retry_after_sec} 秒后再试"}},
        )

    if not deps.public_contribution_service:
        return build_openai_error_response(503, "共享登录服务不可用")

    try:
        payload = await deps.public_contribution_service.start_contribution(
            invite=invite,
            applicant_name=applicant_name,
            applicant_contact=applicant_contact,
            note=note,
            client_ip=client_ip,
            requested_max_concurrency=requested_max_concurrency,
        )
    except ValueError as exc:
        return build_openai_error_response(429, str(exc))
    return JSONResponse(content=payload)


@router.get("/contributions/{record_id}")
async def get_public_contribution_status(record_id: str, deps: AppDependencies = Depends(get_deps)):
    if not deps.public_contribution_service:
        return build_openai_error_response(503, "共享登录服务不可用")
    payload = deps.public_contribution_service.get_public_record(record_id)
    if not payload:
        return build_openai_error_response(404, "贡献记录不存在")
    return JSONResponse(content=payload)


@router.post("/contributions/{record_id}/cancel")
async def cancel_public_contribution(record_id: str, deps: AppDependencies = Depends(get_deps)):
    if not deps.public_contribution_service:
        return build_openai_error_response(503, "共享登录服务不可用")
    ok = await deps.public_contribution_service.cancel_public_record(record_id)
    if not ok:
        return build_openai_error_response(404, "活跃贡献记录不存在")
    return JSONResponse(content={"ok": True})
