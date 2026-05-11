"""IP ban middleware - blocks requests from banned IPs."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services.ip_ban_store import get_client_ip


class IPBanMiddleware(BaseHTTPMiddleware):
    """Middleware that blocks requests from banned IP addresses.

    Uses the IPBanStore instance from AppDependencies (if available)
    rather than a module-level singleton. Falls back gracefully when
    deps have not yet been attached (during early startup).
    """

    async def dispatch(self, request: Request, call_next):
        client_ip = get_client_ip(request)

        # Use the DI-managed ip_ban_store from app.state.deps
        deps = getattr(request.app.state, "deps", None)
        ip_ban_store = deps.ip_ban_store if deps else None

        if ip_ban_store and ip_ban_store.is_banned(client_ip):
            # Log the blocked request
            if deps and deps.log_collector:
                await deps.log_collector.emit(
                    "ip_blocked",
                    f"Blocked request from banned IP: {client_ip}",
                    context={"path": request.url.path, "method": request.method},
                    client_ip=client_ip,
                )
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "message": "Access denied.",
                        "type": "forbidden",
                        "code": "ip_banned",
                    }
                },
            )

        response = await call_next(request)
        return response
