"""Recover the actual private owner package; never rebuild or replace its signing key."""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import time
import zipfile
from pathlib import Path

ACCOUNT = "092954139775"
BUCKET = "known-enough-qa-artifacts-092954139775"
FUNCTION = "known-enough-stage-api"
OWNER_SOURCE = "1ebfdcdabb99a9fa7dd506643633f946d4e22cf8"
INCORRECT_CODE = "e82d83901840372648e6494ee5663a9a6025715b2c91675c48e56882f4991b36"


def verify_archive(data, key):
    digest = hashlib.sha256(data).hexdigest()
    if key != digest + "/api.zip" or len(data) > 50 * 1024 * 1024:
        raise ValueError("RECOVERY_HASH_MISMATCH")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = ["api.mjs", "configuration-private.json", "manifest-private.json", "release-private.json", "lifecycle-private.json"]
        if sorted(archive.namelist()) != sorted(names) or sum(i.file_size for i in archive.infolist()) > 50 * 1024 * 1024:
            raise ValueError("RECOVERY_ARCHIVE_INVALID")
        lifecycle = json.loads(archive.read("lifecycle-private.json"))
        if set(lifecycle) != {"schemaVersion", "sourceSha", "signingKeyBase64"} or lifecycle["schemaVersion"] != 1 or lifecycle["sourceSha"] != OWNER_SOURCE:
            raise ValueError("RECOVERY_SOURCE_INVALID")
        secret = base64.b64decode(lifecycle["signingKeyBase64"], validate=True)
        if len(secret) != 32 or not any(secret) or base64.b64encode(secret).decode() != lifecycle["signingKeyBase64"]:
            raise ValueError("RECOVERY_KEY_INVALID")
        configuration = json.loads(archive.read("configuration-private.json"))
        if configuration.get("account") != ACCOUNT or configuration.get("region") != "us-east-1" or configuration.get("userPoolId") != "us-east-1_V9OMjd0zx":
            raise ValueError("RECOVERY_TARGET_INVALID")
    return digest


def verify_target(config):
    env = config.get("Environment", {}).get("Variables", {})
    if config.get("FunctionArn") != "arn:aws:lambda:us-east-1:" + ACCOUNT + ":function:" + FUNCTION or config.get("Role") != "arn:aws:iam::" + ACCOUNT + ":role/KnownEnoughStageApiRole":
        raise ValueError("PRIMARY_TARGET_INVALID")
    if config.get("Handler") != "api.handler" or config.get("Runtime") != "nodejs24.x" or env.get("KE14_MODEL_MODE") != "DISABLED" or env.get("KE14_PAID_CALLS_APPROVED") != "false" or env.get("NP_GROUP_TABLE_NAME") != "KnownEnoughGroupsStage":
        raise ValueError("PRIMARY_CONFIGURATION_CHANGED")
    if config.get("State") != "Active" or config.get("LastUpdateStatus") != "Successful" or not config.get("RevisionId"):
        raise ValueError("PRIMARY_NOT_SETTLED")


def verify_readback(previous, current, digest):
    verify_target(current)
    if current["CodeSha256"] != base64.b64encode(bytes.fromhex(digest)).decode():
        raise ValueError("PRIMARY_RECOVERY_NOT_CONFIRMED")
    for field in ("Environment", "Role", "Handler", "Runtime", "MemorySize", "Timeout", "Layers", "VpcConfig"):
        if previous.get(field) != current.get(field):
            raise ValueError("PRIMARY_CONFIGURATION_CHANGED")


def verify_runtime_binding(data, current):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        configuration = json.loads(archive.read("configuration-private.json"))
    env = current.get("Environment", {}).get("Variables", {})
    fields = {"userPoolId":"COGNITO_USER_POOL_ID", "participantClientId":"COGNITO_PARTICIPANT_CLIENT_ID",
              "displayClientId":"COGNITO_DISPLAY_CLIENT_ID", "allowedOrigin":"KE13B_ALLOWED_ORIGIN",
              "emailKey":"NP_GROUP_EMAIL_KEY", "cognitoDomain":"NP_COGNITO_DOMAIN"}
    if any(not isinstance(configuration.get(field), str) or configuration[field] != env.get(variable) for field, variable in fields.items()):
        raise ValueError("RECOVERY_PRIVATE_CONFIGURATION_DRIFT")


