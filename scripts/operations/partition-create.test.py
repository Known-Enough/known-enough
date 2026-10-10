#!/usr/bin/env python3
"""Offline retained-storage and mutation recovery tests. No AWS credentials."""
import copy
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('partition_package', HERE / 'partition-create.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = 'a' * 40
TEMPLATE = (module.ROOT / 'infra/operations/partition-setup.json').read_bytes()
PROPOSED = json.loads(TEMPLATE)['Resources']['Partitions']['Properties']
STACK_ID = module.STACK_PREFIX + 'synthetic-stack'
CHANGE_ID = module.CHANGE_PREFIX + 'ke-partition-create-' + SOURCE[:20] + '/synthetic-change'


class FakeAws:
    def __init__(self):
        self.calls, self.overrides, self.lost = [], {}, set()
        self.created, self.executed, self.installed = False, False, False
        self.preview = dict(ChangeSetId=CHANGE_ID, ChangeSetName='ke-partition-create-' + SOURCE[:20],
                            StackId=STACK_ID, StackName=module.STACK, Status='CREATE_COMPLETE',
                            ExecutionStatus='AVAILABLE', Capabilities=[], OnStackFailure='DO_NOTHING',
                            Changes=[dict(Type='Resource', ResourceChange=dict(Action='Add',
                                LogicalResourceId='Partitions', ResourceType='AWS::DynamoDB::Table'))])

    def response(self, operation):
        if operation in self.overrides:
            return self.overrides[operation]
        if operation == 'get-caller-identity':
            return dict(Account=module.ACCOUNT, Arn=f'arn:aws:sts::{module.ACCOUNT}:assumed-role/{module.INSPECTOR}/synthetic')
        if operation == 'describe-stacks':
            if not self.created:
                return ('ValidationError', f'Stack with id {module.STACK} does not exist')
            return dict(Stacks=[dict(StackName=module.STACK, StackId=STACK_ID,
                StackStatus='CREATE_COMPLETE' if self.installed else 'CREATE_IN_PROGRESS' if self.executed else 'REVIEW_IN_PROGRESS')])
        if operation == 'describe-table':
            if not self.installed:
                return ('ResourceNotFoundException', 'synthetic absent')
            return dict(Table=dict(TableArn=module.TABLE_ARN, TableStatus='ACTIVE', DeletionProtectionEnabled=True,
                BillingModeSummary=dict(BillingMode='PAY_PER_REQUEST'), SSEDescription=dict(Status='ENABLED'),
                KeySchema=PROPOSED['KeySchema'], AttributeDefinitions=PROPOSED['AttributeDefinitions']))
        if operation == 'validate-template':
            return dict(Capabilities=[], Parameters=[])
        if operation == 'describe-change-set':
            return self.preview
        if operation == 'get-template':
            return dict(TemplateBody=json.loads(TEMPLATE))
        if operation == 'list-stack-resources':
            return dict(StackResourceSummaries=[dict(LogicalResourceId='Partitions', ResourceType='AWS::DynamoDB::Table',
                PhysicalResourceId=module.TABLE, ResourceStatus='CREATE_COMPLETE')])
        if operation == 'describe-continuous-backups':
            return dict(ContinuousBackupsDescription=dict(PointInTimeRecoveryDescription=dict(PointInTimeRecoveryStatus='ENABLED')))
        if operation == 'describe-time-to-live':
            return dict(TimeToLiveDescription=dict(TimeToLiveStatus='DISABLED'))
        raise AssertionError(operation)

    def __call__(self, command, **options):
        self.calls.append(command)
        operation = command[2]
        assert options['timeout'] <= 10
        assert options['env']['AWS_MAX_ATTEMPTS'] == '1'
        assert options['env']['AWS_CONFIG_FILE'] == '/dev/null'
        assert command[command.index('--region') + 1] == module.REGION
        if operation == 'create-change-set':
            assert command[command.index('--change-set-type') + 1] == 'CREATE'
            assert '--capabilities' not in command and '--role-arn' not in command
            assert command[command.index('--resource-types') + 1] == 'AWS::DynamoDB::Table'
            assert command[command.index('--on-stack-failure') + 1] == 'DO_NOTHING'
            assert Path(command[command.index('--template-body') + 1][7:]).read_bytes() == TEMPLATE
            self.created = True
            value = dict(Id=CHANGE_ID, StackId=STACK_ID)
        elif operation == 'execute-change-set':
            assert command[command.index('--change-set-name') + 1] == CHANGE_ID
            self.executed = True
            value = {}
        else:
            value = self.response(operation)
        if operation in self.lost:
            raise subprocess.TimeoutExpired(command, options['timeout'])
        if isinstance(value, tuple):
            options['stderr'].write(f'An error occurred ({value[0]}) when calling the request: {value[1]}'.encode())
            return subprocess.CompletedProcess(command, 1)
        options['stdout'].write(json.dumps(value).encode())
        return subprocess.CompletedProcess(command, 0)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.state = module.common.State(self.home / 'ops00-partition-test', self.home)
        self.addCleanup(self.state.close)
        self.fake = FakeAws()
        self.aws = module.Aws(self.state, self.fake)
        self.installer = module.Installer(self.state, SOURCE, TEMPLATE, self.aws)

    def prepared_review(self):
        self.assertEqual(self.installer.prepare(), ('PREVIEW_SUBMITTED', None))
        return self.installer.resume()[1]

    def mutation_count(self):
        return sum(c[2] in ('create-change-set', 'execute-change-set') for c in self.fake.calls)

    def test_absence_inventory_has_only_three_fixed_reads(self):
        self.assertEqual(self.installer.inventory(), 'CREATE_REQUIRED')
        self.assertEqual([c[2] for c in self.fake.calls], ['get-caller-identity', 'describe-table', 'describe-stacks'])
        self.assertEqual(self.aws.mutations, 0)
        self.assertEqual([r['status'] for r in self.aws.reads], ['READ', 'ABSENT', 'ABSENT'])

    def test_deny_or_other_validation_never_becomes_absence(self):
        for operation, error in [('describe-table', ('AccessDeniedException', 'private diagnostic')),
                                 ('describe-stacks', ('ValidationError', 'unrelated invalid parameters')),
                                 ('describe-stacks', ('ValidationError', 'Stack with id OTHER does not exist'))]:
            with self.subTest(operation=operation, error=error):
                self.fake.overrides = {operation: error}
                with self.assertRaises(module.Rejected):
                    self.installer.prepare()
                self.assertEqual(self.mutation_count(), 0)
                self.assertIsNone(self.state.load('partition.create.intent.json'))

    def test_foreign_identity_stops_before_resource_reads(self):
        self.fake.overrides['get-caller-identity'] = dict(Account='000000000000', Arn='private identity')
        with self.assertRaisesRegex(module.Rejected, 'IDENTITY_REJECTED'):
            self.installer.inventory()
        self.assertEqual(len(self.fake.calls), 1)

    def test_github_requires_exact_installed_inspector_identity(self):
        self.installer.github = True
        self.fake.overrides['get-caller-identity'] = dict(Account=module.ACCOUNT, Arn=f'arn:aws:iam::{module.ACCOUNT}:root')
        with self.assertRaisesRegex(module.Rejected, 'INSPECTOR_IDENTITY_REJECTED'):
            self.installer.inventory()
        self.assertEqual(len(self.fake.calls), 1)

    def test_existing_conflicting_target_or_stack_never_mutated(self):
        self.fake.installed = True
        with self.assertRaisesRegex(module.Rejected, 'EXISTING_RESOURCE_RECONCILIATION_REQUIRED'):
            self.installer.prepare()
        self.assertEqual(self.mutation_count(), 0)

    def test_same_source_durable_plan_and_template_and_exclusive_preview(self):
        self.installer.prepare()
        self.assertEqual(self.state.load('partition.plan.json')['table'], module.TABLE)
        self.assertEqual((self.state.folder / 'partition.template.json').read_bytes(), TEMPLATE)
        self.assertIsNotNone(self.state.load('partition.create.intent.json'))
        self.assertEqual(self.installer.prepare()[0], 'REVIEW_READY')
        self.assertEqual(self.mutation_count(), 1)
        self.assertFalse((self.state.folder / 'plan.json').exists())

    def test_source_template_or_plan_change_rejected_without_aws(self):
        for source, template in [('b' * 40, TEMPLATE), (SOURCE, TEMPLATE + b' '), ('invalid', TEMPLATE)]:
            with self.subTest(source=source):
                with self.assertRaises((module.Rejected, ValueError)):
                    module.Installer(self.state, source, template, self.aws)
        self.assertEqual(self.fake.calls, [])

    def test_lost_preview_ack_resumes_reads_only(self):
        self.fake.lost.add('create-change-set')
        with self.assertRaisesRegex(module.Rejected, 'AWS_REQUEST_TIMEOUT'):
            self.installer.prepare()
        self.fake.lost.clear()
        self.assertEqual(self.installer.prepare()[0], 'REVIEW_READY')
        self.assertEqual(self.mutation_count(), 1)

    def test_preview_rejects_iam_imports_replacement_and_stack_role(self):
        self.installer.prepare()
        original = copy.deepcopy(self.fake.preview)
        variants = [dict(Capabilities=['CAPABILITY_IAM']), dict(ImportExistingResources=True),
                    dict(ImportExistingResources=0), dict(IncludeNestedStacks=0),
                    dict(RoleARN='private role'), dict(OnStackFailure='ROLLBACK'),
                    dict(Changes=[dict(Type='Resource', ResourceChange=dict(Action='Modify', LogicalResourceId='Partitions',
                        ResourceType='AWS::DynamoDB::Table'))]),
                    dict(Changes=original['Changes'] * 2)]
        for change in variants:
            with self.subTest(change=change):
                self.fake.preview = dict(original, **change)
                with self.assertRaisesRegex(module.Rejected, 'PREVIEW_SCOPE_REJECTED'):
                    self.installer.resume()
        self.assertEqual(self.mutation_count(), 1)

    def test_preview_template_drift_or_foreign_changeset_stops_execution(self):
        self.installer.prepare()
        self.fake.overrides['get-template'] = dict(TemplateBody=dict(Resources={}))
        with self.assertRaisesRegex(module.Rejected, 'PREVIEW_TEMPLATE_REJECTED'):
            self.installer.resume()
        self.fake.overrides.clear()
        self.fake.preview['ChangeSetId'] = CHANGE_ID.replace(module.ACCOUNT, '000000000000')
        with self.assertRaisesRegex(module.Rejected, 'CHANGESET_TARGET_REJECTED'):
            self.installer.resume()
        self.assertEqual(self.mutation_count(), 1)

    def test_wrong_review_hash_never_executes(self):
        self.prepared_review()
        with self.assertRaisesRegex(module.Rejected, 'REVIEW_HASH_REQUIRED'):
            self.installer.execute('0' * 64)
        self.assertEqual(self.mutation_count(), 1)

    def test_target_created_between_review_and_execution_is_preserved(self):
        review = self.prepared_review()
        self.fake.installed = True
        self.fake.overrides['describe-stacks'] = dict(Stacks=[dict(StackName=module.STACK, StackId=STACK_ID, StackStatus='REVIEW_IN_PROGRESS')])
        with self.assertRaisesRegex(module.Rejected, 'TABLE_ALREADY_EXISTS'):
            self.installer.execute(review)
        self.assertEqual(self.mutation_count(), 1)

    def test_lost_execution_ack_resumes_readback_without_replay(self):
        review = self.prepared_review()
        self.fake.lost.add('execute-change-set')
        with self.assertRaisesRegex(module.Rejected, 'AWS_REQUEST_TIMEOUT'):
            self.installer.execute(review)
        self.fake.lost.clear()
        self.assertEqual(self.installer.execute(review), ('INSTALL_PENDING', None))
        self.fake.installed = True
        self.assertEqual(self.installer.resume(), ('CONFIGURATION_MATCH', None))
        self.assertEqual(self.mutation_count(), 2)

    def test_recovery_rejects_tampered_execution_args(self):
        review = self.prepared_review()
        self.installer.execute(review)
        path = self.state.folder / 'partition.execute.intent.json'
        value = json.loads(path.read_bytes()); value['args'][1] = 'delete-stack'
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(module.Rejected, 'EXECUTE_INTENT_REJECTED'):
            self.installer.resume()
        self.assertEqual(self.mutation_count(), 2)

    def test_prepare_rejects_orphan_empty_execution_intent_without_new_preview(self):
        self.state.save('partition.execute.intent.json', {})
        before = {p.name: p.read_bytes() for p in self.state.folder.iterdir()}
        with self.assertRaisesRegex(module.Rejected, 'EXECUTE_INTENT_REJECTED'):
            self.installer.prepare()
        self.assertEqual([c[2] for c in self.fake.calls], ['get-caller-identity'])
        self.assertEqual(self.mutation_count(), 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.folder.iterdir()})

    def test_prepare_resumes_orphan_execution_pending_and_installed_without_replay(self):
        review = self.prepared_review()
        self.installer.execute(review)
        (self.state.folder / 'partition.create.intent.json').unlink()
        before = {p.name: p.read_bytes() for p in self.state.folder.iterdir()}
        start = len(self.fake.calls)
        self.assertEqual(self.installer.prepare(), ('INSTALL_PENDING', None))
        self.assertEqual([c[2] for c in self.fake.calls[start:]], ['get-caller-identity', 'describe-stacks'])
        self.fake.installed = True
        self.assertEqual(self.installer.prepare(), ('CONFIGURATION_MATCH', None))
        self.assertEqual(self.mutation_count(), 2)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.folder.iterdir()})

    def test_prepare_rejects_non_object_or_unreadable_orphan_execution_intents(self):
        for index, raw in enumerate((b'null', b'false', b'0', b'[]', b'"private diagnostic"', b'{"private diagnostic":')):
            with self.subTest(raw=raw):
                state = module.common.State(self.home / f'ops00-partition-malformed-{index}', self.home)
                try:
                    fake = FakeAws()
                    installer = module.Installer(state, SOURCE, TEMPLATE, module_aws(state, fake))
                    path = state.folder / 'partition.execute.intent.json'
                    path.write_bytes(raw)
                    path.chmod(0o600)
                    before = {p.name: p.read_bytes() for p in state.folder.iterdir()}
                    with self.assertRaises((module.Rejected, ValueError)):
                        installer.prepare()
                    self.assertEqual(fake.calls, [])
                    self.assertEqual(before, {p.name: p.read_bytes() for p in state.folder.iterdir()})
                finally:
                    state.close()

    def test_prepare_preserves_nonempty_corrupt_orphan_execution_intent(self):
        self.state.save('partition.execute.intent.json', {'review': {'private': 'diagnostic'}, 'args': ['delete-stack']})
        before = {p.name: p.read_bytes() for p in self.state.folder.iterdir()}
        with self.assertRaisesRegex(module.Rejected, 'EXECUTE_INTENT_REJECTED'):
            self.installer.prepare()
        self.assertEqual([c[2] for c in self.fake.calls], ['get-caller-identity'])
        self.assertEqual(self.mutation_count(), 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.folder.iterdir()})

    def test_prepare_uses_valid_execution_recovery_before_damaged_create_intent(self):
        review = self.prepared_review()
        self.installer.execute(review)
        (self.state.folder / 'partition.create.intent.json').write_bytes(b'private incomplete CREATE record')
        before = {p.name: p.read_bytes() for p in self.state.folder.iterdir()}
        start = len(self.fake.calls)
        self.assertEqual(self.installer.prepare(), ('INSTALL_PENDING', None))
        self.assertEqual([c[2] for c in self.fake.calls[start:]], ['get-caller-identity', 'describe-stacks'])
        self.assertEqual(self.mutation_count(), 2)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.folder.iterdir()})

    def test_cli_prepare_orphan_execution_summary_and_private_state_are_preserved(self):
        folder = self.home / 'ops00-partition-orphan-cli'
        state = module.common.State(folder, self.home)
        try:
            module.Installer(state, SOURCE, TEMPLATE, module_aws(state, self.fake))
            state.save('partition.execute.intent.json', {})
            state.save('private-marker.json', {'private': 'synthetic diagnostic never public'})
        finally:
            state.close()
        before = {p.name: p.read_bytes() for p in folder.iterdir()}
        with patch('sys.argv', ['partition-create.py', 'prepare', '--source', SOURCE, '--state', str(folder)]), \
                patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda owned: module_aws(owned, self.fake)), \
                patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(module.main(), 1)
        value = json.loads(out.getvalue())
        self.assertEqual((value['result'], value['classification'], value['requests'], value['mutations']),
                         ('BLOCKED', 'EXECUTE_INTENT_REJECTED', 1, 0))
        self.assertNotIn('synthetic diagnostic', out.getvalue())
        self.assertNotIn(str(folder), out.getvalue())
        self.assertNotIn('assumed-role', out.getvalue())
        self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})

    def test_installed_configuration_matches_without_recreate_or_attachment(self):
        self.fake.created = self.fake.installed = True
        self.assertEqual(self.installer.inventory(), 'CONFIGURATION_MATCH')
        self.assertEqual(self.mutation_count(), 0)
        self.assertTrue(all(c[1] in ('sts', 'dynamodb', 'cloudformation') for c in self.fake.calls))

    def test_retention_and_actual_table_configuration_must_match(self):
        self.fake.created = self.fake.installed = True
        original = self.fake.response('describe-table')
        variants = [('describe-table', dict(Table=dict(original['Table'], DeletionProtectionEnabled=1))),
                    ('describe-table', dict(Table=dict(original['Table'], TableArn='private foreign arn'))),
                    ('describe-table', dict(Table=dict(original['Table'], StreamSpecification=dict(StreamEnabled=True)))),
                    ('describe-continuous-backups', dict(ContinuousBackupsDescription={})),
                    ('describe-time-to-live', dict(TimeToLiveDescription=dict(TimeToLiveStatus='ENABLED'))),
                    ('list-stack-resources', dict(StackResourceSummaries=[]))]
        for operation, value in variants:
            with self.subTest(operation=operation):
                self.fake.overrides = {operation: value}
                with self.assertRaises(module.Rejected):
                    self.installer.inventory()
        self.assertEqual(self.mutation_count(), 0)

    def test_response_pagination_capture_and_request_budget_fail_closed(self):
        for value in [dict(NextToken='private continuation'), dict(IsTruncated=True), [], 'private response']:
            with self.subTest(value=value):
                self.fake.overrides['get-caller-identity'] = value
                with self.assertRaisesRegex(module.Rejected, 'AWS_RESPONSE_REJECTED'):
                    self.installer.inventory()
        self.aws.calls = 32
        with self.assertRaisesRegex(module.Rejected, 'REQUEST_BUDGET_EXHAUSTED'):
            self.installer.inventory()

    def test_capture_limit_and_elapsed_deadline_prevent_further_requests(self):
        def oversized(command, **options):
            options['stdout'].write(b'x' * 131073)
            return subprocess.CompletedProcess(command, 0)
        aws = module.Aws(self.state, oversized)
        with self.assertRaisesRegex(module.Rejected, 'AWS_RESPONSE_LIMIT'):
            aws.call(['sts', 'get-caller-identity'])
        ticks = iter([0, 180])
        aws = module.Aws(self.state, self.fake, clock=lambda: next(ticks))
        with self.assertRaisesRegex(module.Rejected, 'REQUEST_BUDGET_EXHAUSTED'):
            aws.call(['sts', 'get-caller-identity'])
        self.assertEqual(self.fake.calls, [])

    def test_failed_stack_after_execute_keeps_intent_without_delete_or_recreate(self):
        review = self.prepared_review()
        self.installer.execute(review)
        self.fake.overrides['describe-stacks'] = dict(Stacks=[dict(StackName=module.STACK, StackId=STACK_ID, StackStatus='CREATE_FAILED')])
        with self.assertRaisesRegex(module.Rejected, 'INSTALL_RECONCILIATION_REQUIRED'):
            self.installer.resume()
        self.assertIsNotNone(self.state.load('partition.execute.intent.json'))
        self.assertEqual(self.mutation_count(), 2)
        self.assertFalse(any(c[2].startswith('delete') or c[2].startswith('update') for c in self.fake.calls))

    def test_original_recovery_state_path_is_rejected_before_open(self):
        with patch('sys.argv', ['partition-create.py', 'inventory', '--source', SOURCE, '--state', '/private/ops00-create-credentials']), \
                patch.object(module, 'verify_checkout'), patch.object(module.common, 'State') as state, \
                patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(module.main(), 1)
            self.assertEqual(json.loads(out.getvalue())['classification'], 'SEPARATE_PARTITION_STATE_REQUIRED')
            state.assert_not_called()

    def test_github_dispatch_source_and_mutation_mode_before_state_or_aws(self):
        env = dict(GITHUB_ACTIONS='true', GITHUB_REPOSITORY='Known-Enough/known-enough', GITHUB_REF='refs/heads/main',
                   GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_ACTOR='Battosai1806',
                   GITHUB_ACTOR_ID='143764700', GITHUB_SHA=SOURCE, EXPECTED_SOURCE=SOURCE)
        def git(command, **options):
            args = command[3:]
            return SOURCE if args == ['rev-parse', 'HEAD'] else module.common.ORIGIN if args == ['remote', 'get-url', 'origin'] else ''
        with patch.dict(os.environ, env), patch.object(module.subprocess, 'check_output', side_effect=git):
            module.verify_checkout(SOURCE, True)
            with patch.dict(os.environ, {'GITHUB_ACTOR_ID': '1'}):
                with self.assertRaisesRegex(module.Rejected, 'GITHUB_SOURCE_REJECTED'):
                    module.verify_checkout(SOURCE, True)
            with patch('sys.argv', ['partition-create.py', 'execute', '--source', SOURCE, '--state', '/unrelated']), \
                    patch.object(module.common, 'State') as state, contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(module.main(), 1)
                self.assertEqual(json.loads(out.getvalue())['classification'], 'GITHUB_READ_ONLY')
                state.assert_not_called()

    def test_exact_github_checkout_url_variants_and_remote_drift(self):
        env = dict(GITHUB_REPOSITORY='Known-Enough/known-enough', GITHUB_REF='refs/heads/main',
                   GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_ACTOR='Battosai1806',
                   GITHUB_ACTOR_ID='143764700', GITHUB_SHA=SOURCE, EXPECTED_SOURCE=SOURCE)
        values = {('rev-parse', 'HEAD'): SOURCE, ('remote', 'get-url', 'origin'): module.common.ORIGIN,
                  ('status', '--porcelain'): '', ('branch', '--show-current'): 'main'}
        def git(command, **options):
            return values[tuple(command[3:])]
        with patch.dict(os.environ, env), patch.object(module.subprocess, 'check_output', side_effect=git):
            for remote in (module.common.ORIGIN, module.common.ORIGIN[:-4]):
                values[('remote', 'get-url', 'origin')] = remote
                module.verify_checkout(SOURCE, True)
            for remote in ('https://github.com/OTHER/known-enough.git', module.common.ORIGIN + '?redirect=1',
                           'https://user@github.com/Known-Enough/known-enough.git'):
                values[('remote', 'get-url', 'origin')] = remote
                with self.assertRaisesRegex(module.Rejected, 'CHECKOUT_REJECTED'):
                    module.verify_checkout(SOURCE, True)
            values[('remote', 'get-url', 'origin')] = module.common.ORIGIN
            values[('status', '--porcelain')] = ' M private-file'
            with self.assertRaisesRegex(module.Rejected, 'CHECKOUT_REJECTED'):
                module.verify_checkout(SOURCE, True)

    def test_cli_summary_sanitizes_identity_and_private_denials(self):
        secret = 'private diagnostic should never escape'
        self.fake.overrides['describe-table'] = ('AccessDeniedException', secret)
        with patch('sys.argv', ['partition-create.py', 'inventory', '--source', SOURCE, '--state', str(self.home / 'ops00-partition-cli')]), \
                patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda state: module_aws(state, self.fake)), \
                patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(module.main(), 1)
        value = json.loads(out.getvalue())
        self.assertEqual(value['classification'], 'AccessDeniedException')
        self.assertEqual(value['mutations'], 0)
        self.assertEqual(value['requests'], 2)
        self.assertNotIn(secret, out.getvalue())
        self.assertNotIn('assumed-role', out.getvalue())
        self.assertEqual(value['activation'], 'DISABLED')

    def test_workflow_source_checks_precede_fixed_credentials_and_inventory(self):
        text = (module.ROOT / '.github/workflows/operations-partition-readback.yml').read_text()
        self.assertLess(text.index('node scripts/operations/verify.mjs'), text.index('aws-actions/configure-aws-credentials'))
        self.assertLess(text.index('python3 -B scripts/operations/partition-create.test.py'), text.index('aws-actions/configure-aws-credentials'))
        self.assertLess(text.index('["verify_checkout"]'), text.index('aws-actions/configure-aws-credentials'))
        self.assertIn('KnownEnoughGithubStagingInspector', text)
        self.assertIn("github.actor_id == '143764700'", text)
        self.assertIn('partition-create.py inventory', text)
        self.assertNotIn('partition-create.py execute', text)
        self.assertNotIn('secrets.', text)
        verify = (module.ROOT / '.github/workflows/operations-verify.yml').read_text()
        self.assertIn('python3 -B scripts/operations/partition-create.test.py', verify)


module_aws = module.Aws
if __name__ == '__main__':
    unittest.main()
