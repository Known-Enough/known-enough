"""One exact administrator repair; default is read-only. No personal credentials are exported."""
import argparse
import copy
import datetime
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ACCOUNT = "092954139775"
ROLE = "KnownEnoughGithubQaRelease"
ROLE_ARN = "arn:aws:iam::" + ACCOUNT + ":role/" + ROLE
POLICY = "ExactQaRelease"
BRANCH = "arn:aws:amplify:us-east-1:" + ACCOUNT + ":apps/d2l23pkzmr1tio/branches/main"
RESOURCE = BRANCH + "/deployments/*"
EXPIRY = "2026-10-09T03:16:41.171626+00:00"


def canonical(value, key=None):
    if key in ("Action", "Resource", "Federated") and isinstance(value, str):
        value = [value]
    if isinstance(value, dict):
        return {k: canonical(v, k) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return sorted((canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
    return value


def policy_hash(value):
    return hashlib.sha256(json.dumps(canonical(value), sort_keys=True).encode()).hexdigest()


def baseline():
    def allow(action, resource):
        return {"Effect": "Allow", "Action": action, "Resource": resource}
    statements = [
        allow(["lambda:UpdateFunctionCode", "lambda:GetFunctionConfiguration"], [
            "arn:aws:lambda:us-east-1:" + ACCOUNT + ":function:known-enough-qa-" + n
            for n in ("api", "fixtures", "pre-signup", "custom-message")]),
        allow(["amplify:CreateDeployment", "amplify:StartDeployment", "amplify:GetJob"], [BRANCH, BRANCH + "/jobs/*"]),
        allow(["s3:PutObject", "s3:GetObject"], "arn:aws:s3:::known-enough-qa-artifacts-" + ACCOUNT + "/*"),
        {**allow("dynamodb:GetItem", "arn:aws:dynamodb:us-east-1:" + ACCOUNT + ":table/KnownEnoughQaControl"),
         "Condition": {"ForAllValues:StringEquals": {"dynamodb:LeadingKeys": ["AUTH", "LEASE"]}}}
    ]
    return {"Version": "2012-10-17", "Statement": statements}


def repaired(value):
    old = baseline()
    fixed = copy.deepcopy(old)
    fixed["Statement"][1]["Resource"].append(RESOURCE)
    if canonical(value) == canonical(fixed):
        return copy.deepcopy(value), True
    if canonical(value) != canonical(old):
        raise RuntimeError("COMPLETE_POLICY_DRIFT")
    result = copy.deepcopy(value)
    stmt = next(s for s in result["Statement"] if canonical(s) == canonical(old["Statement"][1]))
    stmt["Resource"].append(RESOURCE)
    return result, False


def aws(service, operation, *args):
    response = subprocess.run(["aws", service, operation, *args, "--region", "us-east-1",
                               "--output", "json", "--no-cli-pager"], capture_output=True, text=True, timeout=45)
    if response.returncode:
        raise RuntimeError("AWS_OPERATION_FAILED:" + service + ":" + operation)
    return json.loads(response.stdout or "{}")


def read_state():
    role = aws("iam", "get-role", "--role-name", ROLE)["Role"]
    trust = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow",
             "Principal": {"Federated": "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com"},
             "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
                 "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                 "token.actions.githubusercontent.com:sub": "repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main"}}}]}
    if role.get("Arn") != ROLE_ARN or role.get("PermissionsBoundary") or canonical(role.get("AssumeRolePolicyDocument")) != canonical(trust):
        raise RuntimeError("ROLE_OR_TRUST_DRIFT")
    if aws("iam", "list-role-policies", "--role-name", ROLE).get("PolicyNames") != [POLICY]:
        raise RuntimeError("INLINE_POLICY_DRIFT")
    if aws("iam", "list-attached-role-policies", "--role-name", ROLE).get("AttachedPolicies") != []:
        raise RuntimeError("MANAGED_POLICY_DRIFT")
    value = aws("iam", "get-role-policy", "--role-name", ROLE, "--policy-name", POLICY)["PolicyDocument"]
    return role["RoleId"], value


def simulate():
    denied = [RESOURCE.replace("/branches/main/", "/branches/other/"), RESOURCE.replace("apps/d2l23pkzmr1tio/", "apps/otherapp/")]
    result = aws("iam", "simulate-principal-policy", "--policy-source-arn", ROLE_ARN,
                 "--action-names", "amplify:CreateDeployment", "--resource-arns", RESOURCE, *denied,
                 # IAM also requests context from the role's unrelated control-table
                 # statement. Supply only its existing permitted keys, never a policy.
                 "--context-entries", json.dumps([{"ContextKeyName": "dynamodb:LeadingKeys",
                                                   "ContextKeyType": "stringList",
                                                   "ContextKeyValues": ["AUTH", "LEASE"]}]))
    # AWS returns one aggregate result per action; its decision/name do not
    # identify the permission on any individual customer resource.
    evaluations = result.get("EvaluationResults")
    if result.get("IsTruncated") or not isinstance(evaluations, list) or len(evaluations) != 1:
        raise RuntimeError("SIMULATION_EVIDENCE_INCOMPLETE")
    evaluation = evaluations[0]
    if not isinstance(evaluation, dict) or evaluation.get("EvalActionName") != "amplify:CreateDeployment" or evaluation.get("MissingContextValues"):
        raise RuntimeError("SIMULATION_EVIDENCE_INCOMPLETE")
    resources = evaluation.get("ResourceSpecificResults")
    if not isinstance(resources, list) or len(resources) != 3:
        raise RuntimeError("SIMULATION_EVIDENCE_INCOMPLETE")
    decisions = {}
    expected = {RESOURCE, *denied}
    for item in resources:
        if not isinstance(item, dict):
            raise RuntimeError("SIMULATION_EVIDENCE_INCOMPLETE")
        name, decision = item.get("EvalResourceName"), item.get("EvalResourceDecision")
        if not isinstance(name, str) or name not in expected or name in decisions or decision not in ("allowed", "implicitDeny", "explicitDeny") or item.get("MissingContextValues"):
            raise RuntimeError("SIMULATION_EVIDENCE_INCOMPLETE")
        decisions[name] = decision
    if any(decisions[r] == "allowed" for r in denied):
        raise RuntimeError("OUTSIDE_QA_SCOPE_ALLOWED")
    return decisions[RESOURCE]


def save_private(name, value):
    directory = Path.home() / "known-enough-qa-release-policy-repair"
    if directory.is_symlink():
        raise RuntimeError("UNSAFE_BACKUP_DIRECTORY")
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077:
        raise RuntimeError("UNSAFE_BACKUP_DIRECTORY")
    path = directory / name
    if path.exists() or path.is_symlink():
        if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_uid != os.getuid() or canonical(json.loads(path.read_text())) != canonical(value):
            raise RuntimeError("BACKUP_DRIFT")
    else:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(value, f, indent=2)
            f.write("\n")
    return path


def main(apply=False):
    if datetime.datetime.now(datetime.timezone.utc) >= datetime.datetime.fromisoformat(EXPIRY):
        raise RuntimeError("ORIGINAL_WINDOW_EXPIRED")
    if aws("sts", "get-caller-identity").get("Account") != ACCOUNT:
        raise RuntimeError("WRONG_ACCOUNT")
    role_id, before = read_state()
    after, already = repaired(before)
    decision = simulate()
    if not already and decision != "implicitDeny":
        raise RuntimeError("DENIAL_NOT_REPRODUCED")
    if not apply and not already:
        print(json.dumps({"status": "QA_RELEASE_POLICY_PREPARED", "resource": RESOURCE,
                          "beforeHash": policy_hash(before), "cloudWrites": False}))
        return
    if not already:
        save_private("before.json", before)
        filename = save_private("after.json", after)
        fresh_id, fresh = read_state()
        if fresh_id != role_id or policy_hash(fresh) != policy_hash(before):
            raise RuntimeError("FRESH_POLICY_DRIFT")
        aws("iam", "put-role-policy", "--role-name", ROLE, "--policy-name", POLICY,
            "--policy-document", "file://" + str(filename))
    for attempt in range(10):
        fresh_id, fresh = read_state()
        if fresh_id != role_id or canonical(fresh) != canonical(after):
            raise RuntimeError("POLICY_READBACK_DRIFT")
        if simulate() == "allowed":
            print(json.dumps({"status": "QA_RELEASE_POLICY_READBACK_PASS", "role": ROLE,
                              "policy": POLICY, "resource": RESOURCE, "alreadyCorrect": already,
                              "cloudWrites": not already}))
            return
        if attempt < 9:
            time.sleep(3)
    raise RuntimeError("POLICY_SIMULATION_NOT_ALLOWED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Explicit administrator authorization to apply the one-resource fix")
    args = parser.parse_args()
    try:
        main(args.apply)
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else "REPAIR_OPERATION_FAILED"
        print(json.dumps({"status": "BLOCKED", "code": code}))
        raise SystemExit(1)
