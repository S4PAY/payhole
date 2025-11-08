# Payhole AI Schemas

This directory contains canonical schema definitions shared across runtime services, ingestion
pipelines, and training notebooks. Protobuf definitions are kept alongside JSON Schema documents
for language-agnostic interoperability.

## Telemetry Event
- **Protobuf:** [`telemetry_event.proto`](./telemetry_event.proto)
- **JSON Schema:** [`telemetry_event.schema.json`](./telemetry_event.schema.json)

Represents a single decision emitted by the payments analytics buffer or proxy rule engine. Each
event captures the HTTP host, the decision reason, contextual metadata, and derived model scores.

## Classifier Service
- **Protobuf:** [`classifier.proto`](./classifier.proto)

Defines request/response contracts for both the HTTP/JSON and gRPC inference interfaces.
