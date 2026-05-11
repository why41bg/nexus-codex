"""Background task utilities — safe fire-and-forget with error tracking.

Provides ``create_bg_task()`` as a drop-in replacement for
``asyncio.create_task()`` that:
1. Wraps the coroutine in a try/except so unhandled errors are logged.
2. Keeps a weak reference to the task for diagnostic purposes.
3. Returns the task so callers can await it if they choose.
"""

from __future__ import annotations

import asyncio
import logging
import weakref
from typing import Awaitable, Coroutine

from app.utils.logger import log

# Weak set of active background tasks (for diagnostics / health checks)
_active_tasks: weakref.WeakSet[asyncio.Task] = weakref.WeakSet()


def create_bg_task(
    coro: Coroutine | Awaitable,
    *,
    name: str = "bg-task",
    message: str = "",
) -> asyncio.Task:
    """Create a background task with built-in error handling and tracking.

    This is a safer replacement for ``asyncio.create_task()`` for
    fire-and-forget workloads.  The returned task will:

    - Log any exception at **error** level instead of silently dropping it.
    - Register itself in ``_active_tasks`` for optional diagnostic introspection.

    Args:
        coro: The coroutine or awaitable to run in the background.
        name: A human-readable name for the task (used in log messages).
        message: Optional extra context appended to log messages.

    Returns:
        The ``asyncio.Task`` that wraps *coro*.
    """

    async def _wrapped() -> None:
        try:
            await coro
        except asyncio.CancelledError:
            # Task was intentionally cancelled — not an error
            pass
        except Exception as exc:
            log.error(
                f"Background task '{name}' failed",
                extra={
                    "task_name": name,
                    "error": str(exc),
                    "message": message,
                },
            )

    task = asyncio.create_task(_wrapped(), name=name)
    _active_tasks.add(task)
    return task


def get_active_task_count() -> int:
    """Return the number of currently tracked background tasks."""
    # WeakSet auto-discards done/garbage-collected tasks
    return sum(1 for t in _active_tasks if not t.done())


def cancel_all_background_tasks() -> None:
    """Cancel all tracked background tasks (e.g. on shutdown)."""
    cancelled = 0
    for task in list(_active_tasks):
        if not task.done():
            task.cancel()
            cancelled += 1
    if cancelled:
        log.info(f"Cancelled {cancelled} background tasks")
