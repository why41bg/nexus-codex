"""Dependency injection container for Nexus Codex.

Provides a single AppDependencies container that holds all shared
service instances, eliminating module-level global singletons.
Routes access services via FastAPI's Depends(get_deps) instead
of importing global module variables.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.services.account_pool import AccountPool
from app.services.metrics_collector import MetricsCollector
from app.services.metrics_store import MetricsStore


@dataclass
class AppDependencies:
    """Container for all shared application dependencies.

    Stored in app.state.deps during startup and injected into
    route handlers via get_deps().
    """

    pool: AccountPool
    metrics_collector: MetricsCollector
    metrics_store: MetricsStore | None = None


def get_deps(request: Request) -> AppDependencies:
    """FastAPI dependency that provides the AppDependencies container.

    Usage in routes:
        @router.get("/something")
        async def handler(deps: AppDependencies = Depends(get_deps)):
            entry = await deps.pool.acquire_async()
    """
    return request.app.state.deps
