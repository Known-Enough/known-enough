#!/usr/bin/env python3
"""Bounded CREATE-only recovery installation; private durable intent, no retries.

This prepares/installs the existing recovery template, never enables workloads.
After either mutation intent exists, resume performs reads only. Configuration
readback does not establish effective permissions or managed recovery success.
"""
import argparse
import fcntl
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ops_inventory', ROOT / 'scripts/operations/cloudshell-inventory.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
ACCOUNT, REGION, ROLE, BUCKET = inventory.ACCOUNT, inventory.REGION, inventory.ROLE, inventory.BUCKET
STACK = 'KnownEnoughOperationsRecovery'
TABLE = 'KnownEnoughOperationsJournal'
TEMPLATE_SHA = '3370a0d1a03fc3792eb53f5cc5778d7202af0e4c32db06a6d6b553be9895f59e'
ORIGIN = 'https://github.com/Known-Enough/known-enough.git'
STACK_PREFIX = f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{STACK}/'
CHANGE_PREFIX = f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:changeSet/'


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def credential_environment():
    # Keep the session's container provider, without profile/role redirection.
    env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_ENDPOINT_URL')
           and k not in ('AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_ROLE_ARN',
                         'AWS_WEB_IDENTITY_TOKEN_FILE')}
    for key in ('AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'):
        uri = env.get(key)
        if not uri:
            continue
        require(len(uri) <= 4096 and not any(c.isspace() or ord(c) < 32 for c in uri)
                and '\\' not in uri, 'CREDENTIAL_PROVIDER_REJECTED')
        try:
            parsed = urlsplit(uri)
            if key.endswith('RELATIVE_URI'):
                valid = uri.startswith('/') and not uri.startswith('//') and not parsed.scheme and not parsed.netloc
            else:
                host = parsed.hostname
                try:
                    loopback = ipaddress.ip_address(host).is_loopback
                except ValueError:
                    loopback = False
                valid = (parsed.scheme in ('http', 'https') and (loopback or host in (
                    'localhost', '169.254.170.2', '169.254.170.23', 'fd00:ec2::23'))
                    and parsed.username is None and parsed.password is None
                    and (parsed.port is None or 0 < parsed.port <= 65535))
            require(valid and not parsed.fragment, 'CREDENTIAL_PROVIDER_REJECTED')
        except ValueError:
            raise Rejected('CREDENTIAL_PROVIDER_REJECTED') from None
    if env.get('AWS_CONTAINER_CREDENTIALS_FULL_URI') or env.get('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'):
        token = env.get('AWS_CONTAINER_AUTHORIZATION_TOKEN', '')
        token_file = env.get('AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE', '')
        require(len(token) <= 4096 and not any(ord(c) < 32 for c in token)
                and (not token_file or (os.path.isabs(token_file)
                     and not any(ord(c) < 32 for c in token_file))), 'CREDENTIAL_PROVIDER_REJECTED')
    env.update(AWS_MAX_ATTEMPTS='1', AWS_RETRY_MODE='standard', AWS_PAGER='',
               AWS_REGION=REGION, AWS_DEFAULT_REGION=REGION, AWS_CONFIG_FILE='/dev/null',
               AWS_SHARED_CREDENTIALS_FILE='/dev/null', AWS_EC2_METADATA_DISABLED='true')
    return env


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def document(value):
    return json.loads(value) if isinstance(value, str) else value


def same(left, right):
    # Python equality otherwise treats JSON 1 as true, weakening typed readback.
    return encoded(left) == encoded(right)


def safe_file(path, flags):
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    try:
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_mode & 0o077 == 0 and info.st_nlink == 1, 'PRIVATE_FILE_REQUIRED')
    except BaseException:
        os.close(fd)
        raise
    return fd


