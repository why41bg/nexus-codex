"""Shared helpers for admin sub-routes."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.config_store import ConfigStore


def resolve_key(config_store: "ConfigStore", key_prefix: str) -> str | None:
    """Resolve a key prefix to the full key string."""
    keys = config_store.get_api_keys()
    # Try exact match first
    for k in keys:
        if k.key == key_prefix:
            return k.key
    # Try prefix match
    for k in keys:
        if k.key.startswith(key_prefix):
            return k.key
    return None


def template_to_admin_dict(template) -> dict:
    """Convert an ApiKeyTemplate model to the admin API dict format."""
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "enabled": template.enabled,
        "models": template.models,
        "requireClaimCode": template.require_claim_code,
        "claimCode": template.claim_code,
        "claimCodeMaxUsage": template.claim_code_max_usage,
        "claimCodeUsedCount": template.claim_code_used_count,
        "rateLimitMax": template.rate_limit_max,
        "rateLimitWindowMs": template.rate_limit_window_ms,
        "monthlyQuota": template.monthly_quota,
        "claimIpLimitMax": template.claim_ip_limit_max,
        "claimIpLimitWindowMs": template.claim_ip_limit_window_ms,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
    }
