from __future__ import annotations

"""Config persistence store - manages data/config.json.

All mutable state is encapsulated in the ConfigStore class.
An instance is created during app startup and stored in AppDependencies.
"""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

import aiofiles

from app.models import (
    ApiKeyEntry,
    ApiKeyTemplate,
    AppConfig,
    BannedIP,
    ClaimRateLimitEntry,
    ContributionInvite,
    ContributionRateLimitEntry,
    ContributionRecord,
)
from app.config import DATA_DIR, settings
from app.utils.bg_task import create_bg_task
from app.utils.logger import log

CONFIG_PATH = DATA_DIR / "config.json"


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


def _constant_time_equal(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    ha = hmac.HMAC(b"nexus-codex-constant-time-cmp", a.encode(), hashlib.sha256).digest()
    hb = hmac.HMAC(b"nexus-codex-constant-time-cmp", b.encode(), hashlib.sha256).digest()
    return hmac.compare_digest(ha, hb)


class ConfigStore:
    """Encapsulated config persistence — no module-level globals.

    All mutable state (config data, write lock, caches) is instance-level,
    making the store testable and safe in multi-instance scenarios.
    """

    # Flush buffered monthly usage counters to disk at most this often (seconds).
    _USAGE_FLUSH_INTERVAL: float = 30.0

    def __init__(self) -> None:
        self._config: AppConfig | None = None
        self._write_lock = asyncio.Lock()
        self._api_key_set_cache: set[str] | None = None
        self._key_index: dict[str, ApiKeyEntry] = {}
        # Buffered monthly usage increments — flushed periodically to avoid
        # writing the full config.json on every single request.
        self._usage_dirty: bool = False
        self._usage_flush_task: asyncio.Task | None = None

    # ─── Lifecycle ─────────────────────────────────────────────

    async def load_config(self) -> AppConfig:
        """Load config from disk or create default.

        Admin credentials are always read from environment variables
        (ADMIN_USERNAME / ADMIN_PASSWORD) and never persisted to disk.
        """
        exists = await asyncio.to_thread(CONFIG_PATH.exists)
        if not exists:
            self._config = AppConfig()
            await self._save_config()
        else:
            async with aiofiles.open(CONFIG_PATH, mode="r", encoding="utf-8") as f:
                raw = await f.read()
            parsed = json.loads(raw)
            self._config = AppConfig(
                default_models=parsed.get("default_models", AppConfig().default_models),
                api_keys=[ApiKeyEntry(**k) for k in parsed.get("api_keys", [])],
                api_key_templates=[ApiKeyTemplate(**t) for t in parsed.get("api_key_templates", [])],
                claim_rate_limits=[
                    ClaimRateLimitEntry(**r) for r in parsed.get("claim_rate_limits", [])
                ],
                contribution_invites=[
                    ContributionInvite(**i) for i in parsed.get("contribution_invites", [])
                ],
                contribution_rate_limits=[
                    ContributionRateLimitEntry(**r) for r in parsed.get("contribution_rate_limits", [])
                ],
                contribution_records=[
                    ContributionRecord(**r) for r in parsed.get("contribution_records", [])
                ],
                banned_ips=[BannedIP(**b) for b in parsed.get("banned_ips", [])],
            )
            # Fill missing fields for backward compat
            for k in self._config.api_keys:
                if k.monthly_reset_at is None:
                    k.monthly_reset_at = _get_next_month_reset()

        # Build key index after loading
        self._rebuild_key_index()

        # Security warning
        if settings.admin_username == "admin" and settings.verify_password("admin"):
            log.warning(
                "Admin credentials are default (admin/admin). "
                "Set ADMIN_USERNAME/ADMIN_PASSWORD env vars for production."
            )

        return self._config

    async def _save_config(self) -> None:
        """Atomically save config to disk."""
        if self._config is None:
            return
        async with self._write_lock:
            await asyncio.to_thread(DATA_DIR.mkdir, parents=True, exist_ok=True)
            tmp_path = CONFIG_PATH.with_suffix(".tmp")
            data = json.dumps(self._config.model_dump(), indent=2)
            async with aiofiles.open(tmp_path, mode="w", encoding="utf-8") as f:
                await f.write(data + "\n")
            await asyncio.to_thread(os.replace, str(tmp_path), str(CONFIG_PATH))
            self._api_key_set_cache = None

    def _invalidate_api_key_cache(self) -> None:
        self._api_key_set_cache = None
        self._rebuild_key_index()

    def _rebuild_key_index(self) -> None:
        """Rebuild the O(1) lookup index for API keys."""
        if self._config is None:
            self._key_index = {}
            return
        self._key_index = {k.key: k for k in self._config.api_keys}

    # ─── Read-only accessors ─────────────────────────────────────

    def get_api_key_set(self) -> set[str]:
        """Get the set of all configured API keys."""
        if self._api_key_set_cache is None:
            if self._config is None:
                return set()
            self._api_key_set_cache = {k.key for k in self._config.api_keys}
        return self._api_key_set_cache

    def get_default_models(self) -> list[str]:
        """Get the default model list."""
        if self._config is None:
            return []
        return list(self._config.default_models)

    def get_api_keys(self) -> list[ApiKeyEntry]:
        """Get all API keys."""
        if self._config is None:
            return []
        return self._config.api_keys

    def find_api_key(self, key: str) -> ApiKeyEntry | None:
        """Find an API key entry by key value using O(1) dict index lookup.

        Uses an internal ``_key_index`` dict keyed by raw API key strings.
        The dict is rebuilt whenever keys are added, updated, or removed.
        """
        if self._config is None:
            return None
        return self._key_index.get(key)

    def get_models_for_key(self, key: str) -> list[str]:
        """Get models available for a specific API key."""
        entry = self.find_api_key(key)
        if not entry:
            return []
        if entry.models:
            return list(entry.models)
        return self.get_default_models()

    def is_model_allowed_for_key(self, key: str, model_id: str) -> bool:
        """Check if a model is available for a given API key."""
        models = self.get_models_for_key(key)
        return model_id in models

    # ─── Auth helpers ──────────────────────────────────────────

    def verify_admin_auth(self, username: str, password: str) -> bool:
        """Verify admin credentials using constant-time comparison + bcrypt.

        Username is compared in constant-time to prevent timing attacks.
        Password is verified against the bcrypt hash stored in settings.
        """
        user_match = _constant_time_equal(username, settings.admin_username)
        pass_match = settings.verify_password(password)
        return user_match and pass_match

    def verify_admin_password(self, password: str) -> bool:
        """Verify admin password only (for sensitive operations like key reveal).

        Password is verified against the bcrypt hash stored in settings.
        """
        return settings.verify_password(password)

    # ─── API Key CRUD ───────────────────────────────────────────

    async def add_api_key(
        self,
        key: str,
        name: str,
        models: list[str] | None = None,
        expires_at: str | None = None,
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
        if self._config is None:
            raise RuntimeError("Config not loaded")
        entry = ApiKeyEntry(
            key=key,
            name=name,
            models=models or [],
            created_at=datetime.now(timezone.utc).isoformat(),
            expires_at=expires_at,
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
        self._config.api_keys.append(entry)
        self._invalidate_api_key_cache()
        await self._save_config()
        return entry

    async def update_api_key(self, key: str, **updates: object) -> ApiKeyEntry | None:
        """Update an existing API key."""
        if self._config is None:
            return None
        for entry in self._config.api_keys:
            if entry.key == key:
                for k, v in updates.items():
                    if hasattr(entry, k):
                        setattr(entry, k, v)
                self._invalidate_api_key_cache()
                await self._save_config()
                return entry
        return None

    async def remove_api_key(self, key: str) -> bool:
        """Remove an API key."""
        if self._config is None:
            return False
        original_len = len(self._config.api_keys)
        self._config.api_keys = [k for k in self._config.api_keys if k.key != key]
        if len(self._config.api_keys) == original_len:
            return False
        self._invalidate_api_key_cache()
        await self._save_config()
        return True

    # ─── Default Models CRUD ────────────────────────────────────

    async def add_default_model(self, model_id: str) -> bool:
        """Add a default model."""
        if self._config is None:
            return False
        if model_id in self._config.default_models:
            return False
        self._config.default_models.append(model_id)
        await self._save_config()
        return True

    async def remove_default_model(self, model_id: str) -> bool:
        """Remove a default model."""
        if self._config is None:
            return False
        if model_id not in self._config.default_models:
            return False
        self._config.default_models.remove(model_id)
        await self._save_config()
        return True

    # ─── API Key Template CRUD ───────────────────────────────────

    def get_api_key_templates(self) -> list[ApiKeyTemplate]:
        """Get all self-service API key claim templates."""
        if self._config is None:
            return []
        return self._config.api_key_templates

    def find_api_key_template(self, template_id: str) -> ApiKeyTemplate | None:
        """Find an API key template by id."""
        if self._config is None:
            return None
        for template in self._config.api_key_templates:
            if template.id == template_id:
                return template
        return None

    async def add_api_key_template(
        self,
        *,
        name: str,
        description: str = "",
        enabled: bool = True,
        models: list[str] | None = None,
        require_claim_code: bool = True,
        claim_code: str = "",
        claim_code_max_usage: int | None = None,
        rate_limit_max: int | None = None,
        rate_limit_window_ms: int | None = None,
        monthly_quota: int | None = None,
        claim_ip_limit_max: int = 1,
        claim_ip_limit_window_ms: int = 24 * 60 * 60 * 1000,
    ) -> ApiKeyTemplate:
        """Add a self-service API key claim template."""
        if self._config is None:
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
            claim_code_max_usage=claim_code_max_usage,
            rate_limit_max=rate_limit_max,
            rate_limit_window_ms=rate_limit_window_ms,
            monthly_quota=monthly_quota,
            claim_ip_limit_max=claim_ip_limit_max,
            claim_ip_limit_window_ms=claim_ip_limit_window_ms,
            created_at=now,
            updated_at=now,
        )
        self._config.api_key_templates.append(template)
        await self._save_config()
        return template

    async def update_api_key_template(self, template_id: str, **updates: object) -> ApiKeyTemplate | None:
        """Update a self-service API key claim template."""
        if self._config is None:
            return None
        for template in self._config.api_key_templates:
            if template.id == template_id:
                for key, value in updates.items():
                    if hasattr(template, key):
                        setattr(template, key, value)
                template.updated_at = datetime.now(timezone.utc).isoformat()
                await self._save_config()
                return template
        return None

    async def increment_claim_code_usage(self, template_id: str) -> None:
        """Increment the claim code used count for a template."""
        if self._config is None:
            return
        for template in self._config.api_key_templates:
            if template.id == template_id:
                template.claim_code_used_count += 1
                await self._save_config()
                return

    async def reset_claim_code_usage(self, template_id: str) -> bool:
        """Reset the claim code used count for a template back to zero."""
        if self._config is None:
            return False
        for template in self._config.api_key_templates:
            if template.id == template_id:
                template.claim_code_used_count = 0
                await self._save_config()
                return True
        return False

    async def remove_api_key_template(self, template_id: str) -> bool:
        """Remove a self-service API key claim template."""
        if self._config is None:
            return False
        original_len = len(self._config.api_key_templates)
        self._config.api_key_templates = [
            template for template in self._config.api_key_templates if template.id != template_id
        ]
        if len(self._config.api_key_templates) == original_len:
            return False
        await self._save_config()
        return True

    # ─── Contribution invites / records ─────────────────────────

    def get_contribution_invites(self) -> list[ContributionInvite]:
        if self._config is None:
            return []
        return self._config.contribution_invites

    def find_contribution_invite_by_id(self, invite_id: str) -> ContributionInvite | None:
        if self._config is None:
            return None
        for invite in self._config.contribution_invites:
            if invite.id == invite_id:
                return invite
        return None

    def find_contribution_invite_by_code(self, code: str) -> ContributionInvite | None:
        if self._config is None:
            return None
        for invite in self._config.contribution_invites:
            if invite.code == code:
                return invite
        return None

    async def add_contribution_invite(
        self,
        *,
        name: str,
        note: str = "",
        code: str | None = None,
        enabled: bool = True,
        expires_at: str | None = None,
        max_uses: int | None = None,
        max_active_sessions: int = 1,
        per_ip_limit_max: int = 3,
        per_ip_limit_window_ms: int = 24 * 60 * 60 * 1000,
    ) -> ContributionInvite:
        if self._config is None:
            raise RuntimeError("Config not loaded")
        now = datetime.now(timezone.utc).isoformat()
        invite = ContributionInvite(
            id=f"inv_{secrets.token_hex(8)}",
            code=code or f"invite_{secrets.token_urlsafe(12)}",
            name=name,
            note=note,
            enabled=enabled,
            created_at=now,
            expires_at=expires_at,
            max_uses=max_uses,
            used_count=0,
            max_active_sessions=max_active_sessions,
            per_ip_limit_max=per_ip_limit_max,
            per_ip_limit_window_ms=per_ip_limit_window_ms,
        )
        self._config.contribution_invites.append(invite)
        await self._save_config()
        return invite

    async def update_contribution_invite(self, invite_id: str, **updates: object) -> ContributionInvite | None:
        if self._config is None:
            return None
        invite = self.find_contribution_invite_by_id(invite_id)
        if not invite:
            return None
        for key, value in updates.items():
            if hasattr(invite, key):
                setattr(invite, key, value)
        await self._save_config()
        return invite

    async def remove_contribution_invite(self, invite_id: str) -> bool:
        if self._config is None:
            return False
        original_len = len(self._config.contribution_invites)
        self._config.contribution_invites = [
            invite for invite in self._config.contribution_invites if invite.id != invite_id
        ]
        if len(self._config.contribution_invites) == original_len:
            return False
        await self._save_config()
        return True

    def get_contribution_records(self) -> list[ContributionRecord]:
        if self._config is None:
            return []
        return self._config.contribution_records

    def find_contribution_record(self, record_id: str) -> ContributionRecord | None:
        if self._config is None:
            return None
        for record in self._config.contribution_records:
            if record.id == record_id:
                return record
        return None

    async def add_contribution_record(self, record: ContributionRecord) -> None:
        if self._config is None:
            raise RuntimeError("Config not loaded")
        self._config.contribution_records.append(record)
        await self._save_config()

    async def update_contribution_record(self, record_id: str, **updates: object) -> ContributionRecord | None:
        record = self.find_contribution_record(record_id)
        if not record:
            return None
        for key, value in updates.items():
            if hasattr(record, key):
                setattr(record, key, value)
        await self._save_config()
        return record

    async def increment_contribution_invite_usage(self, invite_id: str) -> None:
        invite = self.find_contribution_invite_by_id(invite_id)
        if not invite:
            return
        invite.used_count += 1
        await self._save_config()

    async def record_contribution_attempt(
        self,
        ip: str,
        invite_id: str,
        *,
        limit_max: int,
        window_ms: int,
    ) -> tuple[bool, int]:
        if self._config is None:
            return False, window_ms
        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        window_start = now - window_ms
        target: ContributionRateLimitEntry | None = None
        for entry in self._config.contribution_rate_limits:
            if entry.ip == ip and entry.invite_id == invite_id:
                target = entry
                break
        if target is None:
            target = ContributionRateLimitEntry(ip=ip, invite_id=invite_id, timestamps_ms=[])
            self._config.contribution_rate_limits.append(target)

        target.timestamps_ms = [ts for ts in target.timestamps_ms if ts >= window_start]
        if len(target.timestamps_ms) >= limit_max:
            oldest = min(target.timestamps_ms) if target.timestamps_ms else now
            return False, max(0, oldest + window_ms - now)

        target.timestamps_ms.append(now)
        await self._save_config()
        return True, 0

    # ─── Self-service claim rate limit persistence ───────────────

    async def record_claim_attempt(
        self,
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
        if self._config is None:
            return False, window_ms
        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        window_start = now - window_ms
        target: ClaimRateLimitEntry | None = None
        for entry in self._config.claim_rate_limits:
            if entry.ip == ip and entry.template_id == template_id:
                target = entry
                break
        if target is None:
            target = ClaimRateLimitEntry(ip=ip, template_id=template_id, timestamps_ms=[])
            self._config.claim_rate_limits.append(target)

        target.timestamps_ms = [ts for ts in target.timestamps_ms if ts >= window_start]
        if len(target.timestamps_ms) >= limit_max:
            oldest = min(target.timestamps_ms) if target.timestamps_ms else now
            return False, max(0, oldest + window_ms - now)

        target.timestamps_ms.append(now)
        await self._save_config()
        return True, 0

    # ─── Monthly quota helper ────────────────────────────────────

    async def increment_key_monthly_usage(self, key: str) -> None:
        """Increment monthly usage for an API key (buffered write).

        The in-memory counter is updated immediately so quota checks are
        accurate, but the disk write is deferred and batched to avoid
        writing the full config.json on every single request.
        """
        entry = self.find_api_key(key)
        if not entry:
            return
        # Check if reset is needed
        if entry.monthly_reset_at:
            reset_time = datetime.fromisoformat(entry.monthly_reset_at)
            if datetime.now(timezone.utc) >= reset_time:
                entry.monthly_usage = 0
                entry.monthly_reset_at = _get_next_month_reset()
        entry.monthly_usage += 1
        self._usage_dirty = True
        self._schedule_usage_flush()

    def _schedule_usage_flush(self) -> None:
        """Schedule a deferred flush if one is not already pending."""
        if self._usage_flush_task is not None and not self._usage_flush_task.done():
            return  # already scheduled
        self._usage_flush_task = create_bg_task(
            self._deferred_usage_flush(), name="usage-flush"
        )

    async def _deferred_usage_flush(self) -> None:
        """Wait a short interval then flush dirty usage counters to disk."""
        await asyncio.sleep(self._USAGE_FLUSH_INTERVAL)
        await self.flush_usage()

    async def flush_usage(self) -> None:
        """Flush buffered monthly usage counters to disk immediately.

        Called by the deferred flush task and also during application
        shutdown to ensure no data is lost.
        """
        if not self._usage_dirty:
            return
        self._usage_dirty = False
        try:
            await self._save_config()
        except Exception:
            # Restore the dirty flag so a subsequent flush will retry the write.
            self._usage_dirty = True
            raise

    # ─── Banned IPs persistence ──────────────────────────────

    def get_banned_ips_from_config(self) -> list[BannedIP]:
        """Get banned IPs from config."""
        if self._config is None:
            return []
        return list(self._config.banned_ips)

    async def save_banned_ips(self, banned_ips: list[BannedIP]) -> None:
        """Persist banned IPs list to config."""
        if self._config is None:
            return
        self._config.banned_ips = list(banned_ips)
        await self._save_config()
