from __future__ import annotations

"""Config persistence store - manages data/config.json."""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from app.models import ApiKeyEntry, ApiKeyTemplate, AppConfig, BannedIP, ClaimRateLimitEntry
from app.config import settings
from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
CONFIG_PATH = DATA_DIR / "config.json"

_config: AppConfig | None = None
_write_lock = asyncio.Lock()
_api_key_set_cache: set[str] | None = None


def _get_next_month_reset() -> str:
    """Get ISO string of next month's 1st day 00:00 UTC."""
    now = datetime.now(timezone.utc)
    if now.month == 12:
        year = now.year + 1
        month = 1
    else:
        year = now.year
        month = now.month + 1
    return datetime(year, month, 1, tzinfo=timezone.utc).isoformat()


async def load_config() -> AppConfig:
    """Load config from disk or create default.

    Admin credentials are always read from environment variables
    (ADMIN_USERNAME / ADMIN_PASSWORD) and never persisted to disk.
    """
    global _config

    if not CONFIG_PATH.exists():
        _config = AppConfig()
        await _save_config()
    else:
        raw = CONFIG_PATH.read_text(encoding="utf-8")
        parsed = json.loads(raw)
        _config = AppConfig(
            default_models=parsed.get("default_models", AppConfig().default_models),
            api_keys=[ApiKeyEntry(**k) for k in parsed.get("api_keys", [])],
            api_key_templates=[ApiKeyTemplate(**t) for t in parsed.get("api_key_templates", [])],
            claim_rate_limits=[
                ClaimRateLimitEntry(**r) for r in parsed.get("claim_rate_limits", [])
            ],
            banned_ips=[BannedIP(**b) for b in parsed.get("banned_ips", [])],
        )
        # Fill missing fields for backward compat
        for k in _config.api_keys:
            if k.monthly_reset_at is None:
                k.monthly_reset_at = _get_next_month_reset()

    # Security warning
    if settings.admin_username == "admin" and settings.admin_password == "admin":
        log.warn(
            "Admin credentials are default (admin/admin). "
            "Set ADMIN_USERNAME/ADMIN_PASSWORD env vars for production."
        )

    return _config


async def _save_config() -> None:
    """Atomically save config to disk."""
    global _api_key_set_cache
    if _config is None:
        return
    async with _write_lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = CONFIG_PATH.with_suffix(".tmp")
        data = json.dumps(_config.model_dump(), indent=2)
        tmp_path.write_text(data + "\n", encoding="utf-8")
        os.replace(str(tmp_path), str(CONFIG_PATH))
        _api_key_set_cache = None


def _invalidate_api_key_cache() -> None:
    global _api_key_set_cache
    _api_key_set_cache = None


def get_api_key_set() -> set[str]:
    """Get the set of all configured API keys."""
    global _api_key_set_cache
    if _api_key_set_cache is None:
        if _config is None:
            return set()
        _api_key_set_cache = {k.key for k in _config.api_keys}
    return _api_key_set_cache


def get_default_models() -> list[str]:
    """Get the default model list."""
    if _config is None:
        return []
    return list(_config.default_models)


def get_api_keys() -> list[ApiKeyEntry]:
    """Get all API keys."""
    if _config is None:
        return []
    return _config.api_keys


def find_api_key(key: str) -> ApiKeyEntry | None:
    """Find an API key entry by key value."""
    if _config is None:
        return None
    for k in _config.api_keys:
        if k.key == key:
            return k
    return None


def get_models_for_key(key: str) -> list[str]:
    """Get models available for a specific API key."""
    entry = find_api_key(key)
    if not entry:
        return []
    if entry.models:
        return list(entry.models)
    return get_default_models()


def is_model_allowed_for_key(key: str, model_id: str) -> bool:
    """Check if a model is available for a given API key."""
    models = get_models_for_key(key)
    return model_id in models


