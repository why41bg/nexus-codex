"""Account bootstrap service - manages codex login subprocess lifecycle.

Orchestrates the codex login --device-auth flow:
1. Creates CODEX_HOME directory
2. Spawns codex login subprocess
3. Parses stdout for login URL and device code
4. Monitors for auth.json creation (login success)
5. Enforces 5-minute timeout, killing the subprocess if exceeded
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.utils.logger import log

CODEX_POOL_DIR = Path.home() / ".codex-pool"
BOOTSTRAP_TIMEOUT_SEC = 5 * 60  # 5 minutes


@dataclass
class BootstrapSession:
    session_id: str
    codex_home: str
    remark: str
    max_concurrency: int | None
    login_url: str | None = None
    device_code: str | None = None
    process: asyncio.subprocess.Process | None = None
    status: str = "pending"
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + BOOTSTRAP_TIMEOUT_SEC)


_sessions: dict[str, BootstrapSession] = {}


# Regex to strip ANSI escape sequences (e.g. \x1b[0m, \x1b[1;32m)
_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def _parse_output_line(text: str, session: BootstrapSession) -> None:
    """Extract login URL and device code from a line of subprocess output."""
    # Strip ANSI escape codes that codex CLI may emit
    clean = _ANSI_ESCAPE_RE.sub("", text)
    if not session.login_url:
        url_match = re.search(r"https?://[^\s]+", clean)
        if url_match:
            session.login_url = url_match.group(0)
    if not session.device_code:
        code_match = re.search(r"[A-Z0-9]{4}-[A-Z0-9]{4,5}", clean)
        if code_match:
            session.device_code = code_match.group(0)


async def _monitor_process(session: BootstrapSession) -> None:
    """Monitor subprocess stdout/stderr and wait for completion."""
    try:
        while True:
            line = await session.process.stdout.readline()
            if not line:
                break
            text = line.decode(errors="replace").strip()
            if text:
                _parse_output_line(text, session)

        returncode = await session.process.wait()

        if returncode == 0:
            auth_file = Path(session.codex_home) / "auth.json"
            if auth_file.exists():
                session.status = "success"
                log.info(
                    "Bootstrap login succeeded",
                    extra={"sessionId": session.session_id, "codexHome": session.codex_home},
                )
            else:
                session.status = "failed"
                session.error = "Login process completed but auth.json was not created"
                log.warn(
                    "Bootstrap login completed without auth.json",
                    extra={"sessionId": session.session_id, "codexHome": session.codex_home},
                )
        else:
            stderr_data = await session.process.stderr.read()
            stderr_text = stderr_data.decode(errors="replace").strip()
            session.status = "failed"
            session.error = stderr_text or f"Process exited with code {returncode}"
            log.warn(
                "Bootstrap login failed",
                extra={
                    "sessionId": session.session_id,
                    "codexHome": session.codex_home,
                    "exitCode": returncode,
                    "stderr": stderr_text,
                },
            )
    except Exception as e:
        session.status = "failed"
        session.error = str(e)
        log.error(
            "Bootstrap monitor error",
            extra={"sessionId": session.session_id, "error": str(e)},
        )


async def _timeout_killer(session: BootstrapSession) -> None:
    """Wait for timeout, then kill the subprocess if still running."""
    await asyncio.sleep(BOOTSTRAP_TIMEOUT_SEC)
    if session.status == "waiting_for_login":
        if session.process and session.process.returncode is None:
            session.process.kill()
            try:
                await asyncio.wait_for(session.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                pass
        session.status = "timeout"
        session.error = "Login timed out after 5 minutes"
        log.warn(
            "Bootstrap login timed out",
            extra={"sessionId": session.session_id, "codexHome": session.codex_home},
        )


async def start_bootstrap(remark: str, max_concurrency: int | None) -> BootstrapSession:
    """Create directory and start codex login --device-auth subprocess.

    Returns the BootstrapSession immediately. The subprocess is monitored
    asynchronously; callers should poll get_session() for status updates.
    """
    session_id = f"bootstrap-{uuid.uuid4().hex[:12]}"
    account_dir = CODEX_POOL_DIR / f"account-{uuid.uuid4().hex[:8]}"
    account_dir.mkdir(parents=True, exist_ok=True)

    session = BootstrapSession(
        session_id=session_id,
        codex_home=str(account_dir),
        remark=remark,
        max_concurrency=max_concurrency,
        status="waiting_for_login",
    )

    env = {**os.environ, "CODEX_HOME": str(account_dir)}
    proc = await asyncio.create_subprocess_exec(
        "codex",
        "login",
        "--device-auth",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    session.process = proc

    # Start monitor and timeout killer concurrently
    asyncio.create_task(_monitor_process(session))
    asyncio.create_task(_timeout_killer(session))

    _sessions[session_id] = session

    log.info(
        "Bootstrap session started",
        extra={"sessionId": session_id, "codexHome": str(account_dir)},
    )

    return session


def get_session(session_id: str) -> BootstrapSession | None:
    """Get a bootstrap session by ID."""
    return _sessions.get(session_id)


async def confirm_bootstrap(session_id: str) -> dict | None:
    """Confirm a successful bootstrap and return account data for registration.

    Removes the session from the store. The caller is responsible for
    calling add_account() with the returned data.
    """
    session = _sessions.pop(session_id, None)
    if not session:
        return None
    if session.status != "success":
        return None
    return {
        "codex_home": session.codex_home,
        "remark": session.remark,
        "max_concurrency": session.max_concurrency,
    }


async def cancel_bootstrap(session_id: str) -> bool:
    """Cancel a bootstrap session: kill subprocess and remove directory."""
    session = _sessions.pop(session_id, None)
    if not session:
        return False

    if session.process and session.process.returncode is None:
        session.process.kill()
        try:
            await asyncio.wait_for(session.process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            pass

    # Clean up the created directory
    codex_dir = Path(session.codex_home)
    if codex_dir.exists():
        shutil.rmtree(str(codex_dir), ignore_errors=True)

    log.info(
        "Bootstrap session cancelled",
        extra={"sessionId": session_id, "codexHome": session.codex_home},
    )

    return True


def session_to_dict(session: BootstrapSession) -> dict:
    """Convert a BootstrapSession to a JSON-serializable dict for API responses."""
    return {
        "sessionId": session.session_id,
        "codexHome": session.codex_home,
        "loginUrl": session.login_url,
        "deviceCode": session.device_code,
        "status": session.status,
        "error": session.error,
        "expiresAt": int(session.expires_at),
    }