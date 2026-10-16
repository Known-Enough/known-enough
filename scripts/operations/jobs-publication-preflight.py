"""Read-only queue check before replacing API/worker packages; never invoke AI."""
import json
import os
from pathlib import Path
import re
import subprocess

report = {"result":"BLOCKED", "awsWrites":0, "providerCalls":0}

def call(*args):
    result = subprocess.run(["aws", *args, "--region", "us-east-1", "--output", "json", "--no-cli-pager"],
                            capture_output=True, text=True, timeout=25)
    if result.returncode:
        raise ValueError("PREFLIGHT_READ_UNAVAILABLE")
    return json.loads(result.stdout or "{}")

try:
    previous = os.environ["PREVIOUS_JOB_SOURCE"]
    if not re.fullmatch(r"[a-f0-9]{40}", previous) or previous == "0" * 40:
        raise ValueError("PREVIOUS_SOURCE_REQUIRED")
    identity = call("sts", "get-caller-identity")
    if identity.get("Account") != "092954139775" or not identity.get("Arn", "").startswith(
            "arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/"):
        raise ValueError("PREFLIGHT_ROLE_REQUIRED")
    row = call("dynamodb", "get-item", "--table-name", "KnownEnoughOperationsJournal",
               "--key", json.dumps({"PK":{"S":"OPERATIONS#MODEL_JOBS"},"SK":{"S":"STATE"}}),
               "--consistent-read").get("Item", {})
    control = json.loads(row["payload"]["S"])
    if (set(control) != {"schemaVersion","revision","enabled","sourceSha","active","slots"}
            or control["schemaVersion"] != 1 or type(control["revision"]) is not int
            or control["revision"] < 1 or row["revision"]["N"] != str(control["revision"])
            or control["sourceSha"] != previous):
        raise ValueError("PREFLIGHT_CONTROL_CHANGED")
    if control["enabled"] is not False or control["active"] != [] or control["slots"] != []:
        raise ValueError("DISABLE_AND_RESOLVE_QUEUE_BEFORE_CODE_PUBLICATION")
    report.update(result="DISABLED_EMPTY_QUEUE_PREPUBLICATION_PASS", sourceSha=previous)
except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
    report["code"] = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]+", str(error)) else "PREFLIGHT_UNAVAILABLE"
Path(os.environ["RUNNER_TEMP"], "partition-job-preflight-report.json").write_text(json.dumps(report)+"\n")
print(json.dumps(report))
if report["result"] == "BLOCKED":
    raise SystemExit(1)
