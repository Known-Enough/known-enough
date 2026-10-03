#!/usr/bin/env python3
"""Add one user-authorized final start without restoring either spent start."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ACCOUNT = "092954139775"
TABLE = "KnownEnoughQaControl"
DAY = "2026-10-03"
AUTH_EXPIRY = "2026-10-09T03:16:41.171626Z"
EXTRA_EXPIRY = "2026-10-04T00:00:00Z"
EXTRA_KEY = "EXTRA#" + DAY
TOTAL_CEILINGS = {"maxRunsTotal": 28, "maxTokensTotal": 7000000,
                  "maxCostMicrosTotal": 7000000, "maxSignupMessagesTotal": 56}


def aws(service, operation, **parameters):
    args = ["aws", service, operation, "--region", "us-east-1", "--output", "json", "--no-cli-pager"]
    for name, value in parameters.items():
        args += ["--" + name.replace("_", "-"), value if isinstance(value, str) else json.dumps(value)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=60,
                            env={**os.environ, "AWS_MAX_ATTEMPTS": "1", "AWS_PAGER": ""})
    if result.returncode:
        match = re.search(r"An error occurred \(([A-Za-z][A-Za-z0-9]+)\) when calling", result.stderr)
        error_code = match.group(1) if match else "Unknown"
        raise ValueError("AWS_OPERATION_FAILED:" + service + ":" + operation + ":" + error_code)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def key(name):
    return {"PK": {"S": name}, "SK": {"S": "STATE"}}


def value(item):
    return json.loads(item["payload"]["S"])


def read(call, name):
    try:
        return call("dynamodb", "get-item", table_name=TABLE, key=key(name), consistent_read=True).get("Item")
    except ValueError as error:
        prefix = "AWS_OPERATION_FAILED:dynamodb:get-item:"
        if str(error).startswith(prefix):
            raise ValueError(str(error) + ":KEY=" + name) from None
        raise


def cumulative_caps(a):
    present = [name for name in TOTAL_CEILINGS if name in a]
    if present and len(present) != len(TOTAL_CEILINGS):
        raise ValueError("CUMULATIVE_CEILINGS_CHANGED")
    runs = min(28, a["maxRunsPerDay"] * 7)
    caps = ({name: a[name] for name in TOTAL_CEILINGS} if present else {
        "maxRunsTotal": runs,
        "maxTokensTotal": min(7000000, runs * a["maxTokensPerRun"]),
        "maxCostMicrosTotal": min(7000000, runs * a["maxCostMicrosPerRun"]),
        "maxSignupMessagesTotal": min(56, a["maxSignupMessagesPerDay"] * 7)})
    if not all(type(caps[name]) is int and 0 < caps[name] <= limit for name, limit in TOTAL_CEILINGS.items()):
        raise ValueError("CUMULATIVE_CEILINGS_CHANGED")
    return caps


def install(call, now, home, apply=False, clock=None):
    clock = clock or (lambda: datetime.datetime.now(datetime.timezone.utc))

    def require(condition, reason):
        if not condition:
            raise ValueError(reason)

    require(now.date().isoformat() == DAY and now < datetime.datetime.fromisoformat(EXTRA_EXPIRY.replace("Z", "+00:00")),
            "ONE_TIME_APPROVAL_EXPIRED")
    require(call("sts", "get-caller-identity").get("Account") == ACCOUNT, "WRONG_AWS_ACCOUNT")
    table = call("dynamodb", "describe-table", table_name=TABLE)["Table"]
    require(table["TableArn"] == f"arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/{TABLE}"
            and table["TableStatus"] == "ACTIVE", "WRONG_OR_INACTIVE_TABLE")

    names = ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL", EXTRA_KEY]
    records = {name: read(call, name) for name in names}
    require(all(records[name] is not None for name in names), "MISSING_CONTROL_RECORD")
    a, lease, daily, total, extra = [value(records[name]) for name in names]
    require(a.get("approved") is True and a.get("retentionReviewed") is True
            and a.get("invocationLoggingDisabled") is True and a.get("expiresAt") == AUTH_EXPIRY
            and datetime.datetime.fromisoformat(a["expiresAt"].replace("Z", "+00:00")) > now
            and a.get("maxRunsPerDay") == 4, "ORIGINAL_APPROVAL_CHANGED")
    require(all(type(a.get(k)) is int and 0 < a[k] <= v for k, v in
                {"maxAttemptsPerRun": 200, "maxTokensPerRun": 250000, "maxCostMicrosPerRun": 250000,
                 "maxSignupMessagesPerRun": 2, "maxSignupMessagesPerDay": 8}.items()), "PER_RUN_CEILINGS_CHANGED")
    caps = cumulative_caps(a)
    require(lease.get("status") == "CLEAN", "CLEANUP_REQUIRED_FIRST")

    common = {"schemaVersion": 1, "day": DAY, "actor": "Battosai1806", "baseRuns": 4,
              "authorizationVersion": int(records["AUTH"]["version"]["N"]),
              "authorizationExpiresAt": AUTH_EXPIRY, "expiresAt": EXTRA_EXPIRY}
    prior_actor = "martelaxe" if extra.get("additionalRuns") == 2 else "Battosai1806"
    require(set(extra) == set(common) | {"additionalRuns", "usedRuns"}
            and all(extra[k] == v for k, v in common.items() if k != "actor")
            and extra.get("actor") == prior_actor, "EXTRA_ALLOWANCE_DRIFT")
    require(type(daily.get("runs")) is int and daily["runs"] == 4 + extra.get("usedRuns", -100)
            and type(daily.get("messages")) is int and 0 <= daily["messages"] <= a["maxSignupMessagesPerDay"],
            "DAILY_USAGE_CHANGED")

    if extra.get("additionalRuns") == 3 and extra.get("usedRuns") in (2, 3):
        require(extra.get("actor") == "Battosai1806", "EXTRA_ALLOWANCE_DRIFT")
        return {"status": "THIRD_RUN_ALREADY_APPROVED_FOR_B", "remaining": 3 - extra["usedRuns"],
                "expiresAt": EXTRA_EXPIRY, "cloudWrites": False}
    require(extra.get("additionalRuns") == 2 and extra.get("usedRuns") == 2
            and extra.get("actor") == "martelaxe", "EXTRA_ALLOWANCE_DRIFT")
    desired = {**common, "additionalRuns": 3, "usedRuns": 2}
    require(daily["messages"] + a["maxSignupMessagesPerRun"] <= a["maxSignupMessagesPerDay"],
            "DAILY_EMAIL_BUDGET_INSUFFICIENT")
    for field, cap, auth_field in [("runs", "maxRunsTotal", None),
                                   ("reservedTokens", "maxTokensTotal", "maxTokensPerRun"),
                                   ("reservedCostMicros", "maxCostMicrosTotal", "maxCostMicrosPerRun"),
                                   ("messages", "maxSignupMessagesTotal", "maxSignupMessagesPerRun")]:
        delta = 1 if auth_field is None else a[auth_field]
        require(type(total.get(field)) is int and 0 <= total[field] + delta <= caps[cap],
                "CUMULATIVE_BUDGET_INSUFFICIENT")
    folder = Path(home) / "known-enough-third-extra-run" / DAY
    if not apply:
        return {"status": "THIRD_RUN_PREPARED_FOR_B", "remaining": 1, "expiresAt": EXTRA_EXPIRY, "cloudWrites": False}

    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder.chmod(0o700)
    snapshot = folder / "before-private.json"
    encoded = json.dumps(records, sort_keys=True)
    if not snapshot.exists():
        fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(encoded)
    else:
        require(json.loads(snapshot.read_text()) == records, "SAVED_BASELINE_DRIFT")

    checks = []
    for name in names[:-1]:
        checks.append({"ConditionCheck": {"TableName": TABLE, "Key": key(name),
                       "ConditionExpression": "#v=:v", "ExpressionAttributeNames": {"#v": "version"},
                       "ExpressionAttributeValues": {":v": records[name]["version"]}}})
    version = int(records[EXTRA_KEY]["version"]["N"])
    checks.append({"Put": {"TableName": TABLE, "Item": {**key(EXTRA_KEY), "payload": {"S": json.dumps(desired)},
                   "version": {"N": str(version + 1)}}, "ConditionExpression": "#v=:v",
                   "ExpressionAttributeNames": {"#v": "version"},
                   "ExpressionAttributeValues": {":v": records[EXTRA_KEY]["version"]}}})
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, prefix="transaction-", suffix=".json", delete=False) as stream:
        os.chmod(stream.name, 0o600)
        json.dump({"TransactItems": checks}, stream)
        payload = Path(stream.name)
    try:
        require(clock().date().isoformat() == DAY and clock() < datetime.datetime.fromisoformat(EXTRA_EXPIRY.replace("Z", "+00:00")),
                "ONE_TIME_APPROVAL_EXPIRED")
        call("dynamodb", "transact-write-items", cli_input_json="file://" + str(payload))
    finally:
        payload.unlink(missing_ok=True)

    after = {name: read(call, name) for name in names}
    require(all(after[name] == records[name] for name in names[:-1]), "UNCHANGED_RECORD_READBACK_FAILED")
    result = after[EXTRA_KEY]
    require(result is not None and int(result["version"]["N"]) == version + 1
            and value(result) == desired, "ALLOWANCE_READBACK_FAILED")
    return {"status": "THIRD_RUN_APPROVED_FOR_B", "remaining": 1, "expiresAt": EXTRA_EXPIRY, "cloudWrites": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(install(aws, datetime.datetime.now(datetime.timezone.utc), Path.home(), args.apply)))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        safe = {"ONE_TIME_APPROVAL_EXPIRED", "WRONG_AWS_ACCOUNT", "WRONG_OR_INACTIVE_TABLE", "MISSING_CONTROL_RECORD",
                "ORIGINAL_APPROVAL_CHANGED", "PER_RUN_CEILINGS_CHANGED", "CUMULATIVE_CEILINGS_CHANGED",
                "CLEANUP_REQUIRED_FIRST", "EXTRA_ALLOWANCE_DRIFT", "DAILY_USAGE_CHANGED",
                "DAILY_EMAIL_BUDGET_INSUFFICIENT", "CUMULATIVE_BUDGET_INSUFFICIENT", "SAVED_BASELINE_DRIFT",
                "UNCHANGED_RECORD_READBACK_FAILED", "ALLOWANCE_READBACK_FAILED"}
        safe.update("AWS_OPERATION_FAILED:" + s + ":" + op for s, op in
                    [("sts", "get-caller-identity"), ("dynamodb", "describe-table"), ("dynamodb", "get-item"),
                     ("dynamodb", "transact-write-items")])
        code = str(error) if isinstance(error, ValueError) and str(error) in safe else "THIRD_RUN_APPROVAL_CHECK_FAILED"
        if isinstance(error, ValueError) and re.fullmatch(
                r"AWS_OPERATION_FAILED:(?:sts:get-caller-identity:[A-Za-z0-9]+|"
                r"dynamodb:(?:describe-table:[A-Za-z0-9]+|get-item:[A-Za-z0-9]+:KEY=(?:AUTH|LEASE|DAY#2026-10-03|TOTAL|EXTRA#2026-10-03)|transact-write-items:[A-Za-z0-9]+))",
                str(error)):
            code = str(error)
        print(json.dumps({"status": "BLOCKED", "code": code}))
        raise SystemExit(1)
