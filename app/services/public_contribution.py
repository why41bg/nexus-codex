from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone

from app.models import ContributionInvite, ContributionRecord
from app.services.account_bootstrap import BootstrapManager, BootstrapSession
from app.services.account_store import AccountStore
from app.services.config_store import ConfigStore
from app.services.token_manager import TokenManager


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ActiveContribution:
    record_id: str
    invite_id: str
    client_ip: str
    bootstrap_session_id: str


class PublicContributionService:
    def __init__(
        self,
        *,
        bootstrap_manager: BootstrapManager,
        config_store: ConfigStore,
        account_store: AccountStore,
    ) -> None:
        self._bootstrap_manager = bootstrap_manager
        self._config_store = config_store
        self._account_store = account_store
        self._active_sessions: dict[str, ActiveContribution] = {}
        self._global_active_limit = 3

    def _count_active_for_invite(self, invite_id: str) -> int:
        return sum(1 for item in self._active_sessions.values() if item.invite_id == invite_id)

    def _count_active_for_ip(self, client_ip: str) -> int:
        return sum(1 for item in self._active_sessions.values() if item.client_ip == client_ip)

    def _public_session_payload(self, record: ContributionRecord) -> dict:
        expires_at = None
        if record.expires_at:
            expires_at = int(datetime.fromisoformat(record.expires_at).timestamp())
        return {
            "contributionId": record.id,
            "loginUrl": record.login_url,
            "deviceCode": record.device_code,
            "status": record.status,
            "error": record.error,
            "expiresAt": expires_at,
        }

    async def start_contribution(
        self,
        *,
        invite: ContributionInvite,
        applicant_name: str,
        applicant_contact: str,
        note: str,
        client_ip: str,
    ) -> dict:
        if len(self._active_sessions) >= self._global_active_limit:
            raise ValueError("当前共享登录通道繁忙，请稍后再试")
        if self._count_active_for_ip(client_ip) >= 1:
            raise ValueError("同一 IP 仅允许同时进行 1 个共享登录流程")
        if self._count_active_for_invite(invite.id) >= invite.max_active_sessions:
            raise ValueError("该邀请码当前已有活跃登录流程，请稍后再试")

        session = await self._bootstrap_manager.start_bootstrap(
            remark=f"public:{applicant_name.strip()}",
            max_concurrency=1,
        )
        record = ContributionRecord(
            id=f"ctr_{session.session_id}",
            bootstrap_session_id=session.session_id,
            invite_id=invite.id,
            invite_name=invite.name,
            applicant_name=applicant_name,
            applicant_contact=applicant_contact,
            note=note,
            client_ip=client_ip,
            status="waiting_for_login",
            codex_home=session.codex_home,
            login_url=session.login_url,
            device_code=session.device_code,
            created_at=_utc_now_iso(),
            expires_at=datetime.fromtimestamp(session.expires_at, tz=timezone.utc).isoformat(),
        )
        await self._config_store.add_contribution_record(record)
        self._active_sessions[record.id] = ActiveContribution(
            record_id=record.id,
            invite_id=invite.id,
            client_ip=client_ip,
            bootstrap_session_id=session.session_id,
        )
        asyncio.create_task(self._watch_session(record.id, session.session_id, invite.id))
        return self._public_session_payload(record)

    async def _watch_session(self, record_id: str, bootstrap_session_id: str, invite_id: str) -> None:
        try:
            while True:
                session = self._bootstrap_manager.get_session(bootstrap_session_id)
                if session is None:
                    break
                await self._sync_record(record_id, session)
                if session.status in {"success", "failed", "timeout"}:
                    if session.status == "success":
                        await self._mark_login_success(record_id, session, invite_id)
                    break
                await asyncio.sleep(1.0)
        finally:
            self._active_sessions.pop(record_id, None)

    async def _sync_record(self, record_id: str, session: BootstrapSession) -> None:
        await self._config_store.update_contribution_record(
            record_id,
            login_url=session.login_url,
            device_code=session.device_code,
            status=session.status,
            error=session.error,
        )

    async def _mark_login_success(
        self,
        record_id: str,
        session: BootstrapSession,
        invite_id: str,
    ) -> None:
        token_manager = TokenManager(session.codex_home)
        await token_manager.get_access_token()
        account_id = token_manager.get_account_id()
        plan_type = token_manager.get_plan_type()
        existing_accounts = await self._account_store.load_accounts()
        duplicate_account_id = next(
            (
                account.id
                for account in existing_accounts
                if account.id == account_id or account.codex_home == session.codex_home
            ),
            None,
        )
        await self._config_store.update_contribution_record(
            record_id,
            status="pending_review",
            completed_at=_utc_now_iso(),
            account_id=account_id,
            account_plan_type=plan_type,
            duplicate_account_id=duplicate_account_id,
        )
        await self._config_store.increment_contribution_invite_usage(invite_id)

    def get_public_record(self, record_id: str) -> dict | None:
        record = self._config_store.find_contribution_record(record_id)
        if not record:
            return None
        return self._public_session_payload(record)

    async def finalize_record(self, record_id: str, *, remove_directory: bool) -> bool:
        record = self._config_store.find_contribution_record(record_id)
        if not record:
            return False
        await self._bootstrap_manager.finalize_bootstrap(
            record.bootstrap_session_id,
            remove_directory=remove_directory,
        )
        return True

    async def cancel_public_record(self, record_id: str) -> bool:
        active = self._active_sessions.get(record_id)
        if not active:
            return False
        await self._bootstrap_manager.cancel_bootstrap(active.bootstrap_session_id)
        await self._config_store.update_contribution_record(
            record_id,
            status="cancelled",
            completed_at=_utc_now_iso(),
        )
        self._active_sessions.pop(record_id, None)
        return True
