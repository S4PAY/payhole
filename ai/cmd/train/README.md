# Training CLI

`retrain.py` loads feature data from DuckDB, trains a LightGBM model, exports it to ONNX, and promotes
artifacts into `ai/models/`. Production promotion occurs when the new model improves the AUC by at
least the configured delta.

```bash
pip install -r ai/cmd/classifier/requirements.txt
python ai/cmd/train/retrain.py --duckdb data/feature_store.duckdb
```
