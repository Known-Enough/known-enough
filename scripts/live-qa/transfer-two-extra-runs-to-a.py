#!/usr/bin/env python3
"""Transfer only the remaining dated B test starts to A; preserve all usage."""
import argparse
import datetime
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

ACCOUNT = "092954139775"
TABLE = "KnownEnoughQaControl"
DAY = "2026-10-03"
EXPIRY = "2026-10-09T03:16:41.171626Z"
EXTRA_EXPIRY = "2026-10-04T00:00:00Z"
EXTRA_KEY = "EXTRA#" + DAY
FROM_ACTOR = "Battosai1806"
TO_ACTOR = "martelaxe"
TOTAL_CEILINGS = {"maxRunsTotal": 28, "maxTokensTotal": 7000000,
                  "maxCostMicrosTotal": 7000000, "maxSignupMessagesTotal": 56}
PER_RUN_CEILINGS = {"maxAttemptsPerRun": 200, "maxTokensPerRun": 250000,
                    "maxCostMicrosPerRun": 250000, "maxSignupMessagesPerRun": 2,
                    "maxSignupMessagesPerDay": 8}


def cumulative_caps(authorization):
    present = [name for name in TOTAL_CEILINGS if name in authorization]
    if present and len(present) != len(TOTAL_CEILINGS):
        raise ValueError("CUMULATIVE_CEILINGS_CHANGED")
    runs = min(28, authorization["maxRunsPerDay"] * 7)
    caps = ({name: authorization[name] for name in TOTAL_CEILINGS} if present else {
        "maxRunsTotal": runs,
        "maxTokensTotal": min(7000000, runs * authorization["maxTokensPerRun"]),
        "maxCostMicrosTotal": min(7000000, runs * authorization["maxCostMicrosPerRun"]),
        "maxSignupMessagesTotal": min(56, authorization["maxSignupMessagesPerDay"] * 7)})
    if not all(type(caps[name]) is int and 0 < caps[name] <= limit
               for name, limit in TOTAL_CEILINGS.items()):
        raise ValueError("CUMULATIVE_CEILINGS_CHANGED")
    return caps


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


def item_value(item):
    if (not isinstance(item, dict) or set(item) != {"PK", "SK", "payload", "version"}
            or item.get("SK") != {"S": "STATE"}
            or not isinstance(item.get("payload"), dict) or set(item["payload"]) != {"S"}
            or not isinstance(item.get("version"), dict) or set(item["version"]) != {"N"}):
        raise ValueError("CONTROL_RECORD_CHANGED")
    try:
        version = int(item["version"]["N"])
        value = json.loads(item["payload"]["S"])
    except (ValueError, TypeError, KeyError):
        raise ValueError("CONTROL_RECORD_CHANGED") from None
    if version < 1 or type(value) is not dict:
        raise ValueError("CONTROL_RECORD_CHANGED")
    return value, version


def read_records(call):
    require_account = call("sts", "get-caller-identity").get("Account") == ACCOUNT
    if not require_account:
        raise ValueError("WRONG_AWS_ACCOUNT")
    table = call("dynamodb", "describe-table", table_name=TABLE).get("Table", {})
    if (table.get("TableArn") != f"arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/{TABLE}"
            or table.get("TableStatus") != "ACTIVE"):
        raise ValueError("WRONG_OR_INACTIVE_TABLE")
    records = {}
    for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL", EXTRA_KEY]:
        item = call("dynamodb", "get-item", table_name=TABLE, key=key(name), consistent_read=True).get("Item")
        if item is None:
            raise ValueError("MISSING_CONTROL_RECORD")
        if item.get("PK") != {"S": name}:
            raise ValueError("CONTROL_RECORD_CHANGED")
        records[name] = item
    return records


