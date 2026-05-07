"""Nexus Codex - OpenAI API compatible Codex account pool gateway (Python)."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.services.account_pool import pool
from app.config import settings
from app.services.account_store import load_accounts
from app.services.config_store import get_banned_ips_from_config, load_config
from app.services.health_check import start_health_check, stop_health_check
from app.services.ip_ban_store import get_client_ip, init_banned_ips, record_suspicious_hit
from app.services.session_manager import cleanup_expired_sessions
from app.utils.logger import log


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager."""
    # ─── Startup ──────────────────────────────────────────
    log.info("Starting Nexus Codex (Python)")

    # Load persistent config
    await load_config()

    # Initialize IP ban list from persisted config
    init_banned_ips(get_banned_ips_from_config())

    # Initialize account pool
    accounts = await load_accounts()
    await pool.init_async(accounts)

    # Start health check background tasks
    start_health_check()

    # Start session cleanup timer
    cleanup_task = asyncio.create_task(_session_cleanup_loop())

    log.info(
        "Nexus Codex is running",
        extra={
            "port": settings.port,
            "accounts": len(accounts),
        },
    )

    yield

    # ─── Shutdown ─────────────────────────────────────────
    log.info("Shutting down Nexus Codex")
    stop_health_check()
    cleanup_task.cancel()
    await pool.close()
    log.info("Nexus Codex shut down gracefully")


async def _session_cleanup_loop():
    """Periodically clean up expired admin sessions."""
    while True:
        await asyncio.sleep(600)  # every 10 minutes
        cleanup_expired_sessions()


# ─── Create FastAPI app ──────────────────────────────────────

app = FastAPI(
    title="Nexus Codex",
    description="OpenAI API compatible Codex account pool gateway",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# IP Ban middleware (checked before routing)
from app.middleware.ip_ban import IPBanMiddleware  # noqa: E402

app.add_middleware(IPBanMiddleware)


# ─── Global exception handler ────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled error", extra={"error": str(exc), "path": request.url.path})
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "message": "An internal server error occurred. Please try again later.",
                "type": "server_error",
                "code": "internal_error",
            }
        },
    )


# ─── Health check ────────────────────────────────────────────


@app.get("/health")
async def health_check():
    """Public health check endpoint."""
    return JSONResponse(
        content={
            "status": "ok",
            "pool": pool.get_status(),
        }
    )


# ─── Register routes ─────────────────────────────────────────

from app.routes.chat_completions import router as chat_completions_router
from app.routes.responses import router as responses_router
from app.routes.models import router as models_router
from app.routes.admin import router as admin_router

app.include_router(chat_completions_router, prefix="/v1")
app.include_router(responses_router, prefix="/v1")
app.include_router(models_router, prefix="/v1")
app.include_router(admin_router, prefix="/api/admin")


# ─── 404 handler ─────────────────────────────────────────────


@app.api_route("/{path_name:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(request: Request, path_name: str):
    """Catch-all 404 handler. Records suspicious hits for auto-banning."""
    client_ip = get_client_ip(request)
    reason = f"{request.method} /{path_name}"

    # Record the suspicious hit (may trigger auto-ban)
    was_banned = record_suspicious_hit(client_ip, reason)
    if was_banned:
        # Persist the updated ban list
        from app.services.config_store import save_banned_ips
        from app.services.ip_ban_store import get_banned_ips

        await save_banned_ips(get_banned_ips())

    return JSONResponse(
        status_code=404,
        content={
            "error": {
                "message": f"The requested endpoint '{request.method} /{path_name}' does not exist.",
                "type": "invalid_request_error",
                "code": "not_found",
            }
        },
    )
