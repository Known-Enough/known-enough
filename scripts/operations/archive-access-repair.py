#!/usr/bin/env python3
"""One fixed archive-role directory repair through the existing managed stack."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STACK = 'KnownEnoughOperationsAccess'
ROLE = 'KnownEnoughGithubGroupArchive'
BEFORE = 'dad1200b7e5d8b105284d2fe98e6517f2c48263282eb231d958fd7a532a057bc'
TABLE = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions'
SIDS = ['ArchiveHeaderChildrenAndAuthorityRead', 'ArchiveAuthorityConditions']
OLD = ['GROUP#*', 'ACCOUNT#*', 'OPERATIONS#ARCHIVE']
NEW = OLD + ['INVITATION#*', 'DECISION#*']


class RepairError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RepairError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def patched_template(original):
    require(digest(original) == BEFORE, 'INSTALLED_TEMPLATE_CHANGED')
    result = copy.deepcopy(original)
    role = result['Resources']['ArchiveRole']
    require(role['Properties']['RoleName'] == ROLE, 'ROLE_CHANGED')
    policies = role['Properties']['Policies']
    require(len(policies) == 1 and policies[0]['PolicyName'] == 'ScopedOperations', 'POLICY_CHANGED')
    statements = policies[0]['PolicyDocument']['Statement']
    for sid in SIDS:
        selected = [statement for statement in statements if statement.get('Sid') == sid]
        require(len(selected) == 1, 'STATEMENT_CHANGED')
        statement = selected[0]
        require(statement['Effect'] == 'Allow' and statement['Resource'] == TABLE, 'RESOURCE_CHANGED')
        require(statement['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'] == OLD, 'KEYS_CHANGED')
        expected = ['dynamodb:GetItem', 'dynamodb:BatchGetItem'] if sid == SIDS[0] else ['dynamodb:ConditionCheckItem']
        require(statement['Action'] == expected, 'ACTIONS_CHANGED')
        statement['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'] = NEW
    require(result['Resources']['ArchiveBoundary'] == original['Resources']['ArchiveBoundary'], 'BOUNDARY_CHANGED')
    return result


def aws(service, operation, *args):
    result = subprocess.run(['aws', service, operation, *args, '--region', 'us-east-1', '--output', 'json',
                             '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '15'],
                            capture_output=True, text=True, timeout=25, env=dict(os.environ))
    if result.returncode:
        code = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', result.stderr)
        label = code.group(1) if code else ('NO_CREDENTIALS' if 'unable to locate credentials' in result.stderr.lower() else 'UNCLASSIFIED')
        raise RepairError('AWS_REQUEST_FAILED:' + service + ':' + operation + ':' + label)
    require(len(result.stdout.encode()) <= 2_000_000, 'AWS_RESPONSE_LIMIT')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def document(value):
    return json.loads(value) if isinstance(value, str) else value


def save(path, value):
    temporary = path.with_suffix('.next')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o600)
    temporary.replace(path)


def wait_install(state, state_path, desired, desired_hash):
    for _ in range(18):
        stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK)['Stacks'][0]
        if stack['StackStatus'] == 'UPDATE_COMPLETE':
            current = document(aws('cloudformation', 'get-template', '--stack-name', STACK)['TemplateBody'])
            if digest(current) == desired_hash:
                policy = document(aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', 'ScopedOperations')['PolicyDocument'])
                require(policy == desired['Resources']['ArchiveRole']['Properties']['Policies'][0]['PolicyDocument'], 'POLICY_READBACK_FAILED')
                state['phase'] = 'VERIFIED'
                save(state_path, state)
                return {'result': 'ARCHIVE_DIRECTORY_POLICY_READBACK_PASS', 'role': ROLE, 'dataChanges': 0}
        require(stack['StackStatus'] in ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE'], 'INSTALL_NOT_COMPLETE')
        time.sleep(5)
    return {'result': 'ARCHIVE_REPAIR_INSTALL_PENDING', 'dataChanges': 0, 'resume': 'SAME_PINNED_COMMAND'}

def run(source, apply):
    require(re.fullmatch('[a-f0-9]{40}', source) is not None, 'SOURCE_INVALID')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    origin = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, text=True).strip()
    require(head == source and origin in ['https://github.com/Known-Enough/known-enough.git', 'https://github.com/Known-Enough/known-enough'], 'CHECKOUT_CHANGED')
    require(not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip(), 'CHECKOUT_DIRTY')
    identity = aws('sts', 'get-caller-identity')
    require(identity.get('Account') == '092954139775' and identity.get('Arn') == 'arn:aws:iam::092954139775:root', 'OWN_SETUP_IDENTITY_REQUIRED')
    desired = json.loads((ROOT / 'infra/operations/access-setup.json').read_text())
    desired_hash = digest(desired)
    folder = Path.home() / '.known-enough' / ('ops01-archive-access-' + source)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(folder.stat().st_mode & 0o777 == 0o700, 'PRIVATE_STATE_MODE_CHANGED')
    state_path = folder / 'state-private.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if state:
        require(state['source'] == source and state['templateHash'] == desired_hash, 'SAVED_STATE_CHANGED')
    stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK)['Stacks'][0]
    require(stack['StackId'].startswith('arn:aws:cloudformation:us-east-1:092954139775:stack/' + STACK + '/'), 'STACK_CHANGED')
    if state and state['phase'] in ['EXECUTE_INTENT', 'INSTALL_SUBMITTED']:
        return wait_install(state, state_path, desired, desired_hash)
    current = document(aws('cloudformation', 'get-template', '--stack-name', STACK)['TemplateBody'])
    if digest(current) == desired_hash:
        policy = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', 'ScopedOperations')['PolicyDocument']
        expected = desired['Resources']['ArchiveRole']['Properties']['Policies'][0]['PolicyDocument']
        require(document(policy) == expected, 'EFFECTIVE_POLICY_CHANGED')
        require(stack['StackStatus'] in ['CREATE_COMPLETE', 'UPDATE_COMPLETE'], 'STACK_NOT_COMPLETE')
        if state:
            state['phase'] = 'VERIFIED'
            save(state_path, state)
        return {'result': 'ARCHIVE_DIRECTORY_POLICY_READBACK_PASS', 'stack': STACK, 'role': ROLE, 'dataChanges': 0}
    require(patched_template(current) == desired, 'DESIRED_TEMPLATE_CHANGED')
    observed_role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
    expected_role = current['Resources']['ArchiveRole']['Properties']
    require(observed_role.get('Arn') == 'arn:aws:iam::092954139775:role/' + ROLE
            and document(observed_role.get('AssumeRolePolicyDocument')) == expected_role['AssumeRolePolicyDocument']
            and observed_role.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn')
            == 'arn:aws:iam::092954139775:policy/' + ROLE + 'Boundary', 'INSTALLED_ROLE_CHANGED')
    observed_policy = document(aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', 'ScopedOperations')['PolicyDocument'])
    require(observed_policy == expected_role['Policies'][0]['PolicyDocument'], 'INSTALLED_POLICY_CHANGED')
    if not apply:
        return {'result': 'ARCHIVE_DIRECTORY_REPAIR_REVIEW_READY', 'resourceChanges': ['ArchiveRole'], 'newKeys': NEW[-2:], 'dataChanges': 0}
    if state is None:
        require(stack['StackStatus'] in ['CREATE_COMPLETE', 'UPDATE_COMPLETE'], 'STACK_NOT_COMPLETE')
        state = {'source': source, 'templateHash': desired_hash, 'name': 'ops01-archive-' + uuid.uuid4().hex,
                 'createToken': uuid.uuid4().hex, 'executeToken': uuid.uuid4().hex, 'phase': 'PREVIEW_INTENT'}
        save(state_path, state)
        template_path = folder / 'template-private.json'
        template_path.write_text(json.dumps(desired, separators=(',', ':')))
        template_path.chmod(0o600)
        require(template_path.stat().st_size < 51_200, 'TEMPLATE_LIMIT')
        aws('cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', state['name'],
            '--change-set-type', 'UPDATE', '--template-body', 'file://' + str(template_path),
            '--capabilities', 'CAPABILITY_NAMED_IAM', '--client-token', state['createToken'])
        state['phase'] = 'PREVIEW_SUBMITTED'
        save(state_path, state)
    if state['phase'] in ['PREVIEW_INTENT', 'PREVIEW_SUBMITTED']:
        preview = None
        for _ in range(12):
            preview = aws('cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', state['name'])
            if preview['Status'] == 'CREATE_COMPLETE':
                break
            require(preview['Status'] in ['CREATE_PENDING', 'CREATE_IN_PROGRESS'], 'PREVIEW_FAILED')
            time.sleep(5)
        if preview['Status'] != 'CREATE_COMPLETE':
            return {'result': 'ARCHIVE_REPAIR_PREVIEW_PENDING', 'dataChanges': 0, 'resume': 'SAME_PINNED_COMMAND'}
        changes = [row['ResourceChange'] for row in preview.get('Changes', [])]
        require(len(changes) == 1 and changes[0]['LogicalResourceId'] == 'ArchiveRole'
                and changes[0]['Action'] == 'Modify' and changes[0].get('Replacement') == 'False', 'PREVIEW_SCOPE_CHANGED')
        proposed = document(aws('cloudformation', 'get-template', '--stack-name', STACK, '--change-set-name', state['name'])['TemplateBody'])
        require(digest(proposed) == desired_hash, 'PREVIEW_TEMPLATE_CHANGED')
        require(digest(document(aws('cloudformation', 'get-template', '--stack-name', STACK)['TemplateBody'])) == BEFORE, 'STACK_DRIFT_BEFORE_EXECUTION')
        state['phase'] = 'EXECUTE_INTENT'
        save(state_path, state)
        aws('cloudformation', 'execute-change-set', '--stack-name', STACK, '--change-set-name', state['name'], '--client-request-token', state['executeToken'])
        state['phase'] = 'INSTALL_SUBMITTED'
        save(state_path, state)
    require(state['phase'] in ['EXECUTE_INTENT', 'INSTALL_SUBMITTED'], 'SAVED_PHASE_INVALID')
    return wait_install(state, state_path, desired, desired_hash)



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.source, args.apply)))
    except (RepairError, subprocess.SubprocessError, KeyError, ValueError, OSError) as error:
        print(json.dumps({'result': 'BLOCKED', 'code': str(error) if isinstance(error, RepairError) else 'REPAIR_NOT_VERIFIED', 'dataChanges': 0}))
        raise SystemExit(1)
