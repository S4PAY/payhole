"""Runtime configuration helpers for ingestion workers."""

from __future__ import annotations

import dataclasses
import os
from typing import Literal

SourceType = Literal["kafka", "redis"]


@dataclasses.dataclass(frozen=True)
class IngestConfig:
    source: SourceType
    kafka_bootstrap: str | None = None
    kafka_topic: str | None = None
    redis_url: str | None = None
    redis_stream: str | None = None
    duckdb_path: str = "data/feature_store.duckdb"
    parquet_dir: str = "data/features"
    batch_size: int = 512

    @classmethod
    def from_env(cls) -> "IngestConfig":
        source = os.environ.get("INGEST_SOURCE", "kafka").lower()
        if source not in {"kafka", "redis"}:
            raise ValueError("INGEST_SOURCE must be either 'kafka' or 'redis'")

        return cls(
            source=source,  # type: ignore[arg-type]
            kafka_bootstrap=os.environ.get("KAFKA_BOOTSTRAP_SERVERS"),
            kafka_topic=os.environ.get("KAFKA_TOPIC", "telemetry.events"),
            redis_url=os.environ.get("REDIS_URL"),
            redis_stream=os.environ.get("REDIS_STREAM", "telemetry-events"),
            duckdb_path=os.environ.get("DUCKDB_PATH", "data/feature_store.duckdb"),
            parquet_dir=os.environ.get("PARQUET_DIR", "data/features"),
            batch_size=int(os.environ.get("BATCH_SIZE", "512")),
        )
