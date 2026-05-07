"""Admin event bus for SSE push notifications."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

_subscribers: list[asyncio.Queue] = []


def emit_admin_event(event: dict[str, Any]) -> None:
    """Publish an event to all subscribed admin SSE connections."""
    for queue in _subscribers:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


def subscribe() -> asyncio.Queue:
    """Subscribe to admin events. Returns a queue to read events from."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    """Unsubscribe from admin events."""
    if queue in _subscribers:
        _subscribers.remove(queue)
