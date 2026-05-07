"""Models API route - /v1/models."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.middleware.auth import api_key_auth_dependency
from app.services.config_store import get_models_for_key

router = APIRouter()


def _build_model_objects(model_ids: list[str]) -> list[dict]:
    now = int(time.time())
    return [
        {"id": mid, "object": "model", "created": now, "owned_by": "nexus-codex"}
        for mid in model_ids
    ]


@router.get("/models")
async def list_models(api_key: str = Depends(api_key_auth_dependency)):
    """List available models for the current API key."""
    models = _build_model_objects(get_models_for_key(api_key))
    return JSONResponse(content={"object": "list", "data": models})


@router.get("/models/{model_id}")
async def get_model(model_id: str, api_key: str = Depends(api_key_auth_dependency)):
    """Get a specific model."""
    models = _build_model_objects(get_models_for_key(api_key))
    model = next((m for m in models if m["id"] == model_id), None)
    if not model:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": f"The model '{model_id}' does not exist.",
                    "type": "invalid_request_error",
                    "code": "model_not_found",
                }
            },
        )
    return JSONResponse(content=model)
