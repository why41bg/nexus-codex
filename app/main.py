"""Nexus Codex - OpenAI API compatible Codex account pool gateway (Python)."""

from __future__ import annotations

import asyncio
import json
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from app.adapters.anthropic_adapter import AnthropicAdapter
from app.config import settings
from app.dependencies import AppDependencies
from app.exceptions import NexusError
from app.middleware.ip_ban import IPBanMiddleware
from app.routes.admin import router as admin_router
from app.routes.chat_completions import router as chat_completions_router
from app.routes.messages import router as messages_router
from app.routes.models import router as models_router
from app.routes.public import router as public_router
from app.routes.responses import router as responses_router
from app.services.account_pool import AccountPool
from app.services.account_store import flush_usage_counters, load_accounts
from app.services.config_store import get_banned_ips_from_config, load_config, save_banned_ips
from app.services.health_check import start_health_check, stop_health_check
from app.services.ip_ban_store import IPBanStore, get_client_ip
from app.services.log_collector import LogCollector
from app.services.log_store import LogStore
from app.services.metrics_collector import MetricsCollector
from app.services.metrics_store import MetricsStore
from app.services.session_manager import cleanup_expired_sessions
from app.utils.logger import log


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager."""
    # ─── Startup ──────────────────────────────────────────
    log.info("Starting Nexus Codex (Python)")

    # Load persistent config
    await load_config()

    # Load persisted runtime settings (data/settings.json)
    _load_persisted_settings()

    # Initialize IP ban store and load from persisted config
    ip_ban_store = IPBanStore()
    ip_ban_store.init_banned_ips(get_banned_ips_from_config())

    # Initialize account pool
    accounts = await load_accounts()
    pool = AccountPool()
    await pool.init_async(accounts)

    # Initialize persistent metrics store
    metrics_store = MetricsStore()
    metrics_collector = MetricsCollector(metrics_store)

    # Initialize log store and collector
    log_store = LogStore(retention_days=settings.log_store_retention_days) if settings.log_store_enabled else None
    log_collector = LogCollector(log_store, min_level=settings.log_store_level) if log_store else None

    # Create dependency injection container
    app.state.deps = AppDependencies(
        pool=pool,
        metrics_collector=metrics_collector,
        metrics_store=metrics_store,
        log_collector=log_collector,
        log_store=log_store,
        ip_ban_store=ip_ban_store,
    )

    # Start health check background tasks
    start_health_check(pool, log_collector=log_collector)

    # Start session cleanup timer
    cleanup_task = asyncio.create_task(_session_cleanup_loop())

    # Start log cleanup timer
    log_cleanup_task = asyncio.create_task(_log_cleanup_loop(log_store))

    # Record startup event
    if log_collector:
        await log_collector.emit(
            "service_started", "Nexus Codex started",
            context={"port": settings.port, "accounts": len(accounts)},
        )

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
    if log_collector:
        await log_collector.emit("service_stopped", "Nexus Codex shutting down")
    stop_health_check()
    cleanup_task.cancel()
    log_cleanup_task.cancel()
    # Flush buffered usage counters before closing
    await flush_usage_counters()
    await pool.close()
    if hasattr(app.state, 'deps'):
        app.state.deps.metrics_store.close()
        if app.state.deps.log_store:
            app.state.deps.log_store.close()
    log.info("Nexus Codex shut down gracefully")


def _load_persisted_settings():
    """Load runtime settings from data/settings.json if it exists."""
    settings_file = Path("data/settings.json")
    if not settings_file.exists():
        return
    try:
        data = json.loads(settings_file.read_text())
        if "codex_cli_path" in data and data["codex_cli_path"]:
            settings.codex_cli_path = data["codex_cli_path"]
            log.info("Loaded persisted setting", extra={"codex_cli_path": data["codex_cli_path"]})
    except (json.JSONDecodeError, OSError) as e:
        log.warn("Failed to load persisted settings", extra={"error": str(e)})


async def _session_cleanup_loop():
    """Periodically clean up expired admin sessions."""
    while True:
        await asyncio.sleep(600)  # every 10 minutes
        cleanup_expired_sessions()


async def _log_cleanup_loop(log_store: LogStore | None):
    """Periodically clean up expired logs."""
    if not log_store:
        return
    while True:
        await asyncio.sleep(3600)  # every hour
        try:
            deleted = log_store.cleanup()
            if deleted > 0:
                log.info("Log cleanup completed", extra={"deleted": deleted})
        except Exception as e:
            log.error("Log cleanup failed", extra={"error": str(e)})


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

    # Build common extra dict for stdout logging
    log_extra: dict = {"client": client, "elapsed_ms": elapsed_ms}
    _model = getattr(request.state, "model", None)
    _api_key = getattr(request.state, "api_key_masked", None)
    _account = getattr(request.state, "account_id", None)
    _req_id = getattr(request.state, "request_id", None)
    if _model:
        log_extra["model"] = _model
    if _api_key:
        log_extra["api_key"] = _api_key
    if _account:
        log_extra["account_id"] = _account
    if _req_id:
        log_extra["request_id"] = _req_id

    if status >= 500:
        log.error(f"{request.method} {path} → {status}", extra=log_extra)
    elif status >= 400:
        log.warn(f"{request.method} {path} → {status}", extra=log_extra)
    else:
        log.info(f"{request.method} {path} → {status}", extra=log_extra)

    # Structured log collection (reuse extracted context from above)
    deps: AppDependencies | None = getattr(request.app.state, "deps", None)
    if deps and deps.log_collector:
        # Only persist error/warn requests (>= 400); 2xx/3xx covered by metrics
        if status >= 400:
            await deps.log_collector.emit(
                "request_complete",
                f"{request.method} {path} → {status}",
                context={"method": request.method, "path": path, "status": status, "model": _model, "account_id": _account},
                trace_id=_req_id,
                api_key_id=_api_key,
                account_id=_account,
                client_ip=client,
                duration_ms=elapsed_ms,
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
    tb_str = traceback.format_exc()
    log.error(
        "Unhandled error",
        extra={
            "error": str(exc),
            "path": request.url.path,
            "traceback": tb_str,
        },
    )

    # Structured log collection
    deps: AppDependencies | None = getattr(request.app.state, "deps", None)
    if deps and deps.log_collector:
        await deps.log_collector.emit(
            "unhandled_exception",
            f"Unhandled exception: {exc}",
            context={"error": str(exc), "traceback": tb_str, "path": request.url.path},
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

app.include_router(chat_completions_router, prefix="/v1")
app.include_router(responses_router, prefix="/v1")
app.include_router(messages_router, prefix="/v1")
app.include_router(models_router, prefix="/v1")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(public_router, prefix="/api/public")


# ─── 404 handler ─────────────────────────────────────────────


@app.api_route("/{path_name:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def catch_all(request: Request, path_name: str):
    """Catch-all 404 handler. Records suspicious hits for auto-banning."""
    client_ip = get_client_ip(request)
    reason = f"{request.method} /{path_name}"

    # Record the suspicious hit (may trigger auto-ban)
    deps: AppDependencies | None = getattr(request.app.state, "deps", None)
    was_banned = deps.ip_ban_store.record_suspicious_hit(client_ip, reason) if deps else False
    if was_banned:
        # Persist the updated ban list
        await save_banned_ips(deps.ip_ban_store.get_banned_ips())

        # Log the auto-ban event
        if deps.log_collector:
            await deps.log_collector.emit(
                "ip_auto_banned", f"IP auto-banned: {client_ip}",
                context={"reason": reason},
                client_ip=client_ip,
            )

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
