"""Dependency injection container for Nexus Codex.

Provides a single AppDependencies container that holds all shared
service instances, eliminating module-level global singletons.
Routes access services via FastAPI's Depends(get_deps) instead
of importing global module variables.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Request

from app.services.account_pool import AccountPool
from app.services.account_store import AccountStore
from app.services.admin_emitter import AdminEmitter
from app.services.config_store import ConfigStore
from app.services.ip_ban_store import IPBanStore
from app.services.log_collector import LogCollector
from app.services.log_store import LogStore
from app.services.metrics_collector import MetricsCollector
from app.services.metrics_store import MetricsStore
from app.services.session_manager import SessionManager
from app.middleware.rate_limit import RateLimiter

# TYPE_CHECKING import to avoid circular dependency
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.account_bootstrap import BootstrapManager
    from app.services.health_check import HealthChecker
    from app.services.quota_probe import QuotaProbeService


@dataclass
class AppDependencies:
    """Container for all shared application dependencies.

    Stored in app.state.deps during startup and injected into
    route handlers via get_deps().
    """

    pool: AccountPool
    metrics_collector: MetricsCollector
    metrics_store: MetricsStore
    config_store: ConfigStore = field(default_factory=ConfigStore)
    account_store: AccountStore = field(default_factory=AccountStore)
    log_collector: LogCollector | None = None
    log_store: LogStore | None = None
    ip_ban_store: IPBanStore = field(default_factory=IPBanStore)
    rate_limiter: RateLimiter = field(default_factory=RateLimiter)
    admin_emitter: AdminEmitter = field(default_factory=AdminEmitter)
    session_manager: SessionManager = field(default_factory=SessionManager)
    health_checker: "HealthChecker | None" = None
    bootstrap_manager: "BootstrapManager | None" = None
    quota_probe_service: "QuotaProbeService | None" = None


def get_deps(request: Request) -> AppDependencies:
    """FastAPI dependency that provides the AppDependencies container.

    Usage in routes:
        @router.get("/something")
        async def handler(deps: AppDependencies = Depends(get_deps)):
            entry = await deps.pool.acquire_async()
    """
    return request.app.state.deps