class State:
    def __init__(self, folder, home):
        self.folder = inventory.persistent_dir(folder, home)
        self.lock = safe_file(self.folder / 'lock', os.O_RDWR | os.O_CREAT)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.lock)
            raise Rejected('STATE_BUSY') from None

    def close(self):
        os.close(self.lock)

    def load(self, name):
        try:
            fd = safe_file(self.folder / name, os.O_RDONLY)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, 'rb') as stream:
            raw = stream.read(inventory.CAPTURE_LIMIT + 1)
        require(len(raw) <= inventory.CAPTURE_LIMIT, 'STATE_LIMIT')
        value = json.loads(raw)
        require(isinstance(value, dict), 'STATE_REJECTED')
        return value

    def save(self, name, value):
        """Exclusive, flushed intent: never overwrite source, tokens or evidence."""
        self.save_bytes(name, encoded(value))

    def save_bytes(self, name, raw):
        try:
            with os.fdopen(safe_file(self.folder / name, os.O_RDONLY), 'rb') as stream:
                old = stream.read(inventory.CAPTURE_LIMIT + 1)
            require(old == raw, 'STATE_CONFLICT')
            return
        except FileNotFoundError:
            pass
        require(len(raw) <= inventory.CAPTURE_LIMIT, 'STATE_LIMIT')
        with os.fdopen(safe_file(self.folder / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        fd = os.open(self.folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


class Aws:
    def __init__(self, state, executor=inventory.bounded_run, clock=time.monotonic):
        self.executor, self.clock, self.start, self.calls, self.mutations = executor, clock, clock(), 0, 0
        self.folder = state.folder / ('run-' + str(uuid.uuid4()))
        self.folder.mkdir(mode=0o700)

    def call(self, args, mutation=False, missing=None, missing_stack=False):
        remaining = 180 - (self.clock() - self.start)
        require(self.calls < 32 and remaining > 0, 'REQUEST_BUDGET_EXHAUSTED')
        env = credential_environment()
        self.calls += 1
        command = ['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager',
                   '--no-paginate', '--cli-connect-timeout', '5', '--cli-read-timeout', '8']
        self.mutations += int(mutation)
        # Diagnostics stay under the private state directory; public failures are finite codes.
        with os.fdopen(safe_file(self.folder / f'{self.calls}.out', os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as out, \
                os.fdopen(safe_file(self.folder / f'{self.calls}.err', os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as err:
            try:
                result = self.executor(command, env=env, timeout=min(10, remaining), stdout=out, stderr=err, check=False)
            except subprocess.TimeoutExpired:
                raise Rejected('AWS_RESPONSE_UNCERTAIN' if mutation else 'AWS_READ_TIMEOUT') from None
            except inventory.ResponseLimit:
                raise Rejected('AWS_RESPONSE_LIMIT') from None
            except OSError:
                raise Rejected('AWS_CLI_UNAVAILABLE') from None
        raw = (self.folder / f'{self.calls}.out').read_bytes()
        error = (self.folder / f'{self.calls}.err').read_bytes()
        require(max(len(raw), len(error)) <= inventory.CAPTURE_LIMIT, 'AWS_RESPONSE_LIMIT')
        if result.returncode:
            if re.search(rb'(?m)^(?:botocore\.exceptions\.NoCredentialsError: )?Unable to locate credentials(?:[.\r\n]|$)', error):
                raise Rejected('NO_CREDENTIALS')
            match = re.search(rb'An error occurred \(([A-Za-z0-9]+)\)', error)
            code = match[1].decode() if match else None
            if missing is not None and code == missing and not missing_stack:
                return None
            if missing_stack and code == 'ValidationError' and re.search(
                    rb': Stack with id ' + re.escape(STACK.encode()) + rb' does not exist\s*$', error):
                return None
            raise Rejected(code if code in inventory.CODES | {'ChangeSetNotFound', 'ChangeSetNotFoundException',
                           'AlreadyExistsException', 'TokenAlreadyExistsException', 'InsufficientCapabilitiesException',
                           'LimitExceededException', 'RequestTimeout'} else 'AWS_REQUEST_FAILED')
        # ExecuteChangeSet has no CLI output on success. Only this exact mutation
        # accepts an empty acknowledgment; metadata and CREATE still require JSON.
        if mutation and args[:2] == ['cloudformation', 'execute-change-set'] and not raw.strip():
            return {}
        try:
            value = json.loads(raw)
        except ValueError:
            raise Rejected('AWS_RESPONSE_REJECTED') from None
        require(isinstance(value, dict), 'AWS_RESPONSE_REJECTED')
        cursors = [value.get(k) for k in ('NextToken', 'Marker', 'NextMarker')]
        require(all(cursor is None or isinstance(cursor, str) for cursor in cursors)
                and not any(cursors) and value.get('IsTruncated', False) is False, 'AWS_RESPONSE_REJECTED')
        return value


class Installer:
    def __init__(self, state, source, template, aws):
        require(re.fullmatch('[0-9a-f]{40}', source) is not None, 'SOURCE_REJECTED')
        require(inventory.digest(template) == TEMPLATE_SHA, 'TEMPLATE_REJECTED')
        self.state, self.aws, self.template = state, aws, document(template.decode())
        self.plan = dict(schemaVersion=1, sourceSha=source, templateSha=TEMPLATE_SHA, account=ACCOUNT,
                         region=REGION, stack=STACK, changeSet='ke-ops00-create-' + source[:20],
                         clientToken='ke-ops00-create-' + source, type='CREATE')
        state.save('plan.json', self.plan)
        # Exact original bytes, held privately, are the bytes CloudFormation receives.
        state.save_bytes('template.json', template)

    def identity(self):
        value = self.aws.call(['sts', 'get-caller-identity'])
        arn = value.get('Arn')
        require(value.get('Account') == ACCOUNT and isinstance(arn, str) and (
            arn == f'arn:aws:iam::{ACCOUNT}:root' or re.fullmatch(
                rf'arn:aws:(?:iam::{ACCOUNT}:user/[A-Za-z0-9+=,.@_/-]+|sts::{ACCOUNT}:assumed-role/[A-Za-z0-9+=,.@_/-]+)', arn)),
                'IDENTITY_REJECTED')
        oidc = self.aws.call(['iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', inventory.PROVIDER])
        audiences = oidc.get('ClientIDList')
        require(oidc.get('Url') in ('token.actions.githubusercontent.com', 'https://token.actions.githubusercontent.com')
                and isinstance(audiences, list) and all(isinstance(v, str) for v in audiences)
                and 'sts.amazonaws.com' in audiences, 'OIDC_REJECTED')

    def conflicts(self, stack=True):
        if stack:
            require(self.aws.call(['cloudformation', 'describe-stacks', '--stack-name', STACK],
                                  missing_stack=True) is None, 'STACK_ALREADY_EXISTS')
        require(self.aws.call(['iam', 'get-role', '--role-name', ROLE], missing='NoSuchEntity') is None, 'ROLE_ALREADY_EXISTS')
        require(self.aws.call(['dynamodb', 'describe-table', '--table-name', TABLE], missing='ResourceNotFoundException') is None,
                'TABLE_ALREADY_EXISTS')
        require(self.aws.call(['s3api', 'get-bucket-versioning', '--bucket', BUCKET,
                               '--expected-bucket-owner', ACCOUNT], missing='NoSuchBucket') is None, 'BUCKET_ALREADY_EXISTS')

    def prepare(self):
        if self.state.load('create.intent.json') is not None:
            return self.resume()
        self.identity()
        self.conflicts()
        template_path = str(self.state.folder / 'template.json')
        self.aws.call(['cloudformation', 'validate-template', '--template-body', 'file://' + template_path])
        args = ['cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', self.plan['changeSet'],
                '--change-set-type', 'CREATE', '--capabilities', 'CAPABILITY_NAMED_IAM',
                '--client-token', self.plan['clientToken'], '--template-body', 'file://' + template_path]
        self.state.save('create.intent.json', dict(plan=self.plan, args=args))
        value = self.aws.call(args, mutation=True)
        self.identifiers(value.get('Id'), value.get('StackId'))
        self.state.save('create.ack.json', value)
        return 'PREVIEW_SUBMITTED', None

    def identifiers(self, change, stack):
        require(isinstance(change, str) and re.fullmatch(re.escape(CHANGE_PREFIX + self.plan['changeSet'] + '/')
                + '[A-Za-z0-9-]+', change) is not None, 'CHANGESET_TARGET_REJECTED')
        require(isinstance(stack, str) and re.fullmatch(re.escape(STACK_PREFIX) + '[A-Za-z0-9-]+', stack) is not None,
                'STACK_TARGET_REJECTED')
        ack = self.state.load('create.ack.json')
        require(ack is None or (change == ack['Id'] and stack == ack['StackId']), 'CHANGESET_TARGET_CHANGED')

    def changeset(self):
        require(self.state.load('create.intent.json') == dict(plan=self.plan, args=[
            'cloudformation', 'create-change-set', '--stack-name', STACK, '--change-set-name', self.plan['changeSet'],
            '--change-set-type', 'CREATE', '--capabilities', 'CAPABILITY_NAMED_IAM',
            '--client-token', self.plan['clientToken'], '--template-body', 'file://' + str(self.state.folder / 'template.json')]),
            'CREATE_INTENT_REQUIRED')
        value = self.aws.call(['cloudformation', 'describe-change-set', '--stack-name', STACK,
                               '--change-set-name', self.plan['changeSet']])
        self.identifiers(value.get('ChangeSetId'), value.get('StackId'))
        require(value.get('ChangeSetName') == self.plan['changeSet'] and value.get('StackName') == STACK,
                'CHANGESET_TARGET_REJECTED')
        return value

    def stack(self, stack_id):
        value = self.aws.call(['cloudformation', 'describe-stacks', '--stack-name', stack_id])
        rows = value.get('Stacks')
        require(isinstance(rows, list) and len(rows) == 1 and rows[0].get('StackName') == STACK
                and rows[0].get('StackId') == stack_id, 'STACK_TARGET_REJECTED')
        return rows[0]

    def review(self):
        value = self.changeset()
        require(value.get('Status') == 'CREATE_COMPLETE' and value.get('ExecutionStatus') == 'AVAILABLE', 'PREVIEW_NOT_AVAILABLE')
        require(value.get('Capabilities') == ['CAPABILITY_NAMED_IAM'] and value.get('Parameters') in (None, [])
                and value.get('NotificationARNs') in (None, [])
                and (value.get('ImportExistingResources') is None or value.get('ImportExistingResources') is False)
                and (value.get('IncludeNestedStacks') is None or value.get('IncludeNestedStacks') is False) and not value.get('ParentChangeSetId')
                and not value.get('RootChangeSetId') and value.get('OnStackFailure') in (None, 'ROLLBACK')
                and value.get('DeploymentMode') in (None, 'STANDARD'), 'PREVIEW_SCOPE_REJECTED')
        rows = value.get('Changes')
        require(isinstance(rows, list) and len(rows) == len(self.template['Resources']), 'PREVIEW_SCOPE_REJECTED')
        observed = {}
        for row in rows:
            resource = row.get('ResourceChange', {})
            name = resource.get('LogicalResourceId')
            require(row.get('Type') == 'Resource' and name in self.template['Resources'] and name not in observed
                    and resource.get('Action') == 'Add' and resource.get('Replacement') in (None, 'False')
                    and not resource.get('ChangeSetId') and resource.get('ResourceType') == self.template['Resources'][name]['Type'],
                    'PREVIEW_SCOPE_REJECTED')
            observed[name] = resource['ResourceType']
        arn, stack_id = value['ChangeSetId'], value['StackId']
        preview = self.aws.call(['cloudformation', 'get-template', '--stack-name', stack_id,
                                 '--change-set-name', arn, '--template-stage', 'Original'])
        require(same(document(preview.get('TemplateBody')), self.template), 'PREVIEW_TEMPLATE_REJECTED')
        require(self.stack(stack_id).get('StackStatus') == 'REVIEW_IN_PROGRESS', 'STACK_NOT_REVIEWABLE')
        record = dict(plan=self.plan, changeSetId=arn, stackId=stack_id, additions=observed)
        record['reviewHash'] = inventory.digest(encoded(record))
        self.state.save('review.json', record)
        return record

    def execute_args(self, review):
        return ['cloudformation', 'execute-change-set', '--change-set-name', review['changeSetId'],
                '--client-request-token', 'ke-ops00-execute-' + self.plan['sourceSha']]

    def execution_intent(self):
        intent, review = self.state.load('execute.intent.json'), self.state.load('review.json')
        require(isinstance(review, dict) and review.get('plan') == self.plan, 'EXECUTE_INTENT_REJECTED')
        self.identifiers(review.get('changeSetId'), review.get('stackId'))
        body = {k: v for k, v in review.items() if k != 'reviewHash'}
        require(review.get('reviewHash') == inventory.digest(encoded(body))
                and review.get('additions') == {k: v['Type'] for k, v in self.template['Resources'].items()}
                and intent == dict(review=review, args=self.execute_args(review)), 'EXECUTE_INTENT_REJECTED')
        return review

    def execute(self, review_hash):
        if self.state.load('execute.intent.json') is not None:
            return self.resume()
        self.identity()
        saved = self.state.load('review.json')
        require(saved is not None and re.fullmatch('[0-9a-f]{64}', review_hash or '') is not None
                and saved.get('reviewHash') == review_hash, 'REVIEW_HASH_REQUIRED')
        current = self.review()
        require(current == saved, 'REVIEW_CHANGED')
        self.conflicts(stack=False)
        args = self.execute_args(current)
        self.state.save('execute.intent.json', dict(review=current, args=args))
        self.state.save('execute.ack.json', self.aws.call(args, mutation=True))
        return 'INSTALL_SUBMITTED', None

    def resume(self):
        self.identity()
        intent = self.state.load('execute.intent.json')
        if intent is not None:
            saved = self.execution_intent()
            status = self.stack(saved['stackId']).get('StackStatus')
            if status == 'CREATE_COMPLETE':
                return self.readback(saved['stackId']), None
            require(status in ('REVIEW_IN_PROGRESS', 'CREATE_IN_PROGRESS'), 'INSTALL_RECONCILIATION_REQUIRED')
            return 'INSTALL_PENDING', None
        value = self.changeset()
        if value.get('Status') in ('CREATE_PENDING', 'CREATE_IN_PROGRESS'):
            return 'PREVIEW_PENDING', None
        require(value.get('Status') == 'CREATE_COMPLETE' and value.get('ExecutionStatus') == 'AVAILABLE',
                'PREVIEW_RECONCILIATION_REQUIRED')
        return 'REVIEW_READY', self.review()['reviewHash']

    def readback(self, stack_id=None):
        """Exact control-plane configuration only; no storage/workload writes."""
        self.identity()
        saved = self.execution_intent()
        stack_id = stack_id or saved['stackId']
        self.identifiers(saved['changeSetId'], stack_id)
        require(self.stack(stack_id).get('StackStatus') == 'CREATE_COMPLETE', 'INSTALL_NOT_COMPLETE')
        current = self.aws.call(['cloudformation', 'get-template', '--stack-name', stack_id, '--template-stage', 'Original'])
        require(same(document(current.get('TemplateBody')), self.template), 'INSTALLED_TEMPLATE_MISMATCH')
        resources = self.aws.call(['cloudformation', 'list-stack-resources', '--stack-name', stack_id]).get('StackResourceSummaries')
        require(isinstance(resources, list) and len(resources) == 4, 'INSTALLED_RESOURCES_MISMATCH')
        names = {row.get('LogicalResourceId'): row for row in resources}
        require(set(names) == set(self.template['Resources']) and all(
            row.get('ResourceType') == self.template['Resources'][name]['Type']
            and row.get('ResourceStatus') == 'CREATE_COMPLETE' for name, row in names.items()), 'INSTALLED_RESOURCES_MISMATCH')
        for name, physical in [('Journal', TABLE), ('Manifests', BUCKET), ('RecoveryRole', ROLE)]:
            require(names[name].get('PhysicalResourceId') == physical, 'INSTALLED_RESOURCES_MISMATCH')
        proposed = self.template['Resources']
        role = self.aws.call(['iam', 'get-role', '--role-name', ROLE]).get('Role', {})
        require(role.get('Arn') == f'arn:aws:iam::{ACCOUNT}:role/{ROLE}' and role.get('RoleName') == ROLE
                and role.get('MaxSessionDuration') == 3600 and 'PermissionsBoundary' not in role
                and same(document(role.get('AssumeRolePolicyDocument')), proposed['RecoveryRole']['Properties']['AssumeRolePolicyDocument']),
                'INSTALLED_ROLE_MISMATCH')
        inline = self.aws.call(['iam', 'list-role-policies', '--role-name', ROLE])
        require(inline.get('IsTruncated') is False and inline.get('PolicyNames') == ['ExactRecoveryStorage'], 'INSTALLED_POLICY_MISMATCH')
        policy = self.aws.call(['iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', 'ExactRecoveryStorage'])
        require(policy.get('RoleName') == ROLE and policy.get('PolicyName') == 'ExactRecoveryStorage'
                and same(document(policy.get('PolicyDocument')), proposed['RecoveryRole']['Properties']['Policies'][0]['PolicyDocument']),
                'INSTALLED_POLICY_MISMATCH')
        attached = self.aws.call(['iam', 'list-attached-role-policies', '--role-name', ROLE])
        require(attached.get('IsTruncated') is False and attached.get('AttachedPolicies') == [], 'INSTALLED_POLICY_MISMATCH')
        table = self.aws.call(['dynamodb', 'describe-table', '--table-name', TABLE]).get('Table', {})
        table_props = proposed['Journal']['Properties']
        attributes = table.get('AttributeDefinitions')
        require(table.get('TableArn') == f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{TABLE}' and table.get('TableStatus') == 'ACTIVE'
                and table.get('DeletionProtectionEnabled') is True and table.get('BillingModeSummary', {}).get('BillingMode') == 'PAY_PER_REQUEST'
                and table.get('SSEDescription', {}).get('Status') == 'ENABLED' and same(table.get('KeySchema'), table_props['KeySchema'])
                and isinstance(attributes, list) and same(sorted(attributes, key=lambda v: v['AttributeName']), table_props['AttributeDefinitions']),
                'INSTALLED_TABLE_MISMATCH')
        backups = self.aws.call(['dynamodb', 'describe-continuous-backups', '--table-name', TABLE])
        require(backups.get('ContinuousBackupsDescription', {}).get('PointInTimeRecoveryDescription', {}).get('PointInTimeRecoveryStatus') == 'ENABLED',
                'INSTALLED_BACKUPS_MISMATCH')
        ttl = self.aws.call(['dynamodb', 'describe-time-to-live', '--table-name', TABLE])
        require(ttl.get('TimeToLiveDescription', {}).get('TimeToLiveStatus') == 'DISABLED', 'INSTALLED_TTL_MISMATCH')
        def bucket(operation, missing=None):
            return self.aws.call(['s3api', operation, '--bucket', BUCKET, '--expected-bucket-owner', ACCOUNT], missing=missing)
        require(bucket('get-bucket-versioning').get('Status') == 'Enabled', 'INSTALLED_BUCKET_MISMATCH')
        encryption = bucket('get-bucket-encryption').get('ServerSideEncryptionConfiguration', {}).get('Rules')
        require(isinstance(encryption, list) and len(encryption) == 1 and
                encryption[0].get('ApplyServerSideEncryptionByDefault', {}).get('SSEAlgorithm') == 'AES256', 'INSTALLED_BUCKET_MISMATCH')
        require(same(bucket('get-public-access-block').get('PublicAccessBlockConfiguration'), proposed['Manifests']['Properties']['PublicAccessBlockConfiguration']),
                'INSTALLED_BUCKET_MISMATCH')
        require(same(bucket('get-bucket-ownership-controls').get('OwnershipControls', {}).get('Rules'), proposed['Manifests']['Properties']['OwnershipControls']['Rules']),
                'INSTALLED_BUCKET_MISMATCH')
        lifecycle = bucket('get-bucket-lifecycle-configuration', 'NoSuchLifecycleConfiguration')
        require(lifecycle is None or lifecycle.get('Rules') == [], 'INSTALLED_BUCKET_MISMATCH')
        require(same(document(bucket('get-bucket-policy').get('Policy')), proposed['ManifestPolicy']['Properties']['PolicyDocument']),
                'INSTALLED_BUCKET_POLICY_MISMATCH')
        self.state.save('configuration.json', dict(plan=self.plan, stackId=stack_id, result='CONFIGURATION_MATCH',
                                                   effectivePermissions='UNKNOWN', managedRecovery='NOT_EXECUTED'))
        return 'CONFIGURATION_MATCH'


def verify_checkout(source):
    require(re.fullmatch('[0-9a-f]{40}', source) is not None, 'SOURCE_REJECTED')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args], timeout=5, stderr=subprocess.DEVNULL, text=True).strip()
    require(git('rev-parse', 'HEAD') == source and git('remote', 'get-url', 'origin') == ORIGIN
            and not git('status', '--porcelain'), 'CHECKOUT_REJECTED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'resume', 'review', 'execute', 'readback'))
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--review-hash')
    args = parser.parse_args()
    state, aws = None, None
    summary = dict(result='BLOCKED', classification=None, requests=0, mutations=0,
                   effectivePermissions='UNKNOWN', managedRecovery='NOT_EXECUTED')
    try:
        verify_checkout(args.source)
        state = State(args.state, Path.home())
        aws = Aws(state)
        installer = Installer(state, args.source, (ROOT / 'infra/operations/setup.json').read_bytes(), aws)
        if args.action == 'review':
            installer.identity()
            result, review_hash = 'REVIEW_READY', installer.review()['reviewHash']
        elif args.action == 'execute':
            result, review_hash = installer.execute(args.review_hash)
        elif args.action == 'readback':
            result, review_hash = installer.readback(), None
        else:
            result, review_hash = getattr(installer, args.action)()
        summary['result'] = result
        if review_hash:
            summary['reviewHash'] = review_hash
    except Rejected as error:
        summary['classification'] = str(error)
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError):
        summary['classification'] = 'LOCAL_OR_RESPONSE_REJECTED'
    finally:
        if aws:
            summary.update(requests=aws.calls, mutations=aws.mutations)
        if state:
            state.close()
    print(json.dumps(summary))
    return int(summary['result'] == 'BLOCKED')


if __name__ == '__main__':
    raise SystemExit(main())
