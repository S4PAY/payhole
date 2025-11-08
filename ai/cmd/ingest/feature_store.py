"""DuckDB-backed feature store writers."""

from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import dataclass, field
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

TELEMETRY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS telemetry_events (
    id TEXT PRIMARY KEY,
    domain TEXT,
    reason TEXT,
    source TEXT,
    policy_version TEXT,
    risk_score DOUBLE,
    hashed_user_id TEXT,
    client_ip TEXT,
    user_agent TEXT,
    timestamp TIMESTAMP
)
"""


@dataclass
class FeatureStore:
    path: str
    parquet_dir: str
    connection: duckdb.DuckDBPyConnection = field(init=False)

    def __post_init__(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.connection = duckdb.connect(self.path)
        self.connection.execute(TELEMETRY_TABLE_SQL)
        os.makedirs(self.parquet_dir, exist_ok=True)

    def ingest_batch(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return

        normalized = [self._normalise(event) for event in events]
        self.connection.execute(
            "INSERT OR REPLACE INTO telemetry_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            normalized,
        )
        table = pa.Table.from_pylist([self._to_arrow(event) for event in events])
        timestamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
        pq.write_table(table, os.path.join(self.parquet_dir, f"telemetry_{timestamp}.parquet"))

    def _normalise(self, event: dict[str, Any]) -> tuple[Any, ...]:
        return (
            event.get("id"),
            event.get("domain"),
            event.get("reason"),
            event.get("source"),
            event.get("policyVersion"),
            float(event.get("riskScore", 0.0)),
            event.get("hashedUserId"),
            event.get("clientIp"),
            event.get("userAgent"),
            dt.datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")),
        )

    def _to_arrow(self, event: dict[str, Any]) -> dict[str, Any]:
        enriched = dict(event)
        enriched.setdefault("riskScore", 0.0)
        enriched.setdefault("metadata", json.dumps({k: v for k, v in event.items() if k not in {"domain", "reason"}}))
        return enriched