def transfer(call, now, home, apply=False, clock=None):
    clock = clock or (lambda: datetime.datetime.now(datetime.timezone.utc))

    def require(condition, reason):
        if not condition:
            raise ValueError(reason)

    require(now.date().isoformat() == DAY and now < datetime.datetime.fromisoformat(EXTRA_EXPIRY.replace("Z", "+00:00")),
            "ONE_TIME_APPROVAL_EXPIRED")
    records = read_records(call)

    def value(name):
        return item_value(records[name])[0]

    auth, lease, daily, total, extra = (value(name) for name in
                                        ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL", EXTRA_KEY])
    auth_version = item_value(records["AUTH"])[1]
    extra_version = item_value(records[EXTRA_KEY])[1]
    require(auth.get("approved") is True and auth.get("retentionReviewed") is True
            and auth.get("invocationLoggingDisabled") is True and auth.get("expiresAt") == EXPIRY
            and type(auth.get("maxRunsPerDay")) is int and auth.get("maxRunsPerDay") == 4,
            "ORIGINAL_APPROVAL_CHANGED")
    require(all(type(auth.get(name)) is int and 0 < auth[name] <= limit
                for name, limit in PER_RUN_CEILINGS.items()), "PER_RUN_CEILINGS_CHANGED")
    caps = cumulative_caps(auth)
    require(lease.get("status") == "CLEAN", "CLEANUP_REQUIRED_FIRST")

    expected_keys = {"schemaVersion", "day", "actor", "additionalRuns", "usedRuns", "baseRuns",
                     "authorizationVersion", "authorizationExpiresAt", "expiresAt"}
    require(set(extra) == expected_keys and type(extra.get("schemaVersion")) is int
            and extra.get("schemaVersion") == 1 and extra.get("day") == DAY
            and extra.get("actor") in {FROM_ACTOR, TO_ACTOR}
            and type(extra.get("additionalRuns")) is int and extra.get("additionalRuns") == 2
            and type(extra.get("baseRuns")) is int and extra.get("baseRuns") == 4
            and type(extra.get("authorizationVersion")) is int
            and extra.get("authorizationVersion") == auth_version
            and extra.get("authorizationExpiresAt") == EXPIRY and extra.get("expiresAt") == EXTRA_EXPIRY
            and type(extra.get("usedRuns")) is int and 0 <= extra["usedRuns"] <= 2,
            "EXTRA_ALLOWANCE_DRIFT")
    used = extra["usedRuns"]
    remaining = 2 - used
    require(type(daily.get("runs")) is int and daily["runs"] == 4 + used,
            "DAILY_USAGE_CHANGED")
    require(type(total.get("runs")) is int and type(total.get("reservedTokens")) is int
            and type(total.get("reservedCostMicros")) is int and type(total.get("messages")) is int
            and all(total[field] >= 0 for field in ["runs", "reservedTokens", "reservedCostMicros", "messages"]),
            "CUMULATIVE_USAGE_CHANGED")
    require(all(total[field] + remaining * per_run <= caps[cap]
                for field, cap, per_run in [
                    ("runs", "maxRunsTotal", 1),
                    ("reservedTokens", "maxTokensTotal", auth["maxTokensPerRun"]),
                    ("reservedCostMicros", "maxCostMicrosTotal", auth["maxCostMicrosPerRun"]),
                    ("messages", "maxSignupMessagesTotal", auth["maxSignupMessagesPerRun"])]),
            "CUMULATIVE_BUDGET_INSUFFICIENT")
    require(type(daily.get("messages")) is int and daily["messages"] >= 0
            and daily["messages"] + remaining * auth["maxSignupMessagesPerRun"] <= auth["maxSignupMessagesPerDay"],
            "DAILY_EMAIL_BUDGET_INSUFFICIENT")

    folder = Path(home) / "known-enough-two-extra-runs-transfer" / DAY
    snapshot = folder / "original-private.json"
    saved = None
    if snapshot.exists() or snapshot.is_symlink():
        try:
            require(not snapshot.is_symlink() and stat.S_ISREG(snapshot.lstat().st_mode)
                    and stat.S_IMODE(snapshot.lstat().st_mode) == 0o600
                    and stat.S_IMODE(folder.lstat().st_mode) == 0o700,
                    "SAVED_BASELINE_DRIFT")
        except OSError:
            raise ValueError("SAVED_BASELINE_DRIFT") from None
        try:
            saved = json.loads(snapshot.read_text())
        except (OSError, ValueError):
            raise ValueError("SAVED_BASELINE_DRIFT") from None
        require(set(saved) == set(records) and saved["AUTH"] == records["AUTH"], "SAVED_BASELINE_DRIFT")
        original, original_version = item_value(saved[EXTRA_KEY])
        require(original.get("actor") == FROM_ACTOR and original.get("usedRuns") <= used,
                "SAVED_BASELINE_DRIFT")
        require(all(original.get(name) == extra.get(name)
                    for name in expected_keys - {"actor", "usedRuns"}), "SAVED_BASELINE_DRIFT")
        if extra.get("actor") == FROM_ACTOR:
            require(all(saved[name] == records[name] for name in ["LEASE", "DAY#" + DAY, "TOTAL"])
                    and saved[EXTRA_KEY] == records[EXTRA_KEY], "SAVED_BASELINE_DRIFT")
        else:
            require(extra.get("actor") == TO_ACTOR
                    and extra_version == original_version + 1 + used - original["usedRuns"],
                    "SAVED_BASELINE_DRIFT")
    else:
        require(extra.get("actor") == FROM_ACTOR, "SAVED_BASELINE_REQUIRED")
        if apply:
            root = folder.parent
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            require(not root.is_symlink() and root.is_dir(), "SAVED_BASELINE_DRIFT")
            root.chmod(0o700)
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            require(not folder.is_symlink() and folder.is_dir(), "SAVED_BASELINE_DRIFT")
            folder.chmod(0o700)
            fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(records, output, sort_keys=True)
            os.chmod(snapshot, 0o600)

    if extra.get("actor") == TO_ACTOR:
        return {"status": "TWO_EXTRA_RUNS_ALREADY_TRANSFERRED", "remaining": remaining,
                "expiresAt": EXTRA_EXPIRY, "cloudWrites": False}
    require(extra.get("actor") == FROM_ACTOR, "EXTRA_ALLOWANCE_DRIFT")
    if not remaining:
        return {"status": "NO_EXTRA_RUNS_REMAIN", "remaining": 0, "expiresAt": EXTRA_EXPIRY,
                "cloudWrites": False}
    if not apply:
        return {"status": "TWO_EXTRA_RUNS_TRANSFER_PREPARED", "remaining": remaining,
                "expiresAt": EXTRA_EXPIRY, "cloudWrites": False}

    checks = []
    for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL"]:
        checks.append({"ConditionCheck": {
            "TableName": TABLE, "Key": key(name),
            "ConditionExpression": "#v=:v",
            "ExpressionAttributeNames": {"#v": "version"},
            "ExpressionAttributeValues": {":v": records[name]["version"]}}})
    changed = {**extra, "actor": TO_ACTOR}
    checks.append({"Put": {
        "TableName": TABLE,
        "Item": {**key(EXTRA_KEY), "payload": {"S": json.dumps(changed)},
                 "version": {"N": str(extra_version + 1)}},
        "ConditionExpression": "#v=:v",
        "ExpressionAttributeNames": {"#v": "version"},
        "ExpressionAttributeValues": {":v": records[EXTRA_KEY]["version"]}}})
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, prefix="transaction-", suffix=".json", delete=False) as output:
        json.dump({"TransactItems": checks}, output)
        payload = Path(output.name)
    try:
        require(clock() < datetime.datetime.fromisoformat(EXTRA_EXPIRY.replace("Z", "+00:00")),
                "ONE_TIME_APPROVAL_EXPIRED")
        call("dynamodb", "transact-write-items", cli_input_json="file://" + str(payload))
    finally:
        payload.unlink(missing_ok=True)

    confirmed = read_records(call)
    confirmed_extra, confirmed_version = item_value(confirmed[EXTRA_KEY])
    require(all(confirmed[name] == records[name] for name in ["AUTH", "LEASE", "DAY#" + DAY, "TOTAL"])
            and confirmed_extra == changed and confirmed_version == extra_version + 1,
            "TRANSFER_READBACK_FAILED")
    return {"status": "TWO_EXTRA_RUNS_TRANSFERRED_TO_A", "remaining": remaining,
            "expiresAt": EXTRA_EXPIRY, "cloudWrites": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(transfer(aws, datetime.datetime.now(datetime.timezone.utc), Path.home(), args.apply)))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        safe = {
            "ONE_TIME_APPROVAL_EXPIRED", "WRONG_AWS_ACCOUNT", "WRONG_OR_INACTIVE_TABLE", "MISSING_CONTROL_RECORD",
            "CONTROL_RECORD_CHANGED", "ORIGINAL_APPROVAL_CHANGED", "PER_RUN_CEILINGS_CHANGED",
            "CUMULATIVE_CEILINGS_CHANGED", "CLEANUP_REQUIRED_FIRST", "EXTRA_ALLOWANCE_DRIFT",
            "DAILY_USAGE_CHANGED", "CUMULATIVE_USAGE_CHANGED", "CUMULATIVE_BUDGET_INSUFFICIENT",
            "DAILY_EMAIL_BUDGET_INSUFFICIENT", "SAVED_BASELINE_DRIFT", "SAVED_BASELINE_REQUIRED",
            "NO_EXTRA_RUNS_REMAIN", "TRANSFER_READBACK_FAILED"}
        safe.update("AWS_OPERATION_FAILED:" + service + ":" + operation for service, operation in [
            ("sts", "get-caller-identity"), ("dynamodb", "describe-table"),
            ("dynamodb", "get-item"), ("dynamodb", "transact-write-items")])
        code = str(error) if isinstance(error, ValueError) and str(error) in safe else "TWO_RUN_TRANSFER_CHECK_FAILED"
        print(json.dumps({"status": "BLOCKED", "code": code}))
        raise SystemExit(1)
