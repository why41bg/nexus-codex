"""Admin settings routes."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiofiles
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.middleware.auth import admin_auth_dependency
from app.models import SettingsResponse, UpdateSettingsRequest, UpdateSettingsResponse

router = APIRouter()


@router.get("/settings", dependencies=[Depends(admin_auth_dependency)], response_model=SettingsResponse)
async def get_settings():
    """Get current runtime settings."""
    from app.config import settings

    return JSONResponse(content={
        "codexCliPath": settings.codex_cli_path,
    })


@router.patch("/settings", dependencies=[Depends(admin_auth_dependency)], response_model=UpdateSettingsResponse)
async def update_settings(body: UpdateSettingsRequest):
    """Update runtime settings (persisted to data/settings.json)."""
    import os
    from pathlib import Path

    from app.config import settings

    updated: dict[str, Any] = {}

    if body.codex_cli_path is not None:
        # Validate path if it looks like an absolute path
        if body.codex_cli_path.startswith("/") and not os.path.isfile(body.codex_cli_path):
            return JSONResponse(
                status_code=400,
                content={
                    "error": {
                        "message": f"File not found: {body.codex_cli_path}",
                        "type": "invalid_request",
                        "code": "invalid_path",
                    }
                },
            )
        settings.codex_cli_path = body.codex_cli_path
        updated["codexCliPath"] = body.codex_cli_path

    # Persist to data/settings.json
    settings_file = Path("data/settings.json")
    await asyncio.to_thread(settings_file.parent.mkdir, parents=True, exist_ok=True)
    existing: dict = {}
    if await asyncio.to_thread(settings_file.exists):
        try:
            async with aiofiles.open(settings_file, mode="r") as f:
                existing = json.loads(await f.read())
        except (json.JSONDecodeError, OSError):
            existing = {}
    if body.codex_cli_path is not None:
        existing["codex_cli_path"] = body.codex_cli_path
    async with aiofiles.open(settings_file, mode="w") as f:
        await f.write(json.dumps(existing, indent=2))

    return JSONResponse(content={"updated": updated})
