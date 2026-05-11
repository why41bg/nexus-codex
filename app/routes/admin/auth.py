"""Admin auth routes — login / logout."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import LoginRequest, OkResponse, TokenResponse

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, deps: AppDependencies = Depends(get_deps)):
    """Admin login endpoint."""
    client_ip = request.client.host if request.client else "-"

    if not deps.config_store.verify_admin_auth(body.username, body.password):
        if deps.log_collector:
            await deps.log_collector.emit(
                "login_failure", f"Admin login failed: {body.username}",
                context={"username": body.username},
                client_ip=client_ip,
            )
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Invalid credentials.", "type": "authentication_error", "code": "invalid_credentials"}},
        )
    token = deps.session_manager.create_session()
    if deps.log_collector:
        await deps.log_collector.emit(
            "login_success", f"Admin login: {body.username}",
            context={"username": body.username},
            session_id=token,
            client_ip=client_ip,
        )
    return JSONResponse(content={"token": token})


@router.post("/logout", dependencies=[Depends(admin_auth_dependency)], response_model=OkResponse)
async def logout(request: Request, deps: AppDependencies = Depends(get_deps)):
    """Admin logout endpoint."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        deps.session_manager.destroy_session(token)
    return JSONResponse(content={"ok": True})
