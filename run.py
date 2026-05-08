"""Entry point for running the Nexus Codex server.

Usage:
    uv run python run.py
"""

import uvicorn

from app.config import settings
from app.utils.logger import get_log_config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_config=get_log_config(),
    )
