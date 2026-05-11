"""Admin dashboard route."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency
from app.models import DashboardResponse

router = APIRouter()


@router.get("/dashboard", dependencies=[Depends(admin_auth_dependency)], response_model=DashboardResponse)
async def get_dashboard(deps: AppDependencies = Depends(get_deps)):
    """Dashboard summary data."""
    accounts = await deps.account_store.load_accounts()
    status = deps.pool.get_status()

    total = len(accounts)
    total_slots = sum(e["max_concurrency"] for e in status)
    active_slots = sum(e["active_count"] for e in status)
    available_slots = total_slots - active_slots
    unhealthy = sum(1 for e in status if not e["healthy"])
    disabled = sum(1 for a in accounts if not a.enabled)
    total_usage = sum(a.usage_count for a in accounts)

    metrics_1h = await deps.metrics_collector.get_time_series("1h")
    buckets = metrics_1h.get("buckets", [])
    recent_requests = sum(b.get("requestCount", 0) for b in buckets)
    recent_errors = sum(b.get("errorCount", 0) for b in buckets)
    latencies = [b.get("avgLatencyMs", 0) for b in buckets if b.get("avgLatencyMs")]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else None

    return JSONResponse(content={
        "total": total,
        "totalSlots": total_slots,
        "activeSlots": active_slots,
        "availableSlots": available_slots,
        "unhealthy": unhealthy,
        "disabled": disabled,
        "totalUsage": total_usage,
        "recentRequests1h": recent_requests,
        "recentErrors1h": recent_errors,
        "avgLatency1h": avg_latency,
    })
