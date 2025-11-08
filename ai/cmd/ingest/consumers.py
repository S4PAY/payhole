"""Stream consumers for Kafka and Redis."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, Iterable

from .feature_store import FeatureStore

Event = dict[str, Any]
BatchHandler = Callable[[list[Event]], None]


async def run_consumer(source: str, iterator: AsyncIterator[Event], handler: BatchHandler, batch_size: int) -> None:
    batch: list[Event] = []
    async for event in iterator:
        batch.append(event)
        if len(batch) >= batch_size:
            handler(batch)
            batch.clear()
    if batch:
        handler(batch)


@asynccontextmanager
async def kafka_iterator(bootstrap_servers: str, topic: str) -> AsyncIterator[AsyncIterator[Event]]:
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("aiokafka is required for Kafka ingestion") from exc

    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=bootstrap_servers,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )
    await consumer.start()

    async def iterate() -> AsyncIterator[Event]:
        try:
            async for msg in consumer:
                yield msg.value
        finally:
            await consumer.stop()

    yield iterate()


@asynccontextmanager
async def redis_iterator(url: str, stream: str) -> AsyncIterator[AsyncIterator[Event]]:
    try:
        from redis import asyncio as redis_async
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("redis asyncio client is required for Redis ingestion") from exc

    client = redis_async.from_url(url)

    async def iterate() -> AsyncIterator[Event]:
        last_id = "$"
        while True:
            response = await client.xread({stream: last_id}, block=5000, count=100)
            if not response:
                await asyncio.sleep(0.1)
                continue
            for _, messages in response:
                for message_id, payload in messages:
                    last_id = message_id
                    data = {k.decode(): json.loads(v) if isinstance(v, (bytes, bytearray)) else v for k, v in payload.items()}
                    yield data

    try:
        yield iterate()
    finally:
        await client.close()


def process_events(events: Iterable[Event], store: FeatureStore) -> None:
    store.ingest_batch(list(events))