def main(apply):
    os.umask(0o077)
    folder = Path.home() / ".known-enough/ops03-primary-recovery"
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)

    def aws(service, action, *args):
        result = subprocess.run(["aws", service, action, *args, "--region", "us-east-1", "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "15"], capture_output=True, text=True, timeout=25)
        if result.returncode:
            (folder / "last-error-private.txt").write_text(result.stderr)
            match = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", result.stderr)
            raise ValueError("AWS_REQUEST_FAILED:" + service + ":" + action + ":" + (match.group(1) if match else "UNCLASSIFIED"))
        return json.loads(result.stdout) if result.stdout.strip() else {}

    identity = aws("sts", "get-caller-identity")
    if identity.get("Account") != ACCOUNT:
        raise ValueError("WRONG_ACCOUNT")
    objects = aws("s3api", "list-objects-v2", "--bucket", BUCKET, "--page-size", "100", "--max-items", "1000")
    if objects.get("NextToken"):
        raise ValueError("RECOVERY_LIST_INCOMPLETE")
    matches = []
    for item in objects.get("Contents", []):
        date = item.get("LastModified", "")
        if not ("2026-10-11T06:12:27" <= date[:19] <= "2026-10-11T06:13:11") or not re.fullmatch(r"[a-f0-9]{64}/api.zip", item.get("Key", "")):
            continue
        path = folder / (item["Key"].split("/")[0] + ".zip")
        aws("s3api", "get-object", "--bucket", BUCKET, "--key", item["Key"], str(path))
        matches.append((verify_archive(path.read_bytes(), item["Key"]), path))
    if len(matches) != 1:
        raise ValueError("EXACT_OWNER_RECOVERY_NOT_IDENTIFIED")
    digest, path = matches[0]
    current = aws("lambda", "get-function-configuration", "--function-name", FUNCTION)
    verify_target(current)
    verify_runtime_binding(path.read_bytes(), current)
    expected = base64.b64encode(bytes.fromhex(digest)).decode()
    if current["CodeSha256"] == expected:
        return {"result": "OPERATIONS_PRIMARY_ALREADY_RESTORED", "codeSha256": digest, "mutations": 0, "dataChanges": 0}
    if current["CodeSha256"] != base64.b64encode(bytes.fromhex(INCORRECT_CODE)).decode():
        raise ValueError("PRIMARY_CODE_CHANGED_SINCE_OBSERVED_FAILURE")
    (folder / "observed-primary-private.json").write_text(json.dumps(current))
    if not apply:
        return {"result": "OPERATIONS_PRIMARY_RECOVERY_READY", "codeSha256": digest, "mutations": 0, "dataChanges": 0}
    try:
        aws("lambda", "update-function-code", "--function-name", FUNCTION, "--s3-bucket", BUCKET, "--s3-key", digest + "/api.zip", "--revision-id", current["RevisionId"])
    except (ValueError, subprocess.TimeoutExpired):
        # Resolve the acknowledgement by readback; never issue a second upload in this invocation.
        pass
    for _ in range(20):
        observed = aws("lambda", "get-function-configuration", "--function-name", FUNCTION)
        if observed.get("CodeSha256") == expected and observed.get("LastUpdateStatus") == "Successful" and observed.get("State") == "Active":
            verify_readback(current, observed, digest)
            return {"result": "OPERATIONS_PRIMARY_RESTORED", "sourceSha": OWNER_SOURCE, "codeSha256": digest, "mutations": 1, "dataChanges": 0, "modelFlags": "UNCHANGED_DISABLED"}
        if observed.get("CodeSha256") not in (expected, current["CodeSha256"]):
            raise ValueError("PRIMARY_CODE_CHANGED_DURING_RECOVERY")
        time.sleep(2)
    raise ValueError("PRIMARY_RECOVERY_UNCONFIRMED_DO_NOT_REPEAT_BLINDLY")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(main(args.apply)))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z0-9_:a-z-]+", str(error)) else "PRIMARY_RECOVERY_UNVERIFIED"
        print(json.dumps({"result": "BLOCKED", "code": code, "dataChanges": 0}))
        raise SystemExit(1)
