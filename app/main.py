"""Nexus Codex - OpenAI API compatible Codex account pool gateway (Python)."""

from __future__ import annotations

import asyncio
import time
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from app.services.account_pool import AccountPool
from app.config import settings
from app.dependencies import AppDependencies
from app.exceptions import NexusError
from app.services.account_store import load_accounts
from app.services.config_store import get_banned_ips_from_config, load_config
from app.services.health_check import start_health_check, stop_health_check
from app.services.ip_ban_store import get_client_ip, init_banned_ips, record_suspicious_hit
from app.services.metrics_collector import MetricsCollector
from app.services.metrics_store import MetricsStore
from app.services.session_manager import cleanup_expired_sessions
from app.utils.logger import log
from app.adapters.anthropic_adapter import AnthropicAdapter


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
    pool = AccountPool()
    await pool.init_async(accounts)

    # Initialize persistent metrics store
    metrics_store = MetricsStore()
    metrics_collector = MetricsCollector(metrics_store)

    # Create dependency injection container
    app.state.deps = AppDependencies(
        pool=pool,
        metrics_collector=metrics_collector,
        metrics_store=metrics_store,
    )

    # Start health check background tasks
    start_health_check(pool)

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
    if hasattr(app.state, 'deps'):
        app.state.deps.metrics_store.close()
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

# Access log middleware (outermost — captures timing for every request).
# Uvicorn's built-in access log is suppressed (set to WARNING) so we
# have a single, consistent access log line with response time.
@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    start = time.time()
    response: Response = await call_next(request)
    elapsed_ms = int((time.time() - start) * 1000)

    status = response.status_code
    client = request.client.host if request.client else "-"
    path = request.url.path
    if request.url.query:
        path = f"{path}?{request.url.query}"

    if status >= 500:
        log.error(
            f"{request.method} {path} → {status}",
            extra={"client": client, "elapsed_ms": elapsed_ms},
        )
    elif status >= 400:
        log.warn(
            f"{request.method} {path} → {status}",
            extra={"client": client, "elapsed_ms": elapsed_ms},
        )
    else:
        log.info(
            f"{request.method} {path} → {status}",
            extra={"client": client, "elapsed_ms": elapsed_ms},
        )

    return response


# ─── Global exception handlers ───────────────────────────────


def _is_anthropic_request(request: Request) -> bool:
    """Check if the request targets the Anthropic Messages API protocol.

    Relies on ``request.state.protocol`` set by the messages route handler,
    falling back to path matching for errors raised before the route is resolved.
    """
    protocol = getattr(request.state, "protocol", None)
    if protocol == "anthropic":
        return True
    # Fallback: path-based detection for errors raised before route dispatch.
    return request.url.path.rstrip("/") == "/v1/messages"


@app.exception_handler(NexusError)
async def nexus_exception_handler(request: Request, exc: NexusError):
    """Handle NexusError with protocol-appropriate error response."""
    log.warn(
        "Application error",
        extra={
            "error": exc.message,
            "code": exc.code,
            "status": exc.status_code,
            "path": request.url.path,
        },
    )

    if _is_anthropic_request(request):
        return JSONResponse(
            status_code=exc.status_code,
            content=AnthropicAdapter.format_error(exc.message),
        )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "message": exc.message,
                "type": "server_error",
                "code": exc.code,
            }
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error(
        "Unhandled error",
        extra={
            "error": str(exc),
            "path": request.url.path,
            "traceback": traceback.format_exc(),
        },
    )

    if _is_anthropic_request(request):
        return JSONResponse(
            status_code=500,
            content=AnthropicAdapter.format_error(
                "An internal server error occurred. Please try again later.",
                "server_error",
            ),
        )

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
async def health_check(request: Request):
    """Public health check endpoint."""
    deps: AppDependencies = request.app.state.deps
    return JSONResponse(
        content={
            "status": "ok",
            "pool": deps.pool.get_status(),
        }
    )


# ─── Register routes ─────────────────────────────────────────

from app.routes.chat_completions import router as chat_completions_router
from app.routes.responses import router as responses_router
from app.routes.messages import router as messages_router
from app.routes.models import router as models_router
from app.routes.admin import router as admin_router

app.include_router(chat_completions_router, prefix="/v1")
app.include_router(responses_router, prefix="/v1")
app.include_router(messages_router, prefix="/v1")
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
