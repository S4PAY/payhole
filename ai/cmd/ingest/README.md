# Telemetry Ingestion Workers

These workers consume telemetry events emitted by the payments service and proxy, landing them into a
DuckDB feature store as well as hourly Parquet snapshots. The workers support Kafka topics or Redis
Streams and share schema definitions from `ai/pkg/schema`.

```bash
pip install -r ai/cmd/ingest/requirements.txt
INGEST_SOURCE=kafka KAFKA_BOOTSTRAP_SERVERS=localhost:9092 python -m ai.cmd.ingest.main
```
