"""IP ban store - manages automatic and manual IP banning."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timezone

from app.config import settings
from app.models import BannedIP
from app.utils.logger import log


# In-memory banned IP set for O(1) lookup
_banned_ips: set[str] = set()

# Full banned IP data (synced with config)
_banned_ip_list: list[BannedIP] = []

# Sliding window hit counter: ip -> list of timestamps
_hit_counter: dict[str, list[float]] = defaultdict(list)


def init_banned_ips(banned_ips: list[BannedIP]) -> None:
    """Initialize banned IPs from persisted config."""
    global _banned_ip_list
    _banned_ip_list = list(banned_ips)
    _banned_ips.clear()
    for entry in _banned_ip_list:
        _banned_ips.add(entry.ip)
    if _banned_ip_list:
        log.info(f"Loaded {len(_banned_ip_list)} banned IPs")


def is_banned(ip: str) -> bool:
    """Check if an IP is banned. O(1) lookup."""
    return ip in _banned_ips


def get_banned_ips() -> list[BannedIP]:
    """Get all banned IPs."""
    return list(_banned_ip_list)


def record_suspicious_hit(ip: str, reason: str) -> bool:
    """Record a suspicious hit from an IP. Returns True if IP was just banned.

    Uses a sliding window to count hits. If threshold is exceeded, the IP
    is automatically banned.
    """
    if is_banned(ip):
        return False

    now = time.time()
    window = settings.ban_window_seconds

    # Clean old timestamps
    timestamps = _hit_counter[ip]
    cutoff = now - window
    timestamps = [t for t in timestamps if t > cutoff]
    timestamps.append(now)
    _hit_counter[ip] = timestamps

    if len(timestamps) >= settings.ban_threshold:
        ban_ip(ip, reason=f"Auto-banned: {len(timestamps)} suspicious requests in {window}s (last: {reason})")
        # Clean up counter
        del _hit_counter[ip]
        return True

    return False


def ban_ip(ip: str, reason: str = "Manually banned") -> BannedIP | None:
    """Add an IP to the ban list. Returns the entry or None if already banned."""
    if ip in _banned_ips:
        return None

    entry = BannedIP(
        ip=ip,
        reason=reason,
        banned_at=datetime.now(timezone.utc).isoformat(),
        hit_count=len(_hit_counter.get(ip, [])) or 1,
    )
    _banned_ips.add(ip)
    _banned_ip_list.append(entry)
    log.info(f"Banned IP: {ip} — {reason}")
    return entry


def unban_ip(ip: str) -> bool:
    """Remove an IP from the ban list. Returns True if it was banned."""
    if ip not in _banned_ips:
        return False

    _banned_ips.discard(ip)
    _banned_ip_list[:] = [e for e in _banned_ip_list if e.ip != ip]
    # Also clear any hit counter
    _hit_counter.pop(ip, None)
    log.info(f"Unbanned IP: {ip}")
    return True


def get_client_ip(request) -> str:
    """Extract real client IP from request, respecting proxy headers."""
    # Check X-Forwarded-For first (common with reverse proxies)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the first IP in the chain (original client)
        return forwarded_for.split(",")[0].strip()

    # Check X-Real-IP (nginx style)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Fall back to direct connection IP
    if request.client:
        return request.client.host

    return "unknown"
