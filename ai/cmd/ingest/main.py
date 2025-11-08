"""Entry point for ingestion workers."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from .config import IngestConfig
from .consumers import kafka_iterator, process_events, redis_iterator, run_consumer
from .feature_store import FeatureStore

LOGGER = logging.getLogger("payhole.ingest")


async def _run(cfg: IngestConfig) -> None:
    store = FeatureStore(path=cfg.duckdb_path, parquet_dir=cfg.parquet_dir)

    if cfg.source == "kafka":
        if not cfg.kafka_bootstrap:
            raise RuntimeError("KAFKA_BOOTSTRAP_SERVERS is required for Kafka ingestion")
        async with kafka_iterator(cfg.kafka_bootstrap, cfg.kafka_topic or "telemetry.events") as iterator:
            await run_consumer("kafka", iterator, lambda batch: process_events(batch, store), cfg.batch_size)
    else:
        if not cfg.redis_url:
            raise RuntimeError("REDIS_URL is required for Redis ingestion")
        async with redis_iterator(cfg.redis_url, cfg.redis_stream or "telemetry-events") as iterator:
            await run_consumer("redis", iterator, lambda batch: process_events(batch, store), cfg.batch_size)


def main() -> None:
    parser = argparse.ArgumentParser(description="Payhole telemetry ingestion worker")
    parser.add_argument("--config", help="Optional JSON config path")
    args = parser.parse_args()

    if args.config:
        with open(args.config, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        cfg = IngestConfig(**data)
    else:
        cfg = IngestConfig.from_env()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    asyncio.run(_run(cfg))


if __name__ == "__main__":  # pragma: no cover
    main()
