# Drift Monitoring

`drift.py` compares the AUC recorded for the production model with the most recent training run. CI
calls this script after retraining to determine if an alert should be raised.
