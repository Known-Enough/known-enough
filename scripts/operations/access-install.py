#!/usr/bin/env python3
"""One-time CREATE-only fixed operations access. No data, code upload or activation.

Persist mutation intent before submission; uncertain acknowledgements are reconciled
by reads, never repeated. Subsequent invocations resume the same private HOME state.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('access_common', ROOT / 'scripts/operations/cloudshell-create.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
require = m.require
STACK = 'KnownEnoughOperationsAccess'
PREFIX = f'arn:aws:cloudformation:{m.REGION}:{m.ACCOUNT}:stack/{STACK}/'
TEMPLATE_SHA = 'fcda140a81615db236647690352e706110d15fbf9a062e87c35248ab32b25171'
PARTICIPANT_SHA = '0859906345e54c60b2c0f8eb6384a7038263d56b32e109de70500fa4c3328d82'


class Aws:
    def __init__(self, state, executor=m.inventory.bounded_run):
        self.state, self.executor = state, executor
        self.calls, self.mutations, self.action, self.start = 0, 0, None, time.monotonic()
        self.folder = state.folder / ('run-' + str(uuid.uuid4()))
        self.folder.mkdir(mode=0o700)

    def call(self, service, action, *args, mutation=False, missing=None):
        require(self.calls < 64 and time.monotonic() - self.start < 240, 'REQUEST_LIMIT')
        self.calls += 1
        self.mutations += int(mutation)
        self.action = service + ':' + action
        outpath, errpath = self.folder / f'{self.calls}.out', self.folder / f'{self.calls}.err'
        command = ['aws', service, action, *args, '--region', m.REGION, '--output', 'json',
                   '--no-cli-pager', '--no-paginate', '--cli-connect-timeout', '5', '--cli-read-timeout', '8']
        with os.fdopen(m.safe_file(outpath, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as out, \
                os.fdopen(m.safe_file(errpath, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as err:
            try:
                result = self.executor(command, env=m.credential_environment(), timeout=10, stdout=out, stderr=err, check=False)
            except subprocess.TimeoutExpired:
                raise m.Rejected('AWS_RESPONSE_UNCERTAIN' if mutation else 'AWS_READ_TIMEOUT') from None
            except m.inventory.ResponseLimit:
                raise m.Rejected('AWS_RESPONSE_LIMIT') from None
        raw, error = outpath.read_bytes(), errpath.read_bytes()
        require(len(raw) <= m.inventory.CAPTURE_LIMIT and len(error) <= m.inventory.CAPTURE_LIMIT, 'AWS_RESPONSE_LIMIT')
        if result.returncode:
            match = re.search(rb'An error occurred \(([A-Za-z0-9]+)\)', error)
            code = match[1].decode() if match else 'NO_CREDENTIALS' if b'unable to locate credentials' in error.lower() else 'AWS_REQUEST_FAILED'
            if missing == code:
                return None
            if missing == 'stack' and code == 'ValidationError' and re.search(
                    rb': Stack with id ' + STACK.encode() + rb' does not exist\s*$', error):
                return None
            raise m.Rejected(code if code in m.inventory.CODES or code == 'NO_CREDENTIALS' else 'AWS_REQUEST_FAILED')
        if not raw.strip() and mutation and action == 'execute-change-set':
            return {}
        try:
            value = json.loads(raw)
        except ValueError:
            raise m.Rejected('AWS_RESPONSE_INVALID') from None
        require(isinstance(value, dict), 'AWS_RESPONSE_INVALID')
        return value


class Installation:
    def __init__(self, state, aws, source, template):
        self.state, self.aws, self.source, self.template = state, aws, source, template
        self.roles = {p['Properties']['RoleName']: p['Properties'] for p in template['Resources'].values() if p['Type'] == 'AWS::IAM::Role'}
        self.boundaries = {p['Properties']['ManagedPolicyName']: p['Properties']['PolicyDocument']
                           for p in template['Resources'].values() if p['Type'] == 'AWS::IAM::ManagedPolicy'}

    def stack(self):
        value = self.aws.call('cloudformation', 'describe-stacks', '--stack-name', STACK, missing='stack')
        if value is None:
            return None
        require(len(value.get('Stacks', [])) == 1, 'STACK_INVALID')
        row = value['Stacks'][0]
        require(row.get('StackName') == STACK and row.get('StackId', '').startswith(PREFIX), 'STACK_INVALID')
        return row

    def old_role(self, name, added, installing):
        role = self.aws.call('iam', 'get-role', '--role-name', name)['Role']
        require(role.get('Arn') == f'arn:aws:iam::{m.ACCOUNT}:role/{name}' and role.get('Path') == '/', 'BASELINE_ROLE_INVALID')
        trust = m.document(role.get('AssumeRolePolicyDocument'))
        if name == 'KnownEnoughStageApiRole':
            statements = trust.get('Statement') if isinstance(trust, dict) else None
            require(isinstance(statements, list) and bool(statements), 'RUNTIME_TRUST_REJECTED')
            for row in statements:
                actions = row.get('Action') if isinstance(row, dict) else None
                principal = row.get('Principal') if isinstance(row, dict) else None
                service = principal.get('Service') if isinstance(principal, dict) else None
                require(row.get('Effect') == 'Allow' and actions in ('sts:AssumeRole', ['sts:AssumeRole'])
                        and isinstance(principal, dict) and set(principal) == {'Service'}
                        and service in ('lambda.amazonaws.com', ['lambda.amazonaws.com'])
                        and not any(k in row for k in ('NotPrincipal', 'NotAction')), 'RUNTIME_TRUST_REJECTED')
        else:
            require(hashlib.sha256(m.encoded(trust)).hexdigest()
                    == '7dbfc8c615545903e4d479215adb9785d11c439193d20f2a90bd599b8d95942b', 'INSPECTOR_TRUST_CHANGED')
        listed = self.aws.call('iam', 'list-role-policies', '--role-name', name)
        attached = self.aws.call('iam', 'list-attached-role-policies', '--role-name', name)
        job_arn = f'arn:aws:iam::{m.ACCOUNT}:policy/KnownEnoughRuntimeModelJobs'
        allowed_managed = [{'PolicyName': 'KnownEnoughRuntimeModelJobs', 'PolicyArn': job_arn}] if installing and name == 'KnownEnoughStageApiRole' else []
        require(listed.get('IsTruncated') is False and attached.get('IsTruncated') is False
                and m.same(attached.get('AttachedPolicies'), allowed_managed), 'BASELINE_PAGINATION_OR_MANAGED_POLICY')
        names = listed.get('PolicyNames')
        require(isinstance(names, list) and len(names) <= 5 and len(set(names)) == len(names), 'BASELINE_INLINE_INVALID')
        policies = {}
        candidate = None
        for policy_name in sorted(names):
            item = self.aws.call('iam', 'get-role-policy', '--role-name', name, '--policy-name', policy_name)
            require(item.get('RoleName') == name and item.get('PolicyName') == policy_name, 'BASELINE_INLINE_INVALID')
            document = m.document(item['PolicyDocument'])
            if policy_name == added:
                candidate = document
            else:
                policies[policy_name] = document
        return {'identity': {k: role.get(k) for k in ['RoleId', 'Arn', 'Path', 'AssumeRolePolicyDocument', 'PermissionsBoundary']},
                'policies': policies}, candidate

    def baselines(self, installing):
        for key in ['OwnerRuntimePolicy', 'InspectorAccessMetadata']:
            proposed = self.template['Resources'][key]['Properties']
            name, added = proposed['Roles'][0], proposed['PolicyName']
            observed, candidate = self.old_role(name, added, installing)
            saved = self.state.load(key + '-baseline.json')
            if saved is None:
                require(not installing and candidate is None, 'UNOWNED_EXISTING_POLICY')
                self.state.save(key + '-baseline.json', observed)
            else:
                require(m.same(saved, observed), 'EXISTING_ROLE_CHANGED')
            if key == 'OwnerRuntimePolicy':
                existing = observed['policies'].get('KnownEnoughPartitionParticipant')
                require(hashlib.sha256(m.encoded(existing)).hexdigest() == PARTICIPANT_SHA, 'PARTICIPANT_POLICY_CHANGED')
            total = sum(len(m.encoded(p)) - 1 for p in observed['policies'].values()) + len(m.encoded(proposed['PolicyDocument'])) - 1
            require(total <= 10240, 'ROLE_INLINE_QUOTA')
            if installing:
                require(candidate is not None and m.same(candidate, proposed['PolicyDocument']), 'ADDED_POLICY_READBACK_FAILED')

    def verify(self, stack):
        require(stack['StackStatus'] == 'CREATE_COMPLETE', 'INSTALL_NOT_COMPLETE')
        body = self.aws.call('cloudformation', 'get-template', '--stack-name', stack['StackId'])
        require(m.same(m.document(body.get('TemplateBody')), self.template), 'INSTALLED_TEMPLATE_CHANGED')
        self.baselines(True)
        job_arn = f'arn:aws:iam::{m.ACCOUNT}:policy/KnownEnoughRuntimeModelJobs'
        job_policy = self.aws.call('iam', 'get-policy', '--policy-arn', job_arn)['Policy']
        require(job_policy.get('Arn') == job_arn and job_policy.get('DefaultVersionId'), 'RUNTIME_JOB_POLICY_INVALID')
        job_actual = self.aws.call('iam', 'get-policy-version', '--policy-arn', job_arn, '--version-id', job_policy['DefaultVersionId'])
        require(m.same(m.document(job_actual.get('PolicyVersion', {}).get('Document')),
                       self.template['Resources']['JobRuntimePolicy']['Properties']['PolicyDocument']), 'RUNTIME_JOB_POLICY_CHANGED')
        for name, proposed in self.roles.items():
            observed = self.aws.call('iam', 'get-role', '--role-name', name)['Role']
            boundary_name = name + 'Boundary'
            arn = f'arn:aws:iam::{m.ACCOUNT}:policy/{boundary_name}'
            require(observed.get('Arn') == f'arn:aws:iam::{m.ACCOUNT}:role/{name}' and observed.get('Path') == '/'
                    and observed.get('MaxSessionDuration') == 3600
                    and m.same(m.document(observed.get('AssumeRolePolicyDocument')), proposed['AssumeRolePolicyDocument'])
                    and observed.get('PermissionsBoundary', {}).get('PermissionsBoundaryArn') == arn, 'ROLE_READBACK_FAILED')
            listed = self.aws.call('iam', 'list-role-policies', '--role-name', name)
            attached = self.aws.call('iam', 'list-attached-role-policies', '--role-name', name)
            require(listed.get('IsTruncated') is False and listed.get('PolicyNames') == ['ScopedOperations']
                    and attached.get('IsTruncated') is False and attached.get('AttachedPolicies') == [], 'ROLE_SCOPE_CHANGED')
            policy = self.aws.call('iam', 'get-role-policy', '--role-name', name, '--policy-name', 'ScopedOperations')
            require(m.same(m.document(policy.get('PolicyDocument')), proposed['Policies'][0]['PolicyDocument']), 'ROLE_POLICY_READBACK_FAILED')
            managed = self.aws.call('iam', 'get-policy', '--policy-arn', arn)['Policy']
            require(managed.get('Arn') == arn and managed.get('DefaultVersionId'), 'BOUNDARY_INVALID')
            actual = self.aws.call('iam', 'get-policy-version', '--policy-arn', arn, '--version-id', managed['DefaultVersionId'])
            require(m.same(m.document(actual.get('PolicyVersion', {}).get('Document')), self.boundaries[boundary_name]), 'BOUNDARY_CHANGED')
        return 'ACCESS_INSTALL_READBACK_PASS'

    def run(self):
        identity = self.aws.call('sts', 'get-caller-identity')
        require(identity.get('Account') == m.ACCOUNT, 'ACCOUNT_REJECTED')
        binding = {'source': self.source, 'templateSha': TEMPLATE_SHA, 'stack': STACK}
        self.state.save('binding.json', binding)
        stack = self.stack()
        if stack and stack['StackStatus'] == 'CREATE_COMPLETE':
            return self.verify(stack)
        if self.state.load('execute.intent.json') is not None:
            require(stack is not None, 'EXECUTE_OUTCOME_UNKNOWN')
            require(stack['StackStatus'] != 'REVIEW_IN_PROGRESS', 'EXECUTE_OUTCOME_UNKNOWN')
            require(stack['StackStatus'] == 'CREATE_IN_PROGRESS', 'INSTALL_FAILED_REVIEW_REQUIRED')
            return 'ACCESS_INSTALL_PENDING'
        intent = self.state.load('preview.intent.json')
        if intent is None:
            require(stack is None, 'UNOWNED_STACK_EXISTS')
            self.baselines(False)
            for name in self.roles:
                require(self.aws.call('iam', 'get-role', '--role-name', name, missing='NoSuchEntity') is None, 'UNOWNED_ROLE_EXISTS')
            for name in self.boundaries:
                arn = f'arn:aws:iam::{m.ACCOUNT}:policy/{name}'
                require(self.aws.call('iam', 'get-policy', '--policy-arn', arn, missing='NoSuchEntity') is None, 'UNOWNED_BOUNDARY_EXISTS')
            for key, value in self.template['Resources'].items():
                documents = [p['PolicyDocument'] for p in value['Properties'].get('Policies', [])] if value['Type'] == 'AWS::IAM::Role' else [value['Properties']['PolicyDocument']]
                for index, document in enumerate(documents):
                    filename = key + '-' + str(index) + '.json'
                    self.state.save(filename, document)
                    findings = self.aws.call('accessanalyzer', 'validate-policy', '--policy-type', 'IDENTITY_POLICY',
                                             '--policy-document', 'file://' + str(self.state.folder / filename))
                    require('nextToken' not in findings and findings.get('findings') == [], 'POLICY_VALIDATION_FINDINGS')
            name = 'known-enough-' + str(uuid.uuid4())
            intent = dict(binding, changeSetName=name, token=str(uuid.uuid4()))
            self.state.save_bytes('template.json', m.encoded(self.template))
            self.state.save('preview.intent.json', intent)
            self.aws.call('cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', name,
                          '--change-set-type', 'CREATE', '--template-body', 'file://' + str(self.state.folder / 'template.json'),
                          '--capabilities', 'CAPABILITY_NAMED_IAM', '--client-token', intent['token'], '--on-stack-failure', 'DO_NOTHING', mutation=True)
        preview = self.aws.call('cloudformation', 'describe-change-set', '--stack-name', STACK, '--change-set-name', intent['changeSetName'])
        if preview.get('Status') in ['CREATE_PENDING', 'CREATE_IN_PROGRESS']:
            return 'ACCESS_PREVIEW_PENDING'
        require(preview.get('Status') == 'CREATE_COMPLETE' and preview.get('ExecutionStatus') == 'AVAILABLE', 'PREVIEW_FAILED_REVIEW_REQUIRED')
        require(preview.get('StackId', '').startswith(PREFIX)
                and preview.get('ChangeSetId', '').startswith(f'arn:aws:cloudformation:{m.REGION}:{m.ACCOUNT}:changeSet/'), 'PREVIEW_TARGET_CHANGED')
        changes = preview.get('Changes')
        require('NextToken' not in preview and isinstance(changes, list) and len(changes) == len(self.template['Resources']), 'PREVIEW_INCOMPLETE')
        found = set()
        for change in changes:
            value = change.get('ResourceChange', {})
            logical = value.get('LogicalResourceId')
            require(value.get('Action') == 'Add' and logical in self.template['Resources'] and logical not in found
                    and value.get('ResourceType') == self.template['Resources'][logical]['Type'], 'UNEXPECTED_CHANGE')
            found.add(logical)
        body = self.aws.call('cloudformation', 'get-template', '--change-set-name', preview['ChangeSetId'])
        require(m.same(m.document(body.get('TemplateBody')), self.template), 'PREVIEW_TEMPLATE_CHANGED')
        self.baselines(False)
        self.state.save('execute.intent.json', dict(binding, changeSetId=preview['ChangeSetId'], stackId=preview['StackId']))
        self.aws.call('cloudformation', 'execute-change-set', '--change-set-name', preview['ChangeSetId'],
                      '--client-request-token', intent['token'], mutation=True)
        return 'ACCESS_INSTALL_SUBMITTED'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', required=True)
    args = parser.parse_args()
    state = None
    aws = None
    report = dict(result='BLOCKED', classification=None, deployment='NOT_EXECUTED', migration='NOT_EXECUTED', effectivePermissions='PENDING_GITHUB_PROBE')
    try:
        m.verify_checkout(args.source)
        require(subprocess.check_output(['git', '-C', str(ROOT), 'branch', '--show-current'], text=True).strip() == 'main', 'BRANCH_REJECTED')
        raw = (ROOT / 'infra/operations/access-setup.json').read_bytes()
        require(hashlib.sha256(raw).hexdigest() == TEMPLATE_SHA, 'TEMPLATE_CHANGED')
        template = json.loads(raw)
        state = m.State(Path(args.state), Path.home())
        aws = Aws(state)
        report['result'] = Installation(state, aws, args.source, template).run()
    except m.Rejected as error:
        report['classification'] = str(error)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        report['classification'] = 'INSTALL_STATE_OR_OPERATION_FAILED'
    finally:
        if aws:
            report.update(requests=aws.calls, mutations=aws.mutations, action=aws.action)
        if state:
            state.close()
    print(json.dumps(report))
    return 1 if report['result'] == 'BLOCKED' else 0


if __name__ == '__main__':
    raise SystemExit(main())
