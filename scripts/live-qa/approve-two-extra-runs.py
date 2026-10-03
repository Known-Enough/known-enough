#!/usr/bin/env python3
"""Install only the dated, two-use B allowance. Never change AUTH or usage."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile

ACCOUNT = "092954139775"
TABLE = "KnownEnoughQaControl"
DAY = "2026-10-03"
EXPIRY = "2026-10-09T03:16:41.171626Z"
EXTRA_KEY = "EXTRA#" + DAY


def aws(service, operation, **parameters):
    arguments = ["aws", service, operation, "--region", "us-east-1", "--output", "json", "--no-cli-pager"]
    for name, value in parameters.items():
        if isinstance(value, bool):
            arguments.append("--" + ("" if value else "no-") + name.replace("_", "-"))
            continue
        arguments += ["--" + name.replace("_", "-"), value if isinstance(value, str) else json.dumps(value)]
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=60,
                            env={**os.environ, "AWS_MAX_ATTEMPTS": "1", "AWS_PAGER": ""})
    if result.returncode:
        raise ValueError("AWS_OPERATION_FAILED:" + service + ":" + operation)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def key(name):
    return {"PK": {"S": name}, "SK": {"S": "STATE"}}


def install(call, now, home, apply=False, clock=None):
    clock = clock or (lambda: datetime.datetime.now(datetime.timezone.utc))
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)

    require(now.date().isoformat() == DAY, "ONE_TIME_APPROVAL_DAY_ENDED")
    require(call("sts", "get-caller-identity").get("Account") == ACCOUNT, "WRONG_AWS_ACCOUNT")
    table = call("dynamodb", "describe-table", table_name=TABLE)["Table"]
    require(table["TableArn"] == f"arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/{TABLE}"
            and table["TableStatus"] == "ACTIVE", "WRONG_OR_INACTIVE_TABLE")
    records = {}
    for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL", EXTRA_KEY]:
        records[name] = call("dynamodb", "get-item", table_name=TABLE, key=key(name), consistent_read=True).get("Item")
    def value(name):
        require(records[name] is not None, "MISSING_CONTROL_RECORD")
        return json.loads(records[name]["payload"]["S"])
    a, lease, daily, total = (value(name) for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL"])
    require(a.get("approved") is True and a.get("retentionReviewed") is True
            and a.get("invocationLoggingDisabled") is True and a.get("expiresAt") == EXPIRY
            and a.get("maxRunsPerDay") == 4, "ORIGINAL_APPROVAL_CHANGED")
    caps = {"maxRunsTotal": 28, "maxTokensTotal": 7000000, "maxCostMicrosTotal": 7000000, "maxSignupMessagesTotal": 56}
    require(all(a.get(k) == v for k, v in caps.items()), "CUMULATIVE_CEILINGS_CHANGED")
    require(all(type(a.get(k)) is int and 0 < a[k] <= v for k, v in
                {"maxAttemptsPerRun": 200, "maxTokensPerRun": 250000, "maxCostMicrosPerRun": 250000,
                 "maxSignupMessagesPerRun": 2, "maxSignupMessagesPerDay": 8}.items()), "PER_RUN_CEILINGS_CHANGED")
    require(lease.get("status") == "CLEAN", "CLEANUP_REQUIRED_FIRST")
    desired = {"schemaVersion": 1, "day": DAY, "actor": "Battosai1806", "additionalRuns": 2,
               "usedRuns": 0, "baseRuns": 4, "authorizationVersion": int(records["AUTH"]["version"]["N"]),
               "authorizationExpiresAt": EXPIRY, "expiresAt": "2026-10-04T00:00:00Z"}
    existing = records[EXTRA_KEY]
    def valid_extra(item):
        v = json.loads(item["payload"]["S"])
        return (set(v) == set(desired) and all(v[k] == desired[k] for k in desired if k != "usedRuns")
                and type(v["usedRuns"]) is int and 0 <= v["usedRuns"] <= 2)
    if existing:
        require(valid_extra(existing), "EXTRA_ALLOWANCE_DRIFT")
        return {"status": "TWO_EXTRA_RUNS_ALREADY_APPROVED", "remaining": 2 - value(EXTRA_KEY)["usedRuns"], "cloudWrites": False}
    require(type(daily.get("runs")) is int and daily["runs"] == 4, "DAILY_USAGE_CHANGED")
    limits = {"runs": ("maxRunsTotal", 2), "reservedTokens": ("maxTokensTotal", 2 * a["maxTokensPerRun"]),
              "reservedCostMicros": ("maxCostMicrosTotal", 2 * a["maxCostMicrosPerRun"]),
              "messages": ("maxSignupMessagesTotal", 2 * a["maxSignupMessagesPerRun"])}
    require(all(type(total.get(k)) is int and total[k] >= 0 and total[k] + delta <= a[cap]
                for k, (cap, delta) in limits.items()), "CUMULATIVE_BUDGET_INSUFFICIENT")
    require(type(daily.get("messages")) is int and daily["messages"] >= 0
            and daily["messages"] + 2 * a["maxSignupMessagesPerRun"] <= a["maxSignupMessagesPerDay"], "DAILY_EMAIL_BUDGET_INSUFFICIENT")
    if not apply:
        return {"status": "TWO_EXTRA_RUNS_PREPARED", "cloudWrites": False}
    folder = Path(home) / "known-enough-two-extra-runs" / DAY
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder.chmod(0o700)
    snapshot = folder / "original-private.json"
    if not snapshot.exists():
        fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(records, f)
    else:
        require(json.loads(snapshot.read_text()) == records, "SAVED_BASELINE_DRIFT")
    checks = []
    for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL"]:
        checks.append({"ConditionCheck": {"TableName": TABLE, "Key": key(name),
                       "ConditionExpression": "#v=:v", "ExpressionAttributeNames": {"#v": "version"},
                       "ExpressionAttributeValues": {":v": records[name]["version"]}}})
    checks.append({"Put": {"TableName": TABLE, "Item": {**key(EXTRA_KEY), "payload": {"S": json.dumps(desired)},
                           "version": {"N": "1"}}, "ConditionExpression": "attribute_not_exists(PK)"}})
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, prefix="transaction-", suffix=".json", delete=False) as f:
        json.dump({"TransactItems": checks}, f)
        payload = Path(f.name)
    try:
        require(clock().date().isoformat() == DAY, "ONE_TIME_APPROVAL_DAY_ENDED")
        call("dynamodb", "transact-write-items", cli_input_json="file://" + str(payload))
    finally:
        payload.unlink(missing_ok=True)
    result = call("dynamodb", "get-item", table_name=TABLE, key=key(EXTRA_KEY), consistent_read=True).get("Item")
    require(result is not None and valid_extra(result), "ALLOWANCE_READBACK_FAILED")
    return {"status": "TWO_EXTRA_RUNS_APPROVED", "remaining": 2 - json.loads(result["payload"]["S"])["usedRuns"],
            "expiresAt": desired["expiresAt"], "cloudWrites": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(install(aws, datetime.datetime.now(datetime.timezone.utc), Path.home(), args.apply)))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        # No AWS stderr, approval contents, identities or private snapshot values.
        safe = {"ONE_TIME_APPROVAL_DAY_ENDED", "WRONG_AWS_ACCOUNT", "WRONG_OR_INACTIVE_TABLE", "MISSING_CONTROL_RECORD",
                "ORIGINAL_APPROVAL_CHANGED", "CUMULATIVE_CEILINGS_CHANGED", "PER_RUN_CEILINGS_CHANGED",
                "CLEANUP_REQUIRED_FIRST", "EXTRA_ALLOWANCE_DRIFT", "DAILY_USAGE_CHANGED", "CUMULATIVE_BUDGET_INSUFFICIENT",
                "DAILY_EMAIL_BUDGET_INSUFFICIENT", "SAVED_BASELINE_DRIFT", "ALLOWANCE_READBACK_FAILED"}
        safe.update("AWS_OPERATION_FAILED:" + s + ":" + op for s, op in
                    [("sts", "get-caller-identity"), ("dynamodb", "describe-table"),
                     ("dynamodb", "get-item"), ("dynamodb", "transact-write-items")])
        code = str(error) if isinstance(error, ValueError) and str(error) in safe else "TWO_RUN_APPROVAL_CHECK_FAILED"
        print(json.dumps({"status": "BLOCKED", "code": code}))
        raise SystemExit(1)
