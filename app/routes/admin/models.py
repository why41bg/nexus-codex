"""Admin default models CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.utils.route_helpers import build_openai_error_response
from app.models import AddModelRequest, ModelsAdminResponse, OkModelsResponse

router = APIRouter()


@router.get("/models", dependencies=[Depends(admin_auth_dependency)], response_model=ModelsAdminResponse)
async def list_default_models(deps: AppDependencies = Depends(get_deps)):
    """List default models."""
    return JSONResponse(content={"models": deps.config_store.get_default_models()})


@router.post("/models", dependencies=[Depends(admin_auth_dependency)], response_model=OkModelsResponse)
async def add_model(body: AddModelRequest, deps: AppDependencies = Depends(get_deps)):
    """Add a default model."""
    model_id = body.model.strip()
    if not model_id:
        return build_openai_error_response(400, "model is required")
    added = await deps.config_store.add_default_model(model_id)
    if not added:
        return build_openai_error_response(409, "Model already exists")
    return JSONResponse(content={"ok": True, "models": deps.config_store.get_default_models()})


@router.delete("/models/{model_id}", dependencies=[Depends(admin_auth_dependency)], response_model=OkModelsResponse)
async def delete_model(model_id: str, deps: AppDependencies = Depends(get_deps)):
    """Remove a default model."""
    removed = await deps.config_store.remove_default_model(model_id)
    if not removed:
        return build_openai_error_response(404, "Model not found")
    return JSONResponse(content={"ok": True, "models": deps.config_store.get_default_models()})
