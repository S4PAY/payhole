"""Simple drift monitor comparing latest and production metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_metrics(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description="Check model drift")
    parser.add_argument("--models", default=str(Path(__file__).resolve().parents[2] / "models"))
    parser.add_argument("--threshold", type=float, default=0.05, help="Maximum allowed AUC drop")
    args = parser.parse_args()

    model_root = Path(args.models)
    production = load_metrics(model_root / "production" / "metrics.json")
    latest = load_metrics(model_root / "latest" / "metrics.json")

    prod_auc = float(production.get("auc", 0))
    latest_auc = float(latest.get("auc", 0))

    if prod_auc == 0:
        print(json.dumps({"status": "no-production-model"}))
        return

    delta = prod_auc - latest_auc
    status = "ok" if delta <= args.threshold else "alert"
    print(json.dumps({"status": status, "production": prod_auc, "latest": latest_auc, "delta": delta}))


if __name__ == "__main__":  # pragma: no cover
    main()
