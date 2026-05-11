"""SQLite-backed structured log storage.

Provides persistent storage for application logs with flexible schema:
- Fixed columns for high-frequency query dimensions
- JSON context field for arbitrary structured data
- Tag table for multi-dimensional classification
- Schema versioning for future upgrades
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import time
from pathlib import Path

from app.utils.logger import log

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DB_PATH = DATA_DIR / "logs.db"
DEFAULT_RETENTION_DAYS = 30
CURRENT_SCHEMA_VER = 1


def _ensure_db(db_path: str | None = None, *, check_same_thread: bool = True) -> sqlite3.Connection:
    """Create tables and indexes if they don't exist, return connection."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path or str(DB_PATH), check_same_thread=check_same_thread)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            level       TEXT NOT NULL,
            source      TEXT NOT NULL,
            event       TEXT NOT NULL,
            message     TEXT NOT NULL,
            context     TEXT,
            trace_id    TEXT,
            session_id  TEXT,
            account_id  TEXT,
            api_key_id  TEXT,
            client_ip   TEXT,
            duration_ms INTEGER,
            schema_ver  INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS log_tags (
            log_id      INTEGER NOT NULL,
            tag         TEXT NOT NULL,
            PRIMARY KEY (log_id, tag),
            FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
        );

        -- Main table indexes
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
        CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
        CREATE INDEX IF NOT EXISTS idx_logs_event ON logs(event);
        CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);
        CREATE INDEX IF NOT EXISTS idx_logs_account_id ON logs(account_id);
        CREATE INDEX IF NOT EXISTS idx_logs_api_key_id ON logs(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_logs_client_ip ON logs(client_ip);

        -- Composite indexes for common query patterns
        CREATE INDEX IF NOT EXISTS idx_logs_level_ts ON logs(level, timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_source_ts ON logs(source, timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_event_ts ON logs(event, timestamp);

        -- Tag index
        CREATE INDEX IF NOT EXISTS idx_log_tags_tag ON log_tags(tag);
    """)
    conn.commit()
    return conn


def _cleanup_old(conn: sqlite3.Connection, retention_days: int) -> int:
    """Remove logs older than retention_days. Returns deleted count."""
    cutoff_ms = int((time.time() - retention_days * 86400) * 1000)
    # Delete tags for old logs first (ON DELETE CASCADE may not be enforced)
    conn.execute(
        "DELETE FROM log_tags WHERE log_id IN (SELECT id FROM logs WHERE timestamp < ?)",
        (cutoff_ms,),
    )
    cursor = conn.execute("DELETE FROM logs WHERE timestamp < ?", (cutoff_ms,))
    deleted = cursor.rowcount
    conn.commit()
    return deleted


class LogStore:
    """SQLite-backed structured log storage."""

    def __init__(self, retention_days: int = DEFAULT_RETENTION_DAYS) -> None:
        self._retention_days = retention_days
        self._conn = _ensure_db(str(DB_PATH), check_same_thread=False)
        self._db_lock = threading.Lock()
        deleted = _cleanup_old(self._conn, retention_days)
        log.info(
            "LogStore initialized",
            extra={"db_path": str(DB_PATH), "retention_days": retention_days, "cleaned": deleted},
        )

    async def write(
        self,
        *,
        level: str,
        source: str,
        event: str,
        message: str,
        context: dict | None = None,
        tags: list[str] | None = None,
        trace_id: str | None = None,
        session_id: str | None = None,
        account_id: str | None = None,
        api_key_id: str | None = None,
        client_ip: str | None = None,
        duration_ms: int | None = None,
    ) -> int:
        """Write a single log entry. Returns the log_id."""
        now_ms = int(time.time() * 1000)
        context_json = json.dumps(context, ensure_ascii=False) if context else None

        def _do_write() -> int:
            with self._db_lock:
                cursor = self._conn.execute(
                    """INSERT INTO logs
                       (timestamp, level, source, event, message, context,
                        trace_id, session_id, account_id, api_key_id, client_ip,
                        duration_ms, schema_ver)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        now_ms, level, source, event, message, context_json,
                        trace_id, session_id, account_id, api_key_id, client_ip,
                        duration_ms, CURRENT_SCHEMA_VER,
                    ),
                )
                log_id = cursor.lastrowid

                if tags:
                    self._conn.executemany(
                        "INSERT OR IGNORE INTO log_tags (log_id, tag) VALUES (?, ?)",
                        [(log_id, tag) for tag in tags],
                    )

                self._conn.commit()
                return log_id

        try:
            return await asyncio.to_thread(_do_write)
        except Exception as e:
            log.error("LogStore write failed", extra={"error": str(e)})
            return -1

    async def query(
        self,
        *,
        keyword: str | None = None,
        level: str | None = None,
        levels: list[str] | None = None,
        source: str | None = None,
        source_prefix: str | None = None,
        event: str | None = None,
        events: list[str] | None = None,
        tag: str | None = None,
        tags_any: list[str] | None = None,
        tags_all: list[str] | None = None,
        trace_id: str | None = None,
        account_id: str | None = None,
        api_key_id: str | None = None,
        client_ip: str | None = None,
        since: int | None = None,
        until: int | None = None,
        min_duration_ms: int | None = None,
        limit: int = 50,
        offset: int = 0,
        order: str = "desc",
    ) -> dict:
        """Flexible paginated query. Returns {items, total, limit, offset}."""
        conditions: list[str] = []
        params: list = []

        if keyword:
            conditions.append("(l.message LIKE ? OR l.context LIKE ?)")
            kw = f"%{keyword}%"
            params.extend([kw, kw])

        if level:
            conditions.append("l.level = ?")
            params.append(level)
        elif levels:
            placeholders = ",".join("?" * len(levels))
            conditions.append(f"l.level IN ({placeholders})")
            params.extend(levels)

        if source:
            conditions.append("l.source = ?")
            params.append(source)
        elif source_prefix:
            conditions.append("l.source LIKE ?")
            params.append(f"{source_prefix}%")

        if event:
            conditions.append("l.event = ?")
            params.append(event)
        elif events:
            placeholders = ",".join("?" * len(events))
            conditions.append(f"l.event IN ({placeholders})")
            params.extend(events)

        if trace_id:
            conditions.append("l.trace_id = ?")
            params.append(trace_id)

        if account_id:
            conditions.append("l.account_id = ?")
            params.append(account_id)

        if api_key_id:
            conditions.append("l.api_key_id = ?")
            params.append(api_key_id)

        if client_ip:
            conditions.append("l.client_ip = ?")
            params.append(client_ip)

        if since is not None:
            conditions.append("l.timestamp >= ?")
            params.append(since)

        if until is not None:
            conditions.append("l.timestamp <= ?")
            params.append(until)

        if min_duration_ms is not None:
            conditions.append("l.duration_ms >= ?")
            params.append(min_duration_ms)

        # Tag filtering (requires JOIN)
        tag_join = ""
        if tag:
            tag_join = " INNER JOIN log_tags t ON t.log_id = l.id"
            conditions.append("t.tag = ?")
            params.append(tag)
        elif tags_any:
            tag_join = " INNER JOIN log_tags t ON t.log_id = l.id"
            placeholders = ",".join("?" * len(tags_any))
            conditions.append(f"t.tag IN ({placeholders})")
            params.extend(tags_any)
        elif tags_all:
            # All tags must be present
            for i, t in enumerate(tags_all):
                alias = f"t{i}"
                tag_join += f" INNER JOIN log_tags {alias} ON {alias}.log_id = l.id AND {alias}.tag = ?"
                params.insert(0, t)  # will be prepended before other params
            # Re-order: tag params go first in the join
            # Actually, let's restructure to avoid confusion
            pass

        # For tags_all, rebuild properly
        if tags_all and not tag and not tags_any:
            tag_join = ""
            tag_params = []
            for i, t in enumerate(tags_all):
                alias = f"t{i}"
                tag_join += f" INNER JOIN log_tags {alias} ON {alias}.log_id = l.id AND {alias}.tag = ?"
                tag_params.append(t)
            # tag_params go before regular params in the query
            params = tag_params + params

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        order_dir = "DESC" if order == "desc" else "ASC"

        def _execute_query():
            with self._db_lock:
                # Count total
                count_sql = f"SELECT COUNT(DISTINCT l.id) FROM logs l{tag_join} WHERE {where_clause}"
                total = self._conn.execute(count_sql, params).fetchone()[0]

                # Fetch items
                query_sql = f"""
                    SELECT DISTINCT l.id, l.timestamp, l.level, l.source, l.event, l.message,
                           l.context, l.trace_id, l.session_id, l.account_id, l.api_key_id,
                           l.client_ip, l.duration_ms, l.schema_ver
                    FROM logs l{tag_join}
                    WHERE {where_clause}
                    ORDER BY l.timestamp {order_dir}
                    LIMIT ? OFFSET ?
                """
                rows = self._conn.execute(query_sql, params + [limit, offset]).fetchall()

                # Fetch tags for returned logs
                items = []
                for row in rows:
                    log_id = row[0]
                    tag_rows = self._conn.execute(
                        "SELECT tag FROM log_tags WHERE log_id = ?", (log_id,)
                    ).fetchall()
                    items.append({
                        "id": row[0],
                        "timestamp": row[1],
                        "level": row[2],
                        "source": row[3],
                        "event": row[4],
                        "message": row[5],
                        "context": json.loads(row[6]) if row[6] else None,
                        "tags": [r[0] for r in tag_rows],
                        "trace_id": row[7],
                        "session_id": row[8],
                        "account_id": row[9],
                        "api_key_id": row[10],
                        "client_ip": row[11],
                        "duration_ms": row[12],
                        "schema_ver": row[13],
                    })

                return {"items": items, "total": total, "limit": limit, "offset": offset}

        return await asyncio.to_thread(_execute_query)

    async def get_error_summary(self, range_str: str) -> dict:
        """Get error event statistics for a given time range."""
        range_ms = {
            "1h": 3600_000, "6h": 21600_000, "24h": 86400_000,
            "7d": 604800_000, "30d": 2592000_000,
        }.get(range_str, 86400_000)
        now_ms = int(time.time() * 1000)
        since_ms = now_ms - range_ms

        def _execute():
            with self._db_lock:
                # Total errors
                total = self._conn.execute(
                    "SELECT COUNT(*) FROM logs WHERE level IN ('error', 'critical') AND timestamp >= ?",
                    (since_ms,),
                ).fetchone()[0]

                # By event
                by_event = self._conn.execute(
                    """SELECT event, COUNT(*) as cnt FROM logs
                       WHERE level IN ('error', 'critical') AND timestamp >= ?
                       GROUP BY event ORDER BY cnt DESC LIMIT 20""",
                    (since_ms,),
                ).fetchall()

                # By source
                by_source = self._conn.execute(
                    """SELECT source, COUNT(*) as cnt FROM logs
                       WHERE level IN ('error', 'critical') AND timestamp >= ?
                       GROUP BY source ORDER BY cnt DESC LIMIT 20""",
                    (since_ms,),
                ).fetchall()

                # Hourly trend
                bucket_ms = 3600_000
                trend_rows = self._conn.execute(
                    """SELECT (timestamp / ?) * ? AS bucket_ts, COUNT(*) as cnt
                       FROM logs
                       WHERE level IN ('error', 'critical') AND timestamp >= ?
                       GROUP BY bucket_ts ORDER BY bucket_ts""",
                    (bucket_ms, bucket_ms, since_ms),
                ).fetchall()

                return {
                    "range": range_str,
                    "total_errors": total,
                    "by_event": [{"event": r[0], "count": r[1]} for r in by_event],
                    "by_source": [{"source": r[0], "count": r[1]} for r in by_source],
                    "trend": [{"bucket": r[0], "count": r[1]} for r in trend_rows],
                }

        return await asyncio.to_thread(_execute)

    async def get_trace(self, trace_id: str) -> list[dict]:
        """Get all log entries for a given trace_id, ordered chronologically."""

        def _execute():
            with self._db_lock:
                rows = self._conn.execute(
                    """SELECT id, timestamp, level, source, event, message, context,
                              trace_id, session_id, account_id, api_key_id, client_ip,
                              duration_ms, schema_ver
                       FROM logs WHERE trace_id = ? ORDER BY timestamp ASC""",
                    (trace_id,),
                ).fetchall()

                items = []
                for row in rows:
                    log_id = row[0]
                    tag_rows = self._conn.execute(
                        "SELECT tag FROM log_tags WHERE log_id = ?", (log_id,)
                    ).fetchall()
                    items.append({
                        "id": row[0],
                        "timestamp": row[1],
                        "level": row[2],
                        "source": row[3],
                        "event": row[4],
                        "message": row[5],
                        "context": json.loads(row[6]) if row[6] else None,
                        "tags": [r[0] for r in tag_rows],
                        "trace_id": row[7],
                        "session_id": row[8],
                        "account_id": row[9],
                        "api_key_id": row[10],
                        "client_ip": row[11],
                        "duration_ms": row[12],
                        "schema_ver": row[13],
                    })
                return items

        return await asyncio.to_thread(_execute)

    async def cleanup(self, retention_days: int | None = None) -> int:
        """Remove expired logs. Returns number of deleted rows."""
        days = retention_days if retention_days is not None else self._retention_days

        def _do_cleanup() -> int:
            with self._db_lock:
                return _cleanup_old(self._conn, days)

        return await asyncio.to_thread(_do_cleanup)

    def close(self) -> None:
        """Close the database connection."""
        self._conn.close()
