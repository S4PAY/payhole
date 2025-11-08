"""Inference microservice exposing HTTP and gRPC endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from grpc import aio
from pydantic import BaseModel, Field

from . import classifier_pb2, classifier_pb2_grpc

LOGGER = logging.getLogger("payhole.classifier")


class PredictionRequest(BaseModel):
    request_id: str = Field(..., description="Unique identifier for the inference request")
    domain: str
    risk_score: float | None = None
    numerical: Dict[str, float] = Field(default_factory=dict)
    categorical: Dict[str, str] = Field(default_factory=dict)


class ModelWrapper:
    def __init__(self, model_path: Path, model_version: str = "dev", threshold: float = 0.5):
        if not model_path.exists():
            raise FileNotFoundError(f"model not found at {model_path}")
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        self.model_version = model_version
        self.threshold = threshold

    def predict(self, features: Dict[str, float]) -> tuple[float, str]:
        if not features:
            raise ValueError("No numerical features provided")
        ordered = sorted(features)
        vector = np.array([features[key] for key in ordered], dtype=np.float32).reshape(1, -1)
        inputs = {self.input_name: vector}
        outputs = self.session.run([self.output_name], inputs)
        score = float(outputs[0][0])
        label = "allow" if score < self.threshold else "block"
        return score, label


def build_feature_vector(payload: PredictionRequest) -> Dict[str, float]:
    features: Dict[str, float] = {}
    if payload.risk_score is not None:
        features["risk_score"] = payload.risk_score
    features.update(payload.numerical)
    if "domain_length" not in features:
        features["domain_length"] = float(len(payload.domain))
    return features


class ClassifierService(classifier_pb2_grpc.ClassifierServicer):
    def __init__(self, model: ModelWrapper):
        self.model = model

    async def Predict(self, request: classifier_pb2.ClassificationRequest, context: aio.ServicerContext):
        payload = PredictionRequest(
            request_id=request.request_id or "",
            domain=request.features.domain,
            risk_score=request.features.risk_score or None,
            numerical=dict(request.features.numerical),
            categorical=dict(request.features.categorical),
        )
        features = build_feature_vector(payload)
        score, label = self.model.predict(features)
        return classifier_pb2.ClassificationResponse(
            request_id=payload.request_id,
            score=score,
            label=label,
            model_version=self.model.model_version,
        )


def create_app(model: ModelWrapper) -> FastAPI:
    app = FastAPI(title="Payhole Risk Classifier", version=model.model_version)

    @app.post("/v1/predict")
    async def predict_endpoint(request: PredictionRequest) -> JSONResponse:
        try:
            features = build_feature_vector(request)
            score, label = model.predict(features)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        telemetry = {
            "requestId": request.request_id,
            "domain": request.domain,
            "features": features,
            "score": score,
            "label": label,
        }
        LOGGER.info("prediction: %s", json.dumps(telemetry))
        return JSONResponse(
            {
                "requestId": request.request_id,
                "score": score,
                "label": label,
                "modelVersion": model.model_version,
            }
        )

    return app


async def serve_grpc(model: ModelWrapper, host: str = "0.0.0.0", port: int = 9095) -> aio.Server:
    server = aio.server()
    classifier_pb2_grpc.add_ClassifierServicer_to_server(ClassifierService(model), server)
    server.add_insecure_port(f"{host}:{port}")
    return server


async def run_all(model_path: Path, model_version: str, http_port: int = 8000, grpc_port: int = 9095) -> None:
    model = ModelWrapper(model_path, model_version=model_version)
    app = create_app(model)
    import uvicorn

    grpc_server = await serve_grpc(model, port=grpc_port)
    await grpc_server.start()
    LOGGER.info("gRPC classifier listening on %s", grpc_port)

    config = uvicorn.Config(app, host="0.0.0.0", port=http_port, log_level="info")
    server = uvicorn.Server(config)

    await server.serve()
    await grpc_server.wait_for_termination()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    model_dir = Path(__file__).resolve().parents[2] / "models" / "latest"
    model_path = model_dir / "model.onnx"
    version_path = model_dir / "manifest.json"
    version = "dev"
    if version_path.exists():
        try:
            version = json.loads(version_path.read_text()).get("version", version)
        except json.JSONDecodeError:
            pass
    asyncio.run(run_all(model_path, version))


if __name__ == "__main__":  # pragma: no cover
    main()
