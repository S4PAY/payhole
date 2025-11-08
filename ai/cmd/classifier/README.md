# Risk Classifier Service

This microservice loads the latest exported ONNX model and exposes both HTTP and gRPC interfaces for
risk scoring. The HTTP endpoint accepts JSON payloads aligning with `ai/pkg/schema/classifier.proto`
while the gRPC service implements the same contract.

```bash
pip install -r ai/cmd/classifier/requirements.txt
python -m ai.cmd.classifier.server
```
