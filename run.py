"""Entry point for running the Nexus Codex server.

Usage:
    uv run python run.py
    # or
    uv run uvicorn app.main:app --host 0.0.0.0 --port 3000
"""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level,
    )
