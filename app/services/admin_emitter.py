"""Admin event bus for SSE push notifications."""

from __future__ import annotations

import asyncio
from typing import Any


class AdminEmitter:
    """Encapsulated admin event bus — no module-level globals.

    All subscriber state is instance-level, making it testable
    and safe in multi-instance scenarios.
    """

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def emit(self, event: dict[str, Any]) -> None:
        """Publish an event to all subscribed admin SSE connections."""
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue:
        """Subscribe to admin events. Returns a queue to read events from."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Unsubscribe from admin events."""
        if queue in self._subscribers:
            self._subscribers.remove(queue)

