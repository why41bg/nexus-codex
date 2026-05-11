"""Admin default models CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import AddModelRequest

router = APIRouter()


@router.get("/models", dependencies=[Depends(admin_auth_dependency)])
async def list_default_models(deps: AppDependencies = Depends(get_deps)):
    """List default models."""
    return JSONResponse(content={"models": deps.config_store.get_default_models()})


@router.post("/models", dependencies=[Depends(admin_auth_dependency)])
async def add_model(body: AddModelRequest, deps: AppDependencies = Depends(get_deps)):
    """Add a default model."""
    model_id = body.model.strip()
    if not model_id:
        return JSONResponse(status_code=400, content={"error": {"message": "model is required"}})
    added = await deps.config_store.add_default_model(model_id)
    if not added:
        return JSONResponse(status_code=409, content={"error": {"message": "Model already exists"}})
    return JSONResponse(content={"ok": True, "models": deps.config_store.get_default_models()})


@router.delete("/models/{model_id}", dependencies=[Depends(admin_auth_dependency)])
async def delete_model(model_id: str, deps: AppDependencies = Depends(get_deps)):
    """Remove a default model."""
    removed = await deps.config_store.remove_default_model(model_id)
    if not removed:
        return JSONResponse(status_code=404, content={"error": {"message": "Model not found"}})
    return JSONResponse(content={"ok": True, "models": deps.config_store.get_default_models()})
