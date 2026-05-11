"""Admin SSE stream route."""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.dependencies import AppDependencies, get_deps
from app.middleware.auth import admin_auth_dependency

router = APIRouter()


@router.get("/stream", dependencies=[Depends(admin_auth_dependency)])
async def admin_stream(deps: AppDependencies = Depends(get_deps)):
    """SSE stream for real-time admin panel updates."""
    emitter = deps.admin_emitter

    async def event_generator() -> AsyncGenerator[str, None]:
        queue = emitter.subscribe()
        try:
            # Send initial snapshot
            yield f"data: {json.dumps({'type': 'pool_changed'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield ": heartbeat\n\n"
        finally:
            emitter.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
