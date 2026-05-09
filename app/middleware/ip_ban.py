"""IP ban middleware - blocks requests from banned IPs."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services.ip_ban_store import get_client_ip, is_banned


class IPBanMiddleware(BaseHTTPMiddleware):
    """Middleware that blocks requests from banned IP addresses."""

    async def dispatch(self, request: Request, call_next):
        client_ip = get_client_ip(request)

        if is_banned(client_ip):
            # Log the blocked request
            deps = getattr(request.app.state, "deps", None)
            if deps and deps.log_collector:
                deps.log_collector.emit(
                    level="warn",
                    source="middleware.ip_ban",
                    event="ip_blocked",
                    message=f"Blocked request from banned IP: {client_ip}",
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
