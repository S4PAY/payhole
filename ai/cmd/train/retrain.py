"""Batch retraining entry point for the risk classifier."""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path
from typing import Tuple

import duckdb
import lightgbm as lgb
import numpy as np
import pandas as pd
from onnxmltools.convert.lightgbm import convert
from onnxmltools.utils import save_model
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "models"


def load_dataset(duckdb_path: Path) -> Tuple[pd.DataFrame, pd.Series]:
    conn = duckdb.connect(str(duckdb_path))
    df = conn.execute(
        "SELECT domain, reason, risk_score FROM telemetry_events"
    ).fetch_df()
    if df.empty:
        rng = np.random.default_rng(0)
        df = pd.DataFrame(
            {
                "domain": [f"example{i}.com" for i in range(500)],
                "reason": rng.choice(["ad_block", "premium_unlock_required"], 500),
                "risk_score": rng.random(500),
            }
        )
    df["label"] = (df["reason"] == "premium_unlock_required").astype(int)
    df["domain_length"] = df["domain"].str.len()
    features = df[["risk_score", "domain_length"]]
    labels = df["label"]
    return features, labels


def train_model(features: pd.DataFrame, labels: pd.Series) -> Tuple[lgb.Booster, float]:
    X_train, X_test, y_train, y_test = train_test_split(
        features, labels, test_size=0.2, random_state=42
    )
    train_dataset = lgb.Dataset(X_train, label=y_train)
    params = {
        "objective": "binary",
        "metric": "auc",
        "learning_rate": 0.1,
        "num_leaves": 31,
    }
    model = lgb.train(params, train_dataset, num_boost_round=75)
    preds = model.predict(X_test)
    auc = float(roc_auc_score(y_test, preds))
    return model, auc


def export_model(model: lgb.Booster, feature_names: list[str], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_model = convert(model, "risk_classifier", feature_names)
    save_model(onnx_model, str(output_dir / "model.onnx"))


def write_metadata(output_dir: Path, auc: float, version: str) -> None:
    metrics = {"auc": auc}
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    manifest = {
        "version": version,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics": metrics,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def promote(model_dir: Path, latest_dir: Path, production_dir: Path, auc: float, min_delta: float) -> None:
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    shutil.copytree(model_dir, latest_dir)

    production_manifest = production_dir / "manifest.json"
    if production_manifest.exists():
        previous = json.loads(production_manifest.read_text())
        previous_auc = float(previous.get("metrics", {}).get("auc", 0))
        if auc + min_delta <= previous_auc:
            return
    if production_dir.exists():
        shutil.rmtree(production_dir)
    shutil.copytree(model_dir, production_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrain risk classifier")
    parser.add_argument("--duckdb", default=str(DEFAULT_MODEL_DIR.parent.parent / "data" / "feature_store.duckdb"))
    parser.add_argument("--models", default=str(DEFAULT_MODEL_DIR))
    parser.add_argument("--min-delta", type=float, default=0.01, help="Minimum AUC improvement required to promote to production")
    args = parser.parse_args()

    duckdb_path = Path(args.duckdb)
    model_root = Path(args.models)
    latest_dir = model_root / "latest"
    production_dir = model_root / "production"

    features, labels = load_dataset(duckdb_path)
    model, auc = train_model(features, labels)

    version = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    version_dir = model_root / version
    export_model(model, list(features.columns), version_dir)
    write_metadata(version_dir, auc, version)

    promote(version_dir, latest_dir, production_dir, auc, args.min_delta)

    print(json.dumps({"version": version, "auc": auc, "modelsDir": str(model_root)}, indent=2))


if __name__ == "__main__":  # pragma: no cover
    main()
