#!/usr/bin/env python3
"""Approve all eligible users in one complete pending-account snapshot."""
import json
import subprocess
from pathlib import Path


def main():
    tool = str(Path.home() / ".known-enough/access-users/access-users")
    result = subprocess.run([tool, "list", "--pending"], capture_output=True, text=True)
    if result.returncode:
        print(result.stdout.strip() or '{"result":"BLOCKED","code":"PENDING_LIST_FAILED"}')
        return 1
    data = json.loads(result.stdout)
    if data.get("result") != "PENDING_LIST_COMPLETE" or not isinstance(data.get("pending"), list):
        print('{"result":"BLOCKED","code":"COMPLETE_PENDING_LIST_REQUIRED"}')
        return 1
    users = [row["username"] for row in data["pending"] if row.get("eligible") is True]
    if any(not isinstance(user, str) or not user for user in users) or len(set(users)) != len(users):
        print('{"result":"BLOCKED","code":"INVALID_PENDING_USERS"}')
        return 1
    completed = 0
    for username in users:
        result = subprocess.run([tool, "approve", "--username", username])
        if result.returncode:
            print(json.dumps({"result":"APPROVAL_STOPPED","completed":completed,"selected":len(users)}))
            return 1
        completed += 1
    print(json.dumps({"result":"ALL_ELIGIBLE_PENDING_PROCESSED","processed":completed,
                      "ineligibleSkipped":len(data["pending"])-len(users)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError):
        print('{"result":"BLOCKED","code":"LOCAL_APPROVAL_TOOL_UNAVAILABLE"}')
        raise SystemExit(1)
