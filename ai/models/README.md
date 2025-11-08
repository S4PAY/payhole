# Model Registry

Trained classifiers are versioned in this directory. Training jobs write artifacts into a
`<timestamp>/` folder before promoting a copy to `latest/`. Each run includes:

- `model.onnx` — exported inference graph
- `metrics.json` — evaluation metrics captured during training
- `manifest.json` — metadata used for drift monitoring
