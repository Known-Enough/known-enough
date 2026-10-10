#!/usr/bin/env python3
"""Fixed retained partition CREATE package; separate private state, no IAM or data.

Inventory is read-only. Prepare creates a preview, execute requires its exact
review hash, and any saved mutation intent makes subsequent recovery read-only.
Configuration matching never implies role attachment, activation or migration.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('partition_common', ROOT / 'scripts/operations/cloudshell-create.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
require, Rejected = common.require, common.Rejected
ACCOUNT, REGION = common.ACCOUNT, common.REGION
STACK, TABLE = 'KnownEnoughPartitionsStorage', 'KnownEnoughPartitions'
TABLE_ARN = f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{TABLE}'
STACK_PREFIX = f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{STACK}/'
CHANGE_PREFIX = f'arn:aws:cloudformation:{REGION}:{ACCOUNT}:changeSet/'
TEMPLATE_SHA = '262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0'
INSPECTOR = 'KnownEnoughGithubStagingInspector'


class Aws:
    """Finite private transport, reusing the checked credential/process guards."""
    def __init__(self, state, executor=common.inventory.bounded_run, clock=time.monotonic):
        self.state, self.executor, self.clock = state, executor, clock
        self.start, self.calls, self.mutations = clock(), 0, 0
        self.reads = []

    def call(self, args, *, mutation=False, missing=None):
        remaining = 180 - (self.clock() - self.start)
        require(self.calls < 32 and remaining > 0, 'REQUEST_BUDGET_EXHAUSTED')
        self.calls += 1
        self.mutations += int(mutation)
        row = dict(action=':'.join(args[:2]), status='UNKNOWN', code=None)
        self.reads.append(row)
        env = common.credential_environment()
        env.update(AWS_CLI_AUTO_PROMPT='off')
        command = ['aws', *args, '--region', REGION, '--output', 'json', '--no-cli-pager',
                   '--no-paginate', '--no-cli-auto-prompt', '--color', 'off',
                   '--cli-connect-timeout', '5', '--cli-read-timeout', '8']
        try:
            with tempfile.TemporaryFile(dir=self.state.folder) as out, tempfile.TemporaryFile(dir=self.state.folder) as err:
                result = self.executor(command, env=env, timeout=min(10, remaining), stdout=out, stderr=err, check=False)
                out.seek(0); err.seek(0)
                raw, diagnostic = out.read(131073), err.read(131073)
            require(len(raw) <= 131072 and len(diagnostic) <= 131072, 'AWS_RESPONSE_LIMIT')
            if result.returncode:
                match = re.search(rb'An error occurred \(([A-Za-z0-9]+)\)', diagnostic)
                code = match[1].decode() if match else None
                code = code if code in common.inventory.CODES else 'AWS_REQUEST_FAILED'
                row['code'] = code
                absent = (missing == 'table' and code == 'ResourceNotFoundException') or (
                    missing == 'stack' and code == 'ValidationError' and re.search(
                        rb': Stack with id ' + re.escape(STACK.encode()) + rb' does not exist\s*$', diagnostic))
                if absent:
                    row['status'] = 'ABSENT'
                    return None
                raise Rejected(code)
            if mutation and args[:2] == ['cloudformation', 'execute-change-set'] and not raw.strip():
                value = {}
            else:
                value = json.loads(raw)
            require(isinstance(value, dict) and value.get('IsTruncated', False) is False
                    and all(value.get(k) in (None, '') for k in ('NextToken', 'NextMarker', 'Marker')),
                    'AWS_RESPONSE_REJECTED')
            row['status'] = 'ACK' if mutation else 'READ'
            return value
        except common.inventory.ResponseLimit:
            raise Rejected('AWS_RESPONSE_LIMIT') from None
        except subprocess.TimeoutExpired:
            raise Rejected('AWS_REQUEST_TIMEOUT') from None
        except FileNotFoundError:
            raise Rejected('AWS_CLI_UNAVAILABLE') from None
        except (ValueError, UnicodeError):
            raise Rejected('AWS_RESPONSE_REJECTED') from None


class Installer:
    def __init__(self, state, source, template, aws, github=False):
        require(re.fullmatch('[0-9a-f]{40}', source) is not None, 'SOURCE_REJECTED')
        require(common.inventory.digest(template) == TEMPLATE_SHA, 'TEMPLATE_REJECTED')
        self.state, self.aws, self.template, self.github = state, aws, json.loads(template), github
        self.plan = dict(schemaVersion=1, sourceSha=source, templateSha=TEMPLATE_SHA, account=ACCOUNT,
                         region=REGION, stack=STACK, table=TABLE, type='CREATE',
                         changeSet='ke-partition-create-' + source[:20], clientToken='ke-partition-create-' + source)
        # Different filenames and plan bindings never consume the recovery installer state.
        state.save('partition.plan.json', self.plan)
        state.save_bytes('partition.template.json', template)

    def identity(self):
        value = self.aws.call(['sts', 'get-caller-identity'])
        arn = value.get('Arn')
        require(value.get('Account') == ACCOUNT and isinstance(arn, str) and (
            arn == f'arn:aws:iam::{ACCOUNT}:root' or re.fullmatch(
                rf'arn:aws:(?:iam::{ACCOUNT}:user/[A-Za-z0-9+=,.@_/-]+|sts::{ACCOUNT}:assumed-role/[A-Za-z0-9+=,.@_/-]+)', arn)),
                'IDENTITY_REJECTED')
        if self.github:
            require(re.fullmatch(rf'arn:aws:sts::{ACCOUNT}:assumed-role/{INSPECTOR}/[A-Za-z0-9+=,.@_-]+', arn),
                    'INSPECTOR_IDENTITY_REJECTED')

    def create_args(self):
        return ['cloudformation', 'create-change-set', '--stack-name', STACK,
                '--change-set-name', self.plan['changeSet'], '--change-set-type', 'CREATE',
                '--resource-types', 'AWS::DynamoDB::Table', '--on-stack-failure', 'DO_NOTHING',
                '--no-import-existing-resources', '--no-include-nested-stacks',
                '--client-token', self.plan['clientToken'],
                '--template-body', 'file://' + str(self.state.folder / 'partition.template.json')]

    def inventory(self):
        self.identity()
        table = self.aws.call(['dynamodb', 'describe-table', '--table-name', TABLE], missing='table')
        stack = self.aws.call(['cloudformation', 'describe-stacks', '--stack-name', STACK], missing='stack')
        if table is None and stack is None:
            return 'CREATE_REQUIRED'
        if table is None or stack is None:
            return 'EXISTING_RESOURCE_RECONCILIATION_REQUIRED'
        rows = stack.get('Stacks')
        require(isinstance(rows, list) and len(rows) == 1, 'STACK_TARGET_REJECTED')
        stack_id = rows[0].get('StackId')
        self.identifiers(None, stack_id)
        if rows[0].get('StackStatus') != 'CREATE_COMPLETE':
            return 'EXISTING_RESOURCE_RECONCILIATION_REQUIRED'
        return self.configuration(stack_id)

    def prepare(self):
        if self.state.load('partition.create.intent.json') is not None:
            return self.resume()
        require(self.inventory() == 'CREATE_REQUIRED', 'EXISTING_RESOURCE_RECONCILIATION_REQUIRED')
        validation = self.aws.call(['cloudformation', 'validate-template', '--template-body',
                                    'file://' + str(self.state.folder / 'partition.template.json')])
        require(validation.get('Capabilities') in (None, []) and validation.get('Parameters') in (None, []),
                'TEMPLATE_CAPABILITIES_REJECTED')
        args = self.create_args()
        self.state.save('partition.create.intent.json', dict(plan=self.plan, args=args))
        value = self.aws.call(args, mutation=True)
        self.identifiers(value.get('Id'), value.get('StackId'), change_required=True)
        self.state.save('partition.create.ack.json', value)
        return 'PREVIEW_SUBMITTED', None

    def identifiers(self, change, stack, change_required=False):
        require(isinstance(stack, str) and re.fullmatch(re.escape(STACK_PREFIX) + '[A-Za-z0-9-]+', stack),
                'STACK_TARGET_REJECTED')
        if change_required or change is not None:
            require(isinstance(change, str) and re.fullmatch(re.escape(CHANGE_PREFIX + self.plan['changeSet'] + '/')
                    + '[A-Za-z0-9-]+', change), 'CHANGESET_TARGET_REJECTED')
            ack = self.state.load('partition.create.ack.json')
            require(ack is None or (change == ack.get('Id') and stack == ack.get('StackId')), 'CHANGESET_TARGET_CHANGED')

    def stack(self, stack_id):
        self.identifiers(None, stack_id)
        value = self.aws.call(['cloudformation', 'describe-stacks', '--stack-name', stack_id])
        rows = value.get('Stacks')
        require(isinstance(rows, list) and len(rows) == 1 and rows[0].get('StackName') == STACK
                and rows[0].get('StackId') == stack_id and not rows[0].get('RoleARN'), 'STACK_TARGET_REJECTED')
        return rows[0]

    def review(self):
        require(common.same(self.state.load('partition.create.intent.json'), dict(plan=self.plan, args=self.create_args())),
                'CREATE_INTENT_REQUIRED')
        value = self.aws.call(['cloudformation', 'describe-change-set', '--stack-name', STACK,
                               '--change-set-name', self.plan['changeSet']])
        self.identifiers(value.get('ChangeSetId'), value.get('StackId'), change_required=True)
        require(value.get('ChangeSetName') == self.plan['changeSet'] and value.get('StackName') == STACK,
                'CHANGESET_TARGET_REJECTED')
        if value.get('Status') in ('CREATE_PENDING', 'CREATE_IN_PROGRESS'):
            return None
        require(value.get('Status') == 'CREATE_COMPLETE' and value.get('ExecutionStatus') == 'AVAILABLE',
                'PREVIEW_RECONCILIATION_REQUIRED')
        require(value.get('Capabilities') in (None, []) and value.get('Parameters') in (None, [])
                and value.get('NotificationARNs') in (None, []) and not value.get('RoleARN')
                and (value.get('ImportExistingResources') is None or value.get('ImportExistingResources') is False)
                and (value.get('IncludeNestedStacks') is None or value.get('IncludeNestedStacks') is False)
                and not value.get('ParentChangeSetId') and not value.get('RootChangeSetId')
                and value.get('OnStackFailure') == 'DO_NOTHING'
                and value.get('DeploymentMode') in (None, 'STANDARD'), 'PREVIEW_SCOPE_REJECTED')
        changes = value.get('Changes')
        require(isinstance(changes, list) and len(changes) == 1, 'PREVIEW_SCOPE_REJECTED')
        change = changes[0].get('ResourceChange', {})
        require(changes[0].get('Type') == 'Resource' and change.get('Action') == 'Add'
                and change.get('LogicalResourceId') == 'Partitions' and change.get('ResourceType') == 'AWS::DynamoDB::Table'
                and change.get('Replacement') in (None, 'False') and not change.get('ChangeSetId'), 'PREVIEW_SCOPE_REJECTED')
        arn, stack_id = value['ChangeSetId'], value['StackId']
        preview = self.aws.call(['cloudformation', 'get-template', '--stack-name', stack_id,
                                 '--change-set-name', arn, '--template-stage', 'Original'])
        require(common.same(common.document(preview.get('TemplateBody')), self.template), 'PREVIEW_TEMPLATE_REJECTED')
        require(self.stack(stack_id).get('StackStatus') == 'REVIEW_IN_PROGRESS', 'STACK_NOT_REVIEWABLE')
        record = dict(plan=self.plan, changeSetId=arn, stackId=stack_id, additions={'Partitions': 'AWS::DynamoDB::Table'})
        record['reviewHash'] = common.inventory.digest(common.encoded(record))
        self.state.save('partition.review.json', record)
        return record

    def execute_args(self, review):
        return ['cloudformation', 'execute-change-set', '--change-set-name', review['changeSetId'],
                '--client-request-token', 'ke-partition-execute-' + self.plan['sourceSha']]

    def execution_intent(self):
        intent, review = self.state.load('partition.execute.intent.json'), self.state.load('partition.review.json')
        require(isinstance(review, dict) and common.same(review.get('plan'), self.plan), 'EXECUTE_INTENT_REJECTED')
        self.identifiers(review.get('changeSetId'), review.get('stackId'), change_required=True)
        body = {k: v for k, v in review.items() if k != 'reviewHash'}
        require(review.get('reviewHash') == common.inventory.digest(common.encoded(body))
                and common.same(review.get('additions'), {'Partitions': 'AWS::DynamoDB::Table'})
                and common.same(intent, dict(review=review, args=self.execute_args(review))), 'EXECUTE_INTENT_REJECTED')
        return review

    def execute(self, review_hash):
        if self.state.load('partition.execute.intent.json') is not None:
            return self.resume()
        self.identity()
        saved = self.state.load('partition.review.json')
        require(isinstance(saved, dict) and re.fullmatch('[0-9a-f]{64}', review_hash or '')
                and saved.get('reviewHash') == review_hash, 'REVIEW_HASH_REQUIRED')
        require(common.same(self.review(), saved), 'REVIEW_CHANGED')
        require(self.aws.call(['dynamodb', 'describe-table', '--table-name', TABLE], missing='table') is None,
                'TABLE_ALREADY_EXISTS')
        args = self.execute_args(saved)
        self.state.save('partition.execute.intent.json', dict(review=saved, args=args))
        self.state.save('partition.execute.ack.json', self.aws.call(args, mutation=True))
        return 'INSTALL_SUBMITTED', None

    def resume(self):
        self.identity()
        if self.state.load('partition.execute.intent.json') is not None:
            saved = self.execution_intent()
            status = self.stack(saved['stackId']).get('StackStatus')
            if status == 'CREATE_COMPLETE':
                return self.configuration(saved['stackId']), None
            require(status in ('REVIEW_IN_PROGRESS', 'CREATE_IN_PROGRESS'), 'INSTALL_RECONCILIATION_REQUIRED')
            return 'INSTALL_PENDING', None
        review = self.review()
        return ('REVIEW_READY', review['reviewHash']) if review else ('PREVIEW_PENDING', None)

    def configuration(self, stack_id):
        require(self.stack(stack_id).get('StackStatus') == 'CREATE_COMPLETE', 'INSTALL_NOT_COMPLETE')
        current = self.aws.call(['cloudformation', 'get-template', '--stack-name', stack_id, '--template-stage', 'Original'])
        require(common.same(common.document(current.get('TemplateBody')), self.template), 'INSTALLED_TEMPLATE_MISMATCH')
        resources = self.aws.call(['cloudformation', 'list-stack-resources', '--stack-name', stack_id]).get('StackResourceSummaries')
        require(isinstance(resources, list) and len(resources) == 1
                and resources[0].get('LogicalResourceId') == 'Partitions'
                and resources[0].get('ResourceType') == 'AWS::DynamoDB::Table'
                and resources[0].get('PhysicalResourceId') == TABLE
                and resources[0].get('ResourceStatus') == 'CREATE_COMPLETE', 'INSTALLED_RESOURCES_MISMATCH')
        table = self.aws.call(['dynamodb', 'describe-table', '--table-name', TABLE]).get('Table', {})
        props = self.template['Resources']['Partitions']['Properties']
        attrs = table.get('AttributeDefinitions')
        require(table.get('TableArn') == TABLE_ARN and table.get('TableStatus') == 'ACTIVE'
                and table.get('DeletionProtectionEnabled') is True
                and table.get('BillingModeSummary', {}).get('BillingMode') == 'PAY_PER_REQUEST'
                and table.get('SSEDescription', {}).get('Status') == 'ENABLED'
                and common.same(table.get('KeySchema'), props['KeySchema']) and isinstance(attrs, list)
                and common.same(sorted(attrs, key=lambda v: v['AttributeName']), props['AttributeDefinitions'])
                and table.get('GlobalSecondaryIndexes') in (None, []) and table.get('LocalSecondaryIndexes') in (None, [])
                and table.get('StreamSpecification', {}).get('StreamEnabled', False) is False, 'INSTALLED_TABLE_MISMATCH')
        backups = self.aws.call(['dynamodb', 'describe-continuous-backups', '--table-name', TABLE])
        require(backups.get('ContinuousBackupsDescription', {}).get('PointInTimeRecoveryDescription', {}).get('PointInTimeRecoveryStatus')
                == 'ENABLED', 'INSTALLED_BACKUPS_MISMATCH')
        ttl = self.aws.call(['dynamodb', 'describe-time-to-live', '--table-name', TABLE])
        require(ttl.get('TimeToLiveDescription', {}).get('TimeToLiveStatus') == 'DISABLED', 'INSTALLED_TTL_MISMATCH')
        return 'CONFIGURATION_MATCH'


def verify_checkout(source, github):
    common.verify_checkout(source)
    branch = subprocess.check_output(['git', '-C', str(ROOT), 'branch', '--show-current'], text=True, timeout=5).strip()
    require(branch == 'main' or (github and branch == ''), 'MAIN_REQUIRED')
    if github:
        require(all(os.environ.get(k) == v for k, v in {
            'GITHUB_REPOSITORY': 'Known-Enough/known-enough', 'GITHUB_REF': 'refs/heads/main',
            'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_ACTOR': 'Battosai1806',
            'GITHUB_ACTOR_ID': '143764700', 'GITHUB_SHA': source,
            'EXPECTED_SOURCE': source}.items()), 'GITHUB_SOURCE_REJECTED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('inventory', 'prepare', 'resume', 'review', 'execute', 'readback'))
    parser.add_argument('--source', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--review-hash')
    args = parser.parse_args()
    state, aws = None, None
    summary = dict(schemaVersion=1, sourceSha=args.source if re.fullmatch('[0-9a-f]{40}', args.source) else None,
                   account=ACCOUNT, region=REGION, table=TABLE, stack=STACK, templateSha=TEMPLATE_SHA,
                   result='BLOCKED', classification=None, requests=0, mutations=0,
                   effectivePermissions='UNKNOWN', roleAttachment='NOT_EXECUTED', activation='DISABLED',
                   migration='NOT_EXECUTED', managedRecovery='NOT_EXECUTED')
    try:
        github = os.environ.get('GITHUB_ACTIONS') == 'true'
        verify_checkout(args.source, github)
        # The installed inspector path is permanently read-only, even with valid own-source input.
        require(not github or args.action == 'inventory', 'GITHUB_READ_ONLY')
        require(Path(args.state).name.startswith('ops00-partition-'), 'SEPARATE_PARTITION_STATE_REQUIRED')
        state = common.State(args.state, Path.home())
        aws = Aws(state)
        installer = Installer(state, args.source, (ROOT / 'infra/operations/partition-setup.json').read_bytes(), aws, github)
        review_hash = None
        if args.action == 'inventory':
            result = installer.inventory()
        elif args.action == 'readback':
            installer.identity()
            result = installer.configuration(installer.execution_intent()['stackId'])
        elif args.action == 'review':
            result, review_hash = installer.resume()
        else:
            result, review_hash = installer.execute(args.review_hash) if args.action == 'execute' else getattr(installer, args.action)()
        summary['result'] = result
        if review_hash:
            summary['reviewHash'] = review_hash
    except Rejected as error:
        summary['classification'] = str(error)
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError):
        summary['classification'] = 'LOCAL_OR_RESPONSE_REJECTED'
    finally:
        if aws:
            summary.update(requests=aws.calls, mutations=aws.mutations, reads=aws.reads)
        if state:
            state.close()
    print(json.dumps(summary))
    return int(summary['result'] == 'BLOCKED')


if __name__ == '__main__':
    raise SystemExit(main())
