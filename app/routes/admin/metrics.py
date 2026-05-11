"""Admin metrics routes."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency

router = APIRouter()

# Valid time range values accepted by metrics / log endpoints.
TimeRange = Literal["1h", "6h", "24h", "7d", "30d"]


@router.get("/metrics/timeseries", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_time_series(
    time_range: TimeRange = Query("1h", alias="range"),
    deps: AppDependencies = Depends(get_deps),
):
    """Get metrics time series from persistent SQLite store."""
    return JSONResponse(content=await deps.metrics_collector.get_time_series(time_range))


@router.get("/metrics/breakdown", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_breakdown(deps: AppDependencies = Depends(get_deps)):
    """Get metrics breakdown from persistent SQLite store."""
    return JSONResponse(content=await deps.metrics_collector.get_breakdown())


@router.get("/metrics/percentiles", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_percentiles(
    time_range: TimeRange = Query("24h", alias="range"),
    deps: AppDependencies = Depends(get_deps),
):
    """Get latency percentiles (P50/P95/P99) from persistent store."""
    return JSONResponse(content=await deps.metrics_collector.get_percentiles(time_range))


@router.get("/metrics/summary", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_summary(
    time_range: TimeRange = Query("24h", alias="range"),
    deps: AppDependencies = Depends(get_deps),
):
    """Get KPI summary with period-over-period comparison."""
    return JSONResponse(content=await deps.metrics_collector.get_summary(time_range))


@router.get("/metrics/per-key", dependencies=[Depends(admin_auth_dependency)])
async def get_metrics_per_key(
    time_range: TimeRange = Query("24h", alias="range"),
    deps: AppDependencies = Depends(get_deps),
):
    """Get per API key usage statistics."""
    return JSONResponse(content=await deps.metrics_collector.get_per_key_stats(time_range))
