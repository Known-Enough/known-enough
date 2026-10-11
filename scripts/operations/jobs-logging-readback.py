"""Finite readback only; never expose provider logging destinations or CLI stderr."""
import json
import os
import re
import subprocess
from pathlib import Path


def logging_summary(returncode, stdout, stderr, source):
    disabled = False
    code = None
    if returncode:
        match = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", stderr)
        code = match.group(1) if match else "AWS_REQUEST_FAILED"
    else:
        try:
            # The CLI emits no body when the successful API response has no loggingConfig.
            response = json.loads(stdout) if stdout.strip() else {}
            if not isinstance(response, dict):
                raise ValueError()
            config = response.get("loggingConfig")
            if config is None:
                disabled = True
            elif isinstance(config, dict):
                flags = [config.get(key) for key in (
                    "textDataDeliveryEnabled", "imageDataDeliveryEnabled",
                    "embeddingDataDeliveryEnabled", "videoDataDeliveryEnabled")]
                disabled = all(value is False or value is None for value in flags)
            else:
                raise ValueError()
        except (ValueError, TypeError):
            code = "AWS_RESPONSE_INVALID"
    return {"sourceSha": source, "result": "PROVIDER_LOGGING_DISABLED" if disabled else "PROVIDER_LOGGING_UNVERIFIED_OR_ENABLED",
            "code": code, "providerCalls": 0}


if __name__ == "__main__":
    source = os.environ["GITHUB_SHA"]
    assert re.fullmatch(r"[a-f0-9]{40}", source)
    result = subprocess.run([
        "aws", "bedrock", "get-model-invocation-logging-configuration",
        "--region", "us-east-1", "--endpoint-url", "https://bedrock.us-east-1.amazonaws.com",
        "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "10"
    ], capture_output=True, text=True, timeout=20)
    report = logging_summary(result.returncode, result.stdout, result.stderr, source)
    (Path(os.environ["RUNNER_TEMP"]) / "model-job-logging-report.json").write_text(json.dumps(report) + "\n")
    if report["result"] != "PROVIDER_LOGGING_DISABLED":
        raise SystemExit(report["result"])
