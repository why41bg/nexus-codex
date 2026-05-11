"""Admin log query routes."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency

router = APIRouter()

TimeRange = Literal["1h", "6h", "24h", "7d", "30d"]


@router.get("/logs", dependencies=[Depends(admin_auth_dependency)])
async def query_logs(
    request: Request,
    keyword: str | None = None,
    level: str | None = None,
    source: str | None = None,
    event: str | None = None,
    tag: str | None = None,
    trace_id: str | None = None,
    account_id: str | None = None,
    api_key_id: str | None = None,
    client_ip: str | None = None,
    since: int | None = None,
    until: int | None = None,
    min_duration_ms: int | None = None,
    limit: int = 50,
    offset: int = 0,
    order: str = "desc",
    deps: AppDependencies = Depends(get_deps),
):
    """Query structured logs with flexible filtering."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )

    # Parse comma-separated multi-values
    levels = level.split(",") if level and "," in level else None
    events = event.split(",") if event and "," in event else None
    tags_all = tag.split(",") if tag and "," in tag else None

    # Determine source_prefix vs exact source
    source_prefix = None
    exact_source = source
    if source and source.endswith("*"):
        source_prefix = source.rstrip("*")
        exact_source = None

    # Clamp limit
    limit = min(max(1, limit), 200)

    result = await deps.log_store.query(
        keyword=keyword,
        level=None if levels else level,
        levels=levels,
        source=exact_source,
        source_prefix=source_prefix,
        event=None if events else event,
        events=events,
        tag=tag if (tag and "," not in tag) else None,
        tags_all=tags_all,
        trace_id=trace_id,
        account_id=account_id,
        api_key_id=api_key_id,
        client_ip=client_ip,
        since=since,
        until=until,
        min_duration_ms=min_duration_ms,
        limit=limit,
        offset=offset,
        order=order,
    )
    return JSONResponse(content=result)


@router.get("/logs/error-summary", dependencies=[Depends(admin_auth_dependency)])
async def logs_error_summary(
    time_range: TimeRange = Query("24h", alias="range"),
    deps: AppDependencies = Depends(get_deps),
):
    """Get error event statistics summary."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )
    result = await deps.log_store.get_error_summary(time_range)
    return JSONResponse(content=result)


@router.get("/logs/trace/{trace_id}", dependencies=[Depends(admin_auth_dependency)])
async def logs_trace(
    trace_id: str,
    deps: AppDependencies = Depends(get_deps),
):
    """Get all log entries for a specific trace ID."""
    if not deps.log_store:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": "Log store is disabled.", "type": "service_unavailable", "code": "log_store_disabled"}},
        )
    items = await deps.log_store.get_trace(trace_id)
    return JSONResponse(content={"items": items, "trace_id": trace_id})