def _constant_time_equal(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    ha = hmac.HMAC(b"nexus-codex-constant-time-cmp", a.encode(), hashlib.sha256).digest()
    hb = hmac.HMAC(b"nexus-codex-constant-time-cmp", b.encode(), hashlib.sha256).digest()
    return hmac.compare_digest(ha, hb)


def verify_admin_auth(username: str, password: str) -> bool:
    """Verify admin credentials using constant-time comparison.

    Credentials are always read from environment variables (ADMIN_USERNAME / ADMIN_PASSWORD).
    """
    user_match = _constant_time_equal(username, settings.admin_username)
    pass_match = _constant_time_equal(password, settings.admin_password)
    return user_match and pass_match


def verify_admin_password(password: str) -> bool:
    """Verify admin password only (for sensitive operations like key reveal).

    Password is always read from the ADMIN_PASSWORD environment variable.
    """
    return _constant_time_equal(password, settings.admin_password)


# ─── API Key CRUD ───────────────────────────────────────────


async def add_api_key(
    key: str,
    name: str,
    models: list[str] | None = None,
    source: str = "admin",
    template_id: str | None = None,
    template_name: str | None = None,
    applicant_name: str | None = None,
    applicant_contact: str | None = None,
    applicant_note: str | None = None,
    rate_limit_max: int | None = None,
    rate_limit_window_ms: int | None = None,
    monthly_quota: int | None = None,
    ip_whitelist: list[str] | None = None,
) -> ApiKeyEntry:
    """Add a new API key."""
    if _config is None:
        raise RuntimeError("Config not loaded")
    entry = ApiKeyEntry(
        key=key,
        name=name,
        models=models or [],
        created_at=datetime.now(timezone.utc).isoformat(),
        source=source,
        template_id=template_id,
        template_name=template_name,
        applicant_name=applicant_name,
        applicant_contact=applicant_contact,
        applicant_note=applicant_note,
        rate_limit_max=rate_limit_max,
        rate_limit_window_ms=rate_limit_window_ms,
        monthly_quota=monthly_quota,
        monthly_usage=0,
        monthly_reset_at=_get_next_month_reset(),
        ip_whitelist=ip_whitelist or [],
    )
    _config.api_keys.append(entry)
    _invalidate_api_key_cache()
    await _save_config()
    return entry


async def update_api_key(key: str, **updates: object) -> ApiKeyEntry | None:
    """Update an existing API key."""
    if _config is None:
        return None
    for entry in _config.api_keys:
        if entry.key == key:
            for k, v in updates.items():
                if v is not None and hasattr(entry, k):
                    setattr(entry, k, v)
            _invalidate_api_key_cache()
            await _save_config()
            return entry
    return None


async def remove_api_key(key: str) -> bool:
    """Remove an API key."""
    if _config is None:
        return False
    original_len = len(_config.api_keys)
    _config.api_keys = [k for k in _config.api_keys if k.key != key]
    if len(_config.api_keys) == original_len:
        return False
    _invalidate_api_key_cache()
    await _save_config()
    return True


# ─── Default Models CRUD ────────────────────────────────────


async def add_default_model(model_id: str) -> bool:
    """Add a default model."""
    if _config is None:
        return False
    if model_id in _config.default_models:
        return False
    _config.default_models.append(model_id)
    await _save_config()
    return True


async def remove_default_model(model_id: str) -> bool:
    """Remove a default model."""
    if _config is None:
        return False
    if model_id not in _config.default_models:
        return False
    _config.default_models.remove(model_id)
    await _save_config()
    return True


# ─── API Key Template CRUD ───────────────────────────────────


def get_api_key_templates() -> list[ApiKeyTemplate]:
    """Get all self-service API key claim templates."""
    if _config is None:
        return []
    return _config.api_key_templates


def find_api_key_template(template_id: str) -> ApiKeyTemplate | None:
    """Find an API key template by id."""
    if _config is None:
        return None
    for template in _config.api_key_templates:
        if template.id == template_id:
            return template
    return None


async def add_api_key_template(
    *,
    name: str,
    description: str = "",
    enabled: bool = True,
    models: list[str] | None = None,
    require_claim_code: bool = True,
    claim_code: str = "",
    rate_limit_max: int | None = None,
    rate_limit_window_ms: int | None = None,
    monthly_quota: int | None = None,
    claim_ip_limit_max: int = 1,
    claim_ip_limit_window_ms: int = 24 * 60 * 60 * 1000,
) -> ApiKeyTemplate:
    """Add a self-service API key claim template."""
    if _config is None:
        raise RuntimeError("Config not loaded")
    now = datetime.now(timezone.utc).isoformat()
    template = ApiKeyTemplate(
        id=f"tpl_{secrets.token_hex(8)}",
        name=name,
        description=description,
        enabled=enabled,
        models=models or [],
        require_claim_code=require_claim_code,
        claim_code=claim_code,
        rate_limit_max=rate_limit_max,
        rate_limit_window_ms=rate_limit_window_ms,
        monthly_quota=monthly_quota,
        claim_ip_limit_max=claim_ip_limit_max,
        claim_ip_limit_window_ms=claim_ip_limit_window_ms,
        created_at=now,
        updated_at=now,
    )
    _config.api_key_templates.append(template)
    await _save_config()
    return template


async def update_api_key_template(template_id: str, **updates: object) -> ApiKeyTemplate | None:
    """Update a self-service API key claim template."""
    if _config is None:
        return None
    for template in _config.api_key_templates:
        if template.id == template_id:
            for key, value in updates.items():
                if hasattr(template, key):
                    setattr(template, key, value)
            template.updated_at = datetime.now(timezone.utc).isoformat()
            await _save_config()
            return template
    return None


async def remove_api_key_template(template_id: str) -> bool:
    """Remove a self-service API key claim template."""
    if _config is None:
        return False
    original_len = len(_config.api_key_templates)
    _config.api_key_templates = [
        template for template in _config.api_key_templates if template.id != template_id
    ]
    if len(_config.api_key_templates) == original_len:
        return False
    await _save_config()
    return True


# ─── Self-service claim rate limit persistence ───────────────


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


async def record_claim_attempt(
    ip: str,
    template_id: str,
    *,
    limit_max: int,
    window_ms: int,
) -> tuple[bool, int]:
    """Persist and check an IP-based claim attempt.

    Returns ``(allowed, retry_after_ms)``. Failed attempts are counted too,
    so an attacker cannot brute force a claim code without consuming quota.
    """
    if _config is None:
        return False, window_ms
    now = _now_ms()
    window_start = now - window_ms
    target: ClaimRateLimitEntry | None = None
    for entry in _config.claim_rate_limits:
        if entry.ip == ip and entry.template_id == template_id:
            target = entry
            break
    if target is None:
        target = ClaimRateLimitEntry(ip=ip, template_id=template_id, timestamps_ms=[])
        _config.claim_rate_limits.append(target)

    target.timestamps_ms = [ts for ts in target.timestamps_ms if ts >= window_start]
    if len(target.timestamps_ms) >= limit_max:
        oldest = min(target.timestamps_ms) if target.timestamps_ms else now
        return False, max(0, oldest + window_ms - now)

    target.timestamps_ms.append(now)
    await _save_config()
    return True, 0


# ─── Monthly quota helper ────────────────────────────────────


async def increment_key_monthly_usage(key: str) -> None:
    """Increment monthly usage for an API key."""
    entry = find_api_key(key)
    if not entry:
        return
    # Check if reset is needed
    if entry.monthly_reset_at:
        reset_time = datetime.fromisoformat(entry.monthly_reset_at)
        if datetime.now(timezone.utc) >= reset_time:
            entry.monthly_usage = 0
            entry.monthly_reset_at = _get_next_month_reset()
    entry.monthly_usage += 1
    await _save_config()


# ─── Banned IPs persistence ──────────────────────────────


def get_banned_ips_from_config() -> list[BannedIP]:
    """Get banned IPs from config."""
    if _config is None:
        return []
    return list(_config.banned_ips)


async def save_banned_ips(banned_ips: list[BannedIP]) -> None:
    """Persist banned IPs list to config."""
    if _config is None:
        return
    _config.banned_ips = list(banned_ips)
    await _save_config()
