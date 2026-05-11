"""Admin API key self-service claim template routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import (
    AddApiKeyTemplateRequest,
    KeyTemplateListResponse,
    KeyTemplateResponse,
    OkResponse,
    UpdateApiKeyTemplateRequest,
)
from app.routes.admin._helpers import template_to_admin_dict

router = APIRouter()


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


@router.get("/key-templates", dependencies=[Depends(admin_auth_dependency)], response_model=KeyTemplateListResponse)
async def list_api_key_templates(deps: AppDependencies = Depends(get_deps)):
    """List API key self-service claim templates."""
    templates = [template_to_admin_dict(t) for t in deps.config_store.get_api_key_templates()]
    return JSONResponse(content={"templates": templates})


@router.post("/key-templates", dependencies=[Depends(admin_auth_dependency)], response_model=KeyTemplateResponse)
async def create_api_key_template(body: AddApiKeyTemplateRequest, deps: AppDependencies = Depends(get_deps)):
    """Create an API key self-service claim template."""
    data = body.model_dump()
    data["name"] = body.name.strip()
    data["description"] = body.description.strip()
    data["models"] = [m.strip() for m in body.models if m.strip()]
    data["claim_code"] = body.claim_code.strip()
    error = _validate_template_payload(data)
    if error:
        return JSONResponse(status_code=400, content={"error": {"message": error}})
    template = await deps.config_store.add_api_key_template(**data)
    return JSONResponse(content={"template": template_to_admin_dict(template)})


@router.patch("/key-templates/{template_id}", dependencies=[Depends(admin_auth_dependency)], response_model=KeyTemplateResponse)
async def update_api_key_template_route(template_id: str, body: UpdateApiKeyTemplateRequest, deps: AppDependencies = Depends(get_deps)):
    """Update an API key self-service claim template."""
    existing = next((t for t in deps.config_store.get_api_key_templates() if t.id == template_id), None)
    if not existing:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})

    updates = body.model_dump(exclude_unset=True)
    merged = existing.model_dump()
    merged.update(updates)
    merged["name"] = str(merged.get("name") or "").strip()
    merged["description"] = str(merged.get("description") or "").strip()
    merged["models"] = [str(m).strip() for m in merged.get("models", []) if str(m).strip()]
    merged["claim_code"] = str(merged.get("claim_code") or "").strip()
    error = _validate_template_payload(merged)
    if error:
        return JSONResponse(status_code=400, content={"error": {"message": error}})

    template = await deps.config_store.update_api_key_template(
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
    return JSONResponse(content={"template": template_to_admin_dict(template)})


@router.delete("/key-templates/{template_id}", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def delete_api_key_template(template_id: str, deps: AppDependencies = Depends(get_deps)):
    """Delete an API key self-service claim template."""
    removed = await deps.config_store.remove_api_key_template(template_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})
    return JSONResponse(content={"ok": True})


@router.post("/key-templates/{template_id}/reset-usage", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def reset_template_claim_usage(template_id: str, deps: AppDependencies = Depends(get_deps)):
    """Reset the claim code used count for a template."""
    ok = await deps.config_store.reset_claim_code_usage(template_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": {"message": "Template not found"}})
    return JSONResponse(content={"ok": True})
