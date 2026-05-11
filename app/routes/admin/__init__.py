"""Admin API routes - /api/admin/*.

Split into sub-modules for maintainability:
- auth: login/logout
- dashboard: summary data
- stream: SSE real-time updates
- accounts: account CRUD, bootstrap, quota, import/export/backup
- keys: API key CRUD + batch
- key_templates: API key self-service claim templates
- models: default models CRUD
- metrics: metrics endpoints
- ip_ban: IP ban management
- logs: structured log queries
- settings: runtime settings
"""

from __future__ import annotations

from fastapi import APIRouter

from app.routes.admin.auth import router as auth_router
from app.routes.admin.dashboard import router as dashboard_router
from app.routes.admin.contributions import router as contributions_router
from app.routes.admin.stream import router as stream_router
from app.routes.admin.accounts import router as accounts_router
from app.routes.admin.keys import router as keys_router
from app.routes.admin.key_templates import router as key_templates_router
from app.routes.admin.models import router as models_router
from app.routes.admin.metrics import router as metrics_router
from app.routes.admin.ip_ban import router as ip_ban_router
from app.routes.admin.logs import router as logs_router
from app.routes.admin.settings import router as settings_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(dashboard_router)
router.include_router(contributions_router)
router.include_router(stream_router)
router.include_router(accounts_router)
router.include_router(keys_router)
router.include_router(key_templates_router)
router.include_router(models_router)
router.include_router(metrics_router)
router.include_router(ip_ban_router)
router.include_router(logs_router)
router.include_router(settings_router)
