"""Public portal API routes - /api/public/*."""

from __future__ import annotations

import hmac
import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.models import ClaimApiKeyRequest
from app.services.account_store import load_accounts
from app.services.config_store import (
    add_api_key,
    find_api_key_template,
    get_api_key_templates,
    increment_claim_code_usage,
    record_claim_attempt,
)
from app.services.ip_ban_store import get_client_ip

router = APIRouter()


@router.get("/system-status")
async def public_system_status(deps: AppDependencies = Depends(get_deps)):
    """Public system availability status for portal users."""
    accounts = await load_accounts()
    status = deps.pool.get_status()
    total = len(accounts)
    healthy = sum(1 for e in status if e["healthy"])
    total_slots = sum(e["max_concurrency"] for e in status)
    active_slots = sum(e["active_count"] for e in status)
    available_slots = total_slots - active_slots

    # Determine overall health: green / yellow / red
    if total == 0 or healthy == 0:
        level = "red"
    elif healthy < total * 0.5 or available_slots == 0:
        level = "yellow"
    else:
        level = "green"

    return JSONResponse(content={
        "level": level,
        "totalAccounts": total,
        "healthyAccounts": healthy,
        "totalSlots": total_slots,
        "availableSlots": available_slots,
    })


def _template_to_public_dict(template) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "models": template.models,
        "requireClaimCode": template.require_claim_code,
        "rateLimitMax": template.rate_limit_max,
        "rateLimitWindowMs": template.rate_limit_window_ms,
        "monthlyQuota": template.monthly_quota,
        "claimIpLimitMax": template.claim_ip_limit_max,
        "claimIpLimitWindowMs": template.claim_ip_limit_window_ms,
    }


@router.get("/key-templates")
async def list_public_key_templates():
    """List enabled API key claim templates available to portal users."""
    templates = [
        _template_to_public_dict(template)
        for template in get_api_key_templates()
        if template.enabled
    ]
    return JSONResponse(content={"templates": templates})


@router.post("/keys/claim")
async def claim_api_key(body: ClaimApiKeyRequest, request: Request):
    """Claim a new API key from an enabled self-service template."""
    template = find_api_key_template(body.template_id)
    if not template or not template.enabled:
        return JSONResponse(status_code=404, content={"error": {"message": "申领模板不存在或未启用"}})

    client_ip = get_client_ip(request)
    allowed, retry_after_ms = await record_claim_attempt(
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

    applicant_name = body.applicant_name.strip()
    applicant_contact = body.applicant_contact.strip()
    note = body.note.strip()
    if not applicant_name:
        return JSONResponse(status_code=400, content={"error": {"message": "申请人名称不能为空"}})
    if not applicant_contact:
        return JSONResponse(status_code=400, content={"error": {"message": "联系方式不能为空"}})
    if not template.models:
        return JSONResponse(status_code=409, content={"error": {"message": "申领模板未配置可用模型"}})
    if template.require_claim_code and not hmac.compare_digest(
        body.claim_code.strip(),
        template.claim_code,
    ):
        return JSONResponse(status_code=403, content={"error": {"message": "申领码错误"}})

    key = f"sk-{secrets.token_hex(16)}"
    entry = await add_api_key(
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
