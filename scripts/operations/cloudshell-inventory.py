#!/usr/bin/env python3
"""Read-only OPS00 setup inventory. Full metadata stays in private HOME storage."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

ACCOUNT = '092954139775'
REGION = 'us-east-1'
SUBJECT = 'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main'
PROVIDER = f'arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com'
BUCKET = f'known-enough-operations-recovery-{ACCOUNT}-{REGION}'
ROLE = 'KnownEnoughGithubOperationsRecovery'
TABLES = ('KnownEnoughOperationsJournal', 'KnownEnoughPartitions', 'KnownEnoughGroupsStage',
          'KnownEnoughStage', 'KnownEnoughQaControl')
ROLES = (ROLE, 'KnownEnoughStageApiRole', 'KnownEnoughGithubStagingInspector',
         'KnownEnoughGithubPrimaryRelease', 'KnownEnoughGithubQaRelease', 'KnownEnoughGithubQaTest')
CODES = frozenset(('AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation',
                  'NoSuchEntity', 'NoSuchBucket', 'ResourceNotFoundException',
                  'NoSuchLifecycleConfiguration', 'ValidationError', 'ExpiredToken',
                  'ExpiredTokenException', 'InvalidClientTokenId', 'Throttling', 'ThrottlingException'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def comparison_metadata_valid(args, value):
    """Require typed comparison fields before interpreting a metadata read."""
    if args[:2] == ['iam', 'get-open-id-connect-provider']:
        audiences = value.get('ClientIDList')
        return (isinstance(value.get('Url'), str) and isinstance(audiences, list)
                and all(isinstance(audience, str) for audience in audiences))
    if args[:2] == ['iam', 'get-role']:
        role = value.get('Role')
        return isinstance(role, dict) and isinstance(role.get('AssumeRolePolicyDocument'), dict)
    return True


def private_write(path, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    return digest(data)


def persistent_dir(path, home):
    """Reject symlinks, foreign owners, loose permissions and anything outside HOME."""
    home = Path(home).resolve(strict=True)
    path = Path(path).absolute()
    if path == home or not path.is_relative_to(home):
        raise ValueError('OPS_HOME_REQUIRED')
    current = home
    for part in path.relative_to(home).parts:
        if part in ('.', '..'):
            raise ValueError('OPS_STATE_PATH_REJECTED')
        current = current / part
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            pass
        stat = current.lstat()
        if current.is_symlink() or not current.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
            raise ValueError('OPS_PRIVATE_DIRECTORY_REQUIRED')
    return path


class Inventory:
    def __init__(self, folder, source, executor=subprocess.run, clock=time.monotonic):
        self.folder, self.execute, self.clock = folder, executor, clock
        self.start = clock()
        self.report = dict(schemaVersion=1, sourceSha=source, account=ACCOUNT, region=REGION,
                           observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                           result='INVENTORY_REQUIRED', mutations=0, requests=0,
                           identity='UNKNOWN', setupCapabilities='UNKNOWN',
                           effectivePermissions='UNKNOWN', managedProof='NOT_EXECUTED',
                           expectedOidcSubject=SUBJECT, reads=[], configuration={})

    def read(self, name, args, absent=None, missing_stack=None):
        row = dict(id=name, status='UNKNOWN', code=None)
        self.report['reads'].append(row)
        remaining = 180 - (self.clock() - self.start)
        if self.report['requests'] >= 64 or remaining <= 0:
            row['code'] = 'READ_BUDGET_EXHAUSTED'
            return None
        self.report['requests'] += 1
        env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_ENDPOINT_URL')}
        env.update(AWS_MAX_ATTEMPTS='1', AWS_RETRY_MODE='standard', AWS_PAGER='',
                   AWS_REGION=REGION, AWS_DEFAULT_REGION=REGION)
        command = ['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager', '--no-paginate',
                   '--cli-connect-timeout', '5', '--cli-read-timeout', '8']
        try:
            # TemporaryFile also bounds captured output without keeping a pipe blocked.
            import tempfile
            with tempfile.TemporaryFile(dir=self.folder) as out, tempfile.TemporaryFile(dir=self.folder) as err:
                result = self.execute(command, env=env, timeout=min(10, remaining), stdout=out, stderr=err, check=False)
                out.seek(0); err.seek(0)
                raw = out.read(131073); diagnostic = err.read(131073)
            if len(raw) > 131072 or len(diagnostic) > 131072:
                row['code'] = 'AWS_RESPONSE_LIMIT'
                return None
            if result.returncode:
                match = re.search(rb'An error occurred \(([A-Za-z0-9]+)\)', diagnostic)
                code = match[1].decode() if match else None
                row['code'] = code if code in CODES else 'AWS_READ_FAILED'
                if row['code'] == absent:
                    row['status'] = 'ABSENT'
                # CF ValidationError alone is NOT absence; require its exact known-stack message.
                if missing_stack and code == 'ValidationError' and re.search(
                        rb': Stack with id ' + re.escape(missing_stack.encode()) + rb' does not exist\s*$', diagnostic):
                    row['status'] = 'ABSENT'
                return None
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError('AWS_RESPONSE_SHAPE')
            if value.get('IsTruncated') is True or any(
                    value.get(k) for k in ('NextToken', 'Marker', 'NextMarker')):
                row['code'] = 'AWS_INCOMPLETE_RESPONSE'
                return None
            if not comparison_metadata_valid(args, value):
                raise ValueError('AWS_COMPARISON_METADATA_SHAPE')
            row['metadataHash'] = private_write(self.folder / (name + '.json'), value)
            row['status'] = 'READ'
            return value
        except subprocess.TimeoutExpired:
            row['code'] = 'AWS_READ_TIMEOUT'
        except FileNotFoundError:
            row['code'] = 'AWS_CLI_UNAVAILABLE'
        except (ValueError, UnicodeError):
            row['code'] = 'AWS_RESPONSE_REJECTED'
        return None

    def collect(self):
        r = self.report
        identity = self.read('identity', ['sts', 'get-caller-identity'])
        if not identity or identity.get('Account') != ACCOUNT or not isinstance(identity.get('Arn'), str):
            r['identity'] = 'REJECTED'
            return r
        arn = identity['Arn']
        # Account verification permits metadata reads only, including the exact root ARN.
        if not (arn == f'arn:aws:iam::{ACCOUNT}:root'
                or re.fullmatch(f'arn:aws:sts::{ACCOUNT}:assumed-role/[^/]+/[^/]+', arn)
                or re.fullmatch(f'arn:aws:iam::{ACCOUNT}:user/[A-Za-z0-9+=,.@_/-]+', arn)):
            r['identity'] = 'REJECTED'
            return r
        r['identity'] = 'VERIFIED_ACCOUNT_ONLY'
        for stack in ('KnownEnoughOperationsRecovery', 'KnownEnoughPartitionsStorage', 'known-enough-live-qa'):
            v = self.read(stack, ['cloudformation', 'describe-stacks', '--stack-name', stack], missing_stack=stack)
            if v:
                for op in ('get-template', 'list-stack-resources'):
                    self.read(stack + '-' + op, ['cloudformation', op, '--stack-name', stack])
        provider = self.read('oidc', ['iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', PROVIDER], 'NoSuchEntity')
        r['configuration']['oidcAudience'] = ('MATCH' if provider.get('Url') == 'token.actions.githubusercontent.com'
                and 'sts.amazonaws.com' in provider.get('ClientIDList', []) else 'MISMATCH') if provider else 'UNKNOWN'
        r['configuration']['recoveryTrust'] = 'UNKNOWN'
        for role in ROLES:
            v = self.read(role, ['iam', 'get-role', '--role-name', role], 'NoSuchEntity')
            if not v:
                continue
            if role == ROLE:
                expected = dict(Version='2012-10-17', Statement=[dict(Effect='Allow', Principal=dict(Federated=PROVIDER),
                        Action='sts:AssumeRoleWithWebIdentity', Condition=dict(StringEquals={
                            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                            'token.actions.githubusercontent.com:sub': SUBJECT}))])
                r['configuration']['recoveryTrust'] = ('MATCH' if v.get('Role', {}).get('AssumeRolePolicyDocument') == expected else 'MISMATCH')
            names = self.read(role + '-inline', ['iam', 'list-role-policies', '--role-name', role])
            self.read(role + '-attached', ['iam', 'list-attached-role-policies', '--role-name', role])
            if names and isinstance(names.get('PolicyNames'), list) and len(names['PolicyNames']) <= 4:
                for i, name in enumerate(names['PolicyNames']):
                    if isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9+=,.@_-]{1,128}', name):
                        self.read(role + f'-policy-{i}', ['iam', 'get-role-policy', '--role-name', role, '--policy-name', name])
            elif names:
                r['configuration'][role + '-policies'] = 'INCOMPLETE'
        for table in TABLES:
            v = self.read(table, ['dynamodb', 'describe-table', '--table-name', table], 'ResourceNotFoundException')
            if v:
                for op in ('describe-continuous-backups', 'describe-time-to-live'):
                    self.read(table + '-' + op, ['dynamodb', op, '--table-name', table])
        for op in ('get-bucket-versioning', 'get-bucket-encryption', 'get-public-access-block',
                   'get-bucket-ownership-controls', 'get-bucket-lifecycle-configuration', 'get-bucket-policy'):
            missing = 'NoSuchLifecycleConfiguration' if op == 'get-bucket-lifecycle-configuration' else 'NoSuchBucket'
            self.read(op, ['s3api', op, '--bucket', BUCKET, '--expected-bucket-owner', ACCOUNT], missing)
            if r['reads'][-1]['code'] == 'NoSuchBucket':
                break
        # Primary auth/runtime metadata only: no ListUsers, rows, secrets or presigned ZIP URL.
        self.read('primary-runtime', ['lambda', 'get-function-configuration', '--function-name', 'known-enough-stage-api'])
        self.read('primary-pool', ['cognito-idp', 'describe-user-pool', '--user-pool-id', 'us-east-1_V9OMjd0zx'])
        for name, client in (('participant', '3accf7paalvon2m8ue8okfi853'), ('display', '481ru24906sv26f30i569gq8g0')):
            self.read('primary-' + name, ['cognito-idp', 'describe-user-pool-client', '--user-pool-id',
                      'us-east-1_V9OMjd0zx', '--client-id', client])
        return r


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.source_sha):
        raise ValueError('OPS_SOURCE_REJECTED')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if actual != args.source_sha or subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip():
        raise ValueError('OPS_CHECKOUT_REJECTED')
    folder = persistent_dir(args.state_dir, Path.home())
    fd = os.open(folder / 'inventory.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        template_hash = digest(Path('infra/operations/setup.json').read_bytes())
        expected = dict(sourceSha=args.source_sha, templateHash=template_hash, account=ACCOUNT, region=REGION)
        marker = folder / 'source.json'
        if marker.exists() or marker.is_symlink():
            if marker.is_symlink() or marker.stat().st_mode & 0o077 or json.loads(marker.read_text()) != expected:
                raise ValueError('OPS_SAVED_SOURCE_MISMATCH')
        else:
            private_write(marker, expected)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        attempt = folder / ('inventory-' + stamp)
        attempt.mkdir(mode=0o700)
        result = Inventory(attempt, args.source_sha).collect()
        result['templateHash'] = template_hash
        private_write(attempt / 'summary.json', result)
        print(json.dumps(result, indent=2))
        print('Private inventory saved; return only this allowlisted summary. No AWS write executed.')
        if result['identity'] != 'VERIFIED_ACCOUNT_ONLY':
            return 1
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError):
        print('OPS_INVENTORY_STOPPED: preserve existing HOME state; do not run installation.')
        raise SystemExit(1)
