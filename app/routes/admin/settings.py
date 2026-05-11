"""Admin settings routes."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import aiofiles
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.config import DATA_DIR, settings
from app.middleware.auth import admin_auth_dependency
from app.models import SettingsResponse, UpdateSettingsRequest, UpdateSettingsResponse

router = APIRouter()


def _validate_node_path(raw_path: str) -> str | JSONResponse:
    """Validate configured Node.js path and return the normalized value."""
    node_path = raw_path.strip()
    if not node_path:
        return ""

    path = Path(node_path).expanduser()
    if not path.is_absolute():
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": "Node.js path must be an absolute file path or bin directory.",
                    "type": "invalid_request",
                    "code": "invalid_path",
                }
            },
        )
    if not path.exists():
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": f"Path not found: {node_path}",
                    "type": "invalid_request",
                    "code": "invalid_path",
                }
            },
        )
    if path.is_file():
        if not os.access(path, os.X_OK):
            return JSONResponse(
                status_code=400,
                content={
                    "error": {
                        "message": f"File is not executable: {node_path}",
                        "type": "invalid_request",
                        "code": "invalid_path",
                    }
                },
            )
        return str(path)

    node_binary = path / "node"
    if path.is_dir() and node_binary.is_file() and os.access(node_binary, os.X_OK):
        return str(path)

    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "message": f"Directory does not contain an executable node binary: {node_path}",
                "type": "invalid_request",
                "code": "invalid_path",
            }
        },
    )


@router.get("/settings", dependencies=[Depends(admin_auth_dependency)], response_model=SettingsResponse)
async def get_settings():
    """Get current runtime settings."""
    return JSONResponse(content={
        "codexCliPath": settings.codex_cli_path,
        "nodePath": settings.codex_node_path,
    })


@router.patch("/settings", dependencies=[Depends(admin_auth_dependency)], response_model=UpdateSettingsResponse)
async def update_settings(body: UpdateSettingsRequest):
    """Update runtime settings (persisted to data/settings.json)."""
    updated: dict[str, Any] = {}

    if body.codex_cli_path is not None:
        codex_cli_path = body.codex_cli_path.strip() or "codex"
        # Validate path if it looks like an absolute path
        if codex_cli_path.startswith("/") and not os.path.isfile(codex_cli_path):
            return JSONResponse(
                status_code=400,
                content={
                    "error": {
                        "message": f"File not found: {codex_cli_path}",
                        "type": "invalid_request",
                        "code": "invalid_path",
                    }
                },
            )
        settings.codex_cli_path = codex_cli_path
        updated["codexCliPath"] = codex_cli_path

    if body.node_path is not None:
        node_path = _validate_node_path(body.node_path)
        if isinstance(node_path, JSONResponse):
            return node_path
        settings.codex_node_path = node_path
        updated["nodePath"] = node_path

    # Persist to data/settings.json
    settings_file = DATA_DIR / "settings.json"
    await asyncio.to_thread(settings_file.parent.mkdir, parents=True, exist_ok=True)
    existing: dict = {}
    if await asyncio.to_thread(settings_file.exists):
        try:
            async with aiofiles.open(settings_file, mode="r") as f:
                existing = json.loads(await f.read())
        except (json.JSONDecodeError, OSError):
            existing = {}
    if body.codex_cli_path is not None:
        existing["codex_cli_path"] = settings.codex_cli_path
    if body.node_path is not None:
        existing["codex_node_path"] = settings.codex_node_path
        existing.pop("node_path", None)
    async with aiofiles.open(settings_file, mode="w") as f:
        await f.write(json.dumps(existing, indent=2))

    return JSONResponse(content={"updated": updated})
