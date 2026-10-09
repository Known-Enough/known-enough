#!/usr/bin/env python3
"""Offline mutation-boundary and recovery-state tests; no credentials or AWS."""
import copy
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('create_package', HERE / 'cloudshell-create.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = 'a' * 40
TEMPLATE = (module.ROOT / 'infra/operations/setup.json').read_bytes()
PROPOSED = json.loads(TEMPLATE)['Resources']
STACK_ID = module.STACK_PREFIX + 'synthetic-stack'
CHANGE_ID = module.CHANGE_PREFIX + 'ke-ops00-create-' + SOURCE[:20] + '/synthetic-change'


class FakeAws:
    def __init__(self):
        self.calls, self.overrides = [], {}
        self.created, self.executed, self.installed = False, False, False
        self.lost = set()
        self.empty = set()
        self.preview = dict(ChangeSetId=CHANGE_ID, ChangeSetName='ke-ops00-create-' + SOURCE[:20],
                            StackId=STACK_ID, StackName=module.STACK, Status='CREATE_COMPLETE',
                            ExecutionStatus='AVAILABLE', Capabilities=['CAPABILITY_NAMED_IAM'], Changes=[
                                dict(Type='Resource', ResourceChange=dict(Action='Add', LogicalResourceId=name,
                                    ResourceType=value['Type'])) for name, value in PROPOSED.items()])

    def response(self, operation):
        if operation in self.overrides:
            return self.overrides[operation]
        if operation == 'get-caller-identity':
            return dict(Account=module.ACCOUNT, Arn=f'arn:aws:iam::{module.ACCOUNT}:root')
        if operation == 'get-open-id-connect-provider':
            return dict(Url='token.actions.githubusercontent.com', ClientIDList=['sts.amazonaws.com'])
        if operation == 'describe-stacks':
            if not self.created:
                return ('ValidationError', f'Stack with id {module.STACK} does not exist')
            return dict(Stacks=[dict(StackName=module.STACK, StackId=STACK_ID,
                                    StackStatus='CREATE_COMPLETE' if self.installed else 'CREATE_IN_PROGRESS' if self.executed else 'REVIEW_IN_PROGRESS')])
        if operation == 'describe-change-set':
            return self.preview if self.created else ('ChangeSetNotFound', 'synthetic missing')
        if operation == 'get-template':
            return dict(TemplateBody=json.loads(TEMPLATE))
        if operation == 'list-stack-resources':
            physical = dict(Journal=module.TABLE, Manifests=module.BUCKET, RecoveryRole=module.ROLE, ManifestPolicy=module.BUCKET)
            return dict(StackResourceSummaries=[dict(LogicalResourceId=name, ResourceType=value['Type'],
                        PhysicalResourceId=physical[name], ResourceStatus='CREATE_COMPLETE') for name, value in PROPOSED.items()])
        if operation == 'get-role':
            if not self.installed:
                return ('NoSuchEntity', 'synthetic absent')
            return dict(Role=dict(Arn=f'arn:aws:iam::{module.ACCOUNT}:role/{module.ROLE}', RoleName=module.ROLE,
                                 MaxSessionDuration=3600, AssumeRolePolicyDocument=PROPOSED['RecoveryRole']['Properties']['AssumeRolePolicyDocument']))
        if operation == 'list-role-policies':
            return dict(IsTruncated=False, PolicyNames=['ExactRecoveryStorage'])
        if operation == 'get-role-policy':
            return dict(RoleName=module.ROLE, PolicyName='ExactRecoveryStorage',
                        PolicyDocument=PROPOSED['RecoveryRole']['Properties']['Policies'][0]['PolicyDocument'])
        if operation == 'list-attached-role-policies':
            return dict(IsTruncated=False, AttachedPolicies=[])
        if operation == 'describe-table':
            if not self.installed:
                return ('ResourceNotFoundException', 'synthetic absent')
            return dict(Table=dict(TableArn=f'arn:aws:dynamodb:{module.REGION}:{module.ACCOUNT}:table/{module.TABLE}',
                                  TableStatus='ACTIVE', DeletionProtectionEnabled=True, BillingModeSummary=dict(BillingMode='PAY_PER_REQUEST'),
                                  SSEDescription=dict(Status='ENABLED'), KeySchema=PROPOSED['Journal']['Properties']['KeySchema'],
                                  AttributeDefinitions=PROPOSED['Journal']['Properties']['AttributeDefinitions']))
        if operation == 'describe-continuous-backups':
            return dict(ContinuousBackupsDescription=dict(PointInTimeRecoveryDescription=dict(PointInTimeRecoveryStatus='ENABLED')))
        if operation == 'describe-time-to-live':
            return dict(TimeToLiveDescription=dict(TimeToLiveStatus='DISABLED'))
        if operation == 'get-bucket-versioning':
            return dict(Status='Enabled') if self.installed else ('NoSuchBucket', 'synthetic absent')
        if operation == 'get-bucket-encryption':
            return dict(ServerSideEncryptionConfiguration=dict(Rules=[dict(ApplyServerSideEncryptionByDefault=dict(SSEAlgorithm='AES256'))]))
        if operation == 'get-public-access-block':
            return dict(PublicAccessBlockConfiguration=PROPOSED['Manifests']['Properties']['PublicAccessBlockConfiguration'])
        if operation == 'get-bucket-ownership-controls':
            return dict(OwnershipControls=PROPOSED['Manifests']['Properties']['OwnershipControls'])
        if operation == 'get-bucket-lifecycle-configuration':
            return ('NoSuchLifecycleConfiguration', 'synthetic absent')
        if operation == 'get-bucket-policy':
            return dict(Policy=json.dumps(PROPOSED['ManifestPolicy']['Properties']['PolicyDocument']))
        if operation == 'validate-template':
            return dict(Capabilities=['CAPABILITY_NAMED_IAM'])
        raise AssertionError(operation)

    def __call__(self, command, **options):
        self.calls.append(command)
        operation = command[2]
        assert options['env']['AWS_MAX_ATTEMPTS'] == '1'
        assert options['env']['AWS_CONFIG_FILE'] == '/dev/null'
        assert command[command.index('--region') + 1] == module.REGION
        assert options['timeout'] <= 10
        if command[1] == 's3api':
            assert command[command.index('--expected-bucket-owner') + 1] == module.ACCOUNT
        if operation == 'create-change-set':
            assert command[command.index('--change-set-type') + 1] == 'CREATE'
            assert json.loads(Path(command[command.index('--template-body') + 1][7:]).read_bytes()) == json.loads(TEMPLATE)
            self.created = True
            value = dict(Id=CHANGE_ID, StackId=STACK_ID)
        elif operation == 'execute-change-set':
            assert command[command.index('--change-set-name') + 1] == CHANGE_ID
            self.executed = True
            value = {}
        else:
            value = self.response(operation)
        if operation in self.lost:
            raise subprocess.TimeoutExpired(command, 10)
        if operation in self.empty:
            return subprocess.CompletedProcess(command, 0)
        if isinstance(value, tuple):
            options['stderr'].write(f'An error occurred ({value[0]}) when calling the operation: {value[1]}\n'.encode())
            return subprocess.CompletedProcess(command, 1)
        options['stdout'].write(json.dumps(value).encode())
        return subprocess.CompletedProcess(command, 0)

    def mutations(self):
        return [c for c in self.calls if c[2] in ('create-change-set', 'execute-change-set')]


class CreateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.state = module.State(self.home / '.private' / 'state', self.home)
        self.fake = FakeAws()
        self.installer = self.new_installer()

    def tearDown(self):
        self.state.close()
        self.temp.cleanup()

    def new_installer(self):
        return module.Installer(self.state, SOURCE, TEMPLATE, module.Aws(self.state, self.fake))

    def prepared(self):
        self.installer.prepare()
        return self.installer.resume()[1]

    def installed(self):
        review = self.prepared()
        self.installer.execute(review)
        self.fake.installed = True

    def reject(self, action, code):
        with self.assertRaisesRegex(module.Rejected, '^' + code + '$'):
            action()

    def test_prepare_exact_template_and_durable_intent_before_request(self):
        original = self.fake.__call__
        def execute(command, **options):
            if command[2] == 'create-change-set':
                self.assertEqual(self.state.load('create.intent.json')['plan']['type'], 'CREATE')
                self.assertEqual((self.state.folder / 'template.json').read_bytes(), TEMPLATE)
            return original(command, **options)
        self.installer.aws.executor = execute
        with patch.object(module.os, 'fsync', wraps=os.fsync) as flush:
            self.assertEqual(self.installer.prepare(), ('PREVIEW_SUBMITTED', None))
            self.assertGreaterEqual(flush.call_count, 4)
        self.assertEqual(len(self.fake.mutations()), 1)
        self.assertEqual(self.fake.mutations()[0][self.fake.mutations()[0].index('--stack-name') + 1], module.STACK)

    def test_foreign_account_and_principal_cannot_submit(self):
        for value in [dict(Account='111111111111', Arn=f'arn:aws:iam::{module.ACCOUNT}:root'),
                      dict(Account=module.ACCOUNT, Arn='arn:aws:iam::111111111111:root')]:
            self.fake.overrides['get-caller-identity'] = value
            self.reject(self.installer.prepare, 'IDENTITY_REJECTED')
        self.assertEqual(self.fake.mutations(), [])

    def test_same_account_user_and_assumed_role_supported(self):
        for arn in [f'arn:aws:iam::{module.ACCOUNT}:user/own-user', f'arn:aws:sts::{module.ACCOUNT}:assumed-role/own-role/session']:
            self.fake.overrides['get-caller-identity'] = dict(Account=module.ACCOUNT, Arn=arn)
            self.installer.identity()

    def test_oidc_missing_audience_blocks_create(self):
        self.fake.overrides['get-open-id-connect-provider'] = dict(Url='token.actions.githubusercontent.com', ClientIDList=[])
        self.reject(self.installer.prepare, 'OIDC_REJECTED')
        self.assertEqual(self.fake.mutations(), [])

    def test_existing_resource_blocks_create(self):
        for operation, response, code in [('describe-stacks', dict(Stacks=[]), 'STACK_ALREADY_EXISTS'),
                                         ('get-role', dict(Role={}), 'ROLE_ALREADY_EXISTS'),
                                         ('describe-table', dict(Table={}), 'TABLE_ALREADY_EXISTS'),
                                         ('get-bucket-versioning', {}, 'BUCKET_ALREADY_EXISTS')]:
            self.fake.overrides = {operation: response}
            self.reject(self.installer.prepare, code)
        self.assertEqual(self.fake.mutations(), [])

    def test_denial_and_other_validation_error_are_not_absence(self):
        for response, code in [(('AccessDenied', 'PRIVATE_SENTINEL'), 'AccessDenied'),
                               (('ValidationError', 'invalid parameter'), 'ValidationError')]:
            self.fake.overrides['describe-stacks'] = response
            self.reject(self.installer.prepare, code)
        self.assertIsNone(self.state.load('create.intent.json'))
        self.assertEqual(self.fake.mutations(), [])

    def test_lost_create_ack_resume_reconstructs_without_resubmission(self):
        self.fake.lost.add('create-change-set')
        self.reject(self.installer.prepare, 'AWS_RESPONSE_UNCERTAIN')
        self.assertIsNone(self.state.load('create.ack.json'))
        recovered = self.new_installer()
        self.assertEqual(recovered.prepare()[0], 'REVIEW_READY')
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_unobserved_create_never_retries(self):
        self.fake.lost.add('create-change-set')
        self.reject(self.installer.prepare, 'AWS_RESPONSE_UNCERTAIN')
        self.fake.created = False
        self.reject(self.new_installer().prepare, 'ChangeSetNotFound')
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_pending_preview_single_poll_no_execute(self):
        self.installer.prepare()
        self.fake.preview['Status'] = 'CREATE_IN_PROGRESS'
        count = len(self.fake.calls)
        self.assertEqual(self.installer.resume(), ('PREVIEW_PENDING', None))
        self.assertEqual(len(self.fake.calls) - count, 3)
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_preview_add_scope_and_template_required(self):
        self.installer.prepare()
        baseline = copy.deepcopy(self.fake.preview)
        variants = []
        for action in ['Modify', 'Remove', 'Import']:
            value = copy.deepcopy(baseline)
            value['Changes'][0]['ResourceChange']['Action'] = action
            variants.append(value)
        value = copy.deepcopy(baseline); value['Changes'].append(value['Changes'][0]); variants.append(value)
        value = copy.deepcopy(baseline); value['Changes'][1] = value['Changes'][0]; variants.append(value)
        value = copy.deepcopy(baseline); value['Changes'][0]['ResourceChange']['Replacement'] = 'Conditional'; variants.append(value)
        value = copy.deepcopy(baseline); value['ImportExistingResources'] = True; variants.append(value)
        value = copy.deepcopy(baseline); value['OnStackFailure'] = 'DELETE'; variants.append(value)
        for value in variants:
            self.fake.preview = value
            self.reject(self.installer.review, 'PREVIEW_SCOPE_REJECTED')
        self.fake.preview = baseline
        self.fake.overrides['get-template'] = dict(TemplateBody={})
        self.reject(self.installer.review, 'PREVIEW_TEMPLATE_REJECTED')
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_foreign_change_and_stack_arn_rejected(self):
        self.installer.prepare()
        for key in ('ChangeSetId', 'StackId'):
            original = self.fake.preview[key]
            self.fake.preview[key] = original.replace(module.ACCOUNT, '111111111111')
            self.reject(self.installer.review, 'CHANGESET_TARGET_REJECTED' if key == 'ChangeSetId' else 'STACK_TARGET_REJECTED')
            self.fake.preview[key] = original

    def test_review_accepts_actual_describe_shape_without_type_field(self):
        review = self.prepared()
        self.assertNotIn('ChangeSetType', self.fake.preview)
        self.assertEqual(len(review), 64)
        self.fake.preview['Changes'].reverse()
        self.assertEqual(self.installer.review()['reviewHash'], review)
        self.fake.overrides['get-template'] = dict(TemplateBody=TEMPLATE.decode())
        self.assertEqual(self.installer.review()['reviewHash'], review)

    def test_stale_review_and_replaced_change_set_block_execute(self):
        review = self.prepared()
        self.reject(lambda: self.installer.execute('0' * 64), 'REVIEW_HASH_REQUIRED')
        self.fake.preview['ChangeSetId'] += '-replaced'
        self.reject(lambda: self.installer.execute(review), 'CHANGESET_TARGET_CHANGED')
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_fresh_conflict_before_execute_blocks_mutation(self):
        review = self.prepared()
        self.fake.overrides['get-role'] = dict(Role={})
        self.reject(lambda: self.installer.execute(review), 'ROLE_ALREADY_EXISTS')
        self.assertIsNone(self.state.load('execute.intent.json'))

    def test_lost_execute_ack_resume_reconstructs_without_resubmission(self):
        review = self.prepared()
        self.fake.lost.add('execute-change-set')
        self.reject(lambda: self.installer.execute(review), 'AWS_RESPONSE_UNCERTAIN')
        self.assertIsNone(self.state.load('execute.ack.json'))
        self.assertEqual(self.new_installer().execute(review), ('INSTALL_PENDING', None))
        self.assertEqual(len(self.fake.mutations()), 2)

    def test_execute_intent_is_saved_before_request(self):
        review = self.prepared()
        original = self.fake.__call__
        def execute(command, **options):
            if command[2] == 'execute-change-set':
                self.assertEqual(self.state.load('execute.intent.json')['review']['reviewHash'], review)
            return original(command, **options)
        self.installer.aws.executor = execute
        self.installer.execute(review)
        self.assertEqual(len(self.fake.mutations()), 2)

    def test_successful_execute_accepts_documented_empty_cli_output(self):
        review = self.prepared()
        self.fake.empty.add('execute-change-set')
        self.assertEqual(self.installer.execute(review), ('INSTALL_SUBMITTED', None))
        self.assertEqual(self.state.load('execute.ack.json'), {})
        self.assertEqual(self.new_installer().execute(review), ('INSTALL_PENDING', None))
        self.assertEqual(len(self.fake.mutations()), 2)

    def test_empty_metadata_and_create_ack_still_rejected(self):
        self.fake.empty.add('get-caller-identity')
        self.reject(self.installer.prepare, 'AWS_RESPONSE_REJECTED')
        self.assertEqual(self.fake.mutations(), [])
        self.fake.empty = {'create-change-set'}
        self.reject(self.installer.prepare, 'AWS_RESPONSE_REJECTED')
        self.assertIsNotNone(self.state.load('create.intent.json'))
        self.assertIsNone(self.state.load('create.ack.json'))

    def test_complete_configuration_does_not_claim_effective_permissions(self):
        self.installed()
        count = len(self.fake.mutations())
        recovered = self.new_installer()
        self.assertEqual(recovered.resume(), ('CONFIGURATION_MATCH', None))
        evidence = self.state.load('configuration.json')
        self.assertEqual(evidence['effectivePermissions'], 'UNKNOWN')
        self.assertEqual(evidence['managedRecovery'], 'NOT_EXECUTED')
        self.assertEqual(len(self.fake.mutations()), count)
        self.assertLessEqual(recovered.aws.calls, 32)

    def test_json_number_cannot_pass_boolean_configuration(self):
        self.installed()
        self.fake.overrides['get-public-access-block'] = dict(PublicAccessBlockConfiguration={
            key: 1 for key in PROPOSED['Manifests']['Properties']['PublicAccessBlockConfiguration']})
        self.reject(self.new_installer().readback, 'INSTALLED_BUCKET_MISMATCH')
        self.assertIsNone(self.state.load('configuration.json'))

    def test_corrupted_execute_intent_cannot_read_foreign_stack(self):
        self.installed()
        path = self.state.folder / 'execute.intent.json'
        intent = self.state.load(path.name)
        intent['review']['stackId'] = STACK_ID.replace(module.ACCOUNT, '111111111111')
        path.write_bytes(module.encoded(intent))
        before = len(self.fake.calls)
        self.reject(self.new_installer().resume, 'EXECUTE_INTENT_REJECTED')
        self.assertEqual([c[2] for c in self.fake.calls[before:]], ['get-caller-identity', 'get-open-id-connect-provider'])

    def test_numeric_preview_boolean_cannot_pass_review(self):
        self.installer.prepare()
        self.fake.preview['ImportExistingResources'] = 0
        self.reject(self.installer.review, 'PREVIEW_SCOPE_REJECTED')

    def test_cli_denial_output_sanitized_and_diagnostics_private(self):
        self.state.close()
        fresh_state = self.home / '.private' / 'cli'
        self.fake.overrides['describe-stacks'] = ('AccessDenied', 'PRIVATE_SENTINEL')
        original_aws = module.Aws
        output = io.StringIO()
        with patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda state: original_aws(state, self.fake)), \
                patch.object(sys, 'argv', ['create', 'prepare', '--source', SOURCE, '--state', str(fresh_state)]), \
                contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['classification'], 'AccessDenied')
        self.assertEqual(value['mutations'], 0)
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
        self.assertNotIn(module.ACCOUNT, output.getvalue())
        diagnostics = list(fresh_state.glob('run-*/*.err'))
        self.assertTrue(any(b'PRIVATE_SENTINEL' in path.read_bytes() for path in diagnostics))
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in diagnostics))
        self.state = module.State(self.home / '.private' / 'state', self.home)

    def test_readback_policy_drift_blocks_configuration_match(self):
        self.installed()
        self.fake.overrides['get-role-policy'] = dict(RoleName=module.ROLE, PolicyName='ExactRecoveryStorage', PolicyDocument={})
        self.reject(self.installer.readback, 'INSTALLED_POLICY_MISMATCH')
        self.assertIsNone(self.state.load('configuration.json'))

    def test_pagination_cannot_establish_configuration(self):
        self.installed()
        self.fake.overrides['list-role-policies'] = dict(IsTruncated=True, PolicyNames=['ExactRecoveryStorage'])
        self.reject(self.installer.readback, 'AWS_RESPONSE_REJECTED')
        self.assertIsNone(self.state.load('configuration.json'))

    def test_malformed_cursors_stop_readback_before_configuration(self):
        self.installed()
        for field in ('NextToken', 'Marker', 'NextMarker'):
            for value in (0, False, [], {}):
                with self.subTest(field=field, value=value):
                    self.fake.overrides['list-role-policies'] = dict(
                        IsTruncated=False, PolicyNames=['ExactRecoveryStorage'], **{field: value})
                    self.installer = self.new_installer()
                    before = len(self.fake.calls)
                    self.reject(self.installer.readback, 'AWS_RESPONSE_REJECTED')
                    self.assertEqual(len(self.fake.calls) - before, 7)
                    self.assertEqual(self.fake.calls[-1][2], 'list-role-policies')
                    self.assertIsNone(self.state.load('configuration.json'))
                    self.assertEqual(len(self.fake.mutations()), 2)

    def test_nonterminal_cursors_and_malformed_truncation_still_rejected(self):
        self.installed()
        variants = [{field: value} for field in ('NextToken', 'Marker', 'NextMarker')
                    for value in (1, True, 'PRIVATE_CURSOR')]
        variants += [dict(IsTruncated=value) for value in (0, 1, None, '', [], {}, True)]
        for metadata in variants:
            with self.subTest(metadata=metadata):
                self.fake.overrides['list-role-policies'] = dict(
                    dict(IsTruncated=False, PolicyNames=['ExactRecoveryStorage']), **metadata)
                self.installer = self.new_installer()
                self.reject(self.installer.readback, 'AWS_RESPONSE_REJECTED')
                self.assertIsNone(self.state.load('configuration.json'))
                self.assertEqual(len(self.fake.mutations()), 2)

    def test_malformed_identity_cursors_stop_before_create_intent(self):
        for field in ('NextToken', 'Marker', 'NextMarker'):
            for value in (0, False, [], {}):
                with self.subTest(field=field, value=value):
                    self.fake.overrides['get-caller-identity'] = dict(
                        Account=module.ACCOUNT, Arn=f'arn:aws:iam::{module.ACCOUNT}:root', **{field: value})
                    self.installer = self.new_installer()
                    before = len(self.fake.calls)
                    self.reject(self.installer.prepare, 'AWS_RESPONSE_REJECTED')
                    self.assertEqual(len(self.fake.calls) - before, 1)
                    self.assertIsNone(self.state.load('create.intent.json'))
                    self.assertEqual(self.fake.mutations(), [])

    def test_malformed_preview_cursors_stop_before_execute_intent(self):
        review = self.prepared()
        baseline = copy.deepcopy(self.fake.preview)
        for field in ('NextToken', 'Marker', 'NextMarker'):
            for value in (0, False, [], {}):
                with self.subTest(field=field, value=value):
                    self.fake.preview = dict(baseline, **{field: value})
                    self.installer = self.new_installer()
                    self.reject(lambda: self.installer.execute(review), 'AWS_RESPONSE_REJECTED')
                    self.assertIsNone(self.state.load('execute.intent.json'))
                    self.assertEqual(len(self.fake.mutations()), 1)

    def test_terminal_cursor_shapes_preserve_configuration_only_result(self):
        self.installed()
        for cursors in ({}, dict(NextToken=None, Marker=None, NextMarker=None),
                        dict(NextToken='', Marker='', NextMarker='')):
            with self.subTest(cursors=cursors):
                self.fake.overrides['list-role-policies'] = dict(
                    IsTruncated=False, PolicyNames=['ExactRecoveryStorage'], **cursors)
                self.installer = self.new_installer()
                before = len(self.fake.calls)
                self.assertEqual(self.installer.readback(), 'CONFIGURATION_MATCH')
                self.assertEqual(len(self.fake.calls) - before, 18)
                record = self.state.load('configuration.json')
                self.assertEqual(record['effectivePermissions'], 'UNKNOWN')
                self.assertEqual(record['managedRecovery'], 'NOT_EXECUTED')
                self.assertEqual(len(self.fake.mutations()), 2)

    def test_cli_cursor_rejection_keeps_values_private(self):
        self.state.close()
        fresh_state = self.home / '.private' / 'cursor-cli'
        self.fake.overrides['get-caller-identity'] = dict(
            Account=module.ACCOUNT, Arn=f'arn:aws:iam::{module.ACCOUNT}:root', NextToken=['PRIVATE_CURSOR'])
        original_aws = module.Aws
        output = io.StringIO()
        with patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda state: original_aws(state, self.fake)), \
                patch.object(sys, 'argv', ['create', 'prepare', '--source', SOURCE, '--state', str(fresh_state)]), \
                contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['classification'], 'AWS_RESPONSE_REJECTED')
        self.assertEqual(value['requests'], 1)
        self.assertEqual(value['mutations'], 0)
        self.assertNotIn('PRIVATE_CURSOR', output.getvalue())
        self.assertNotIn(module.ACCOUNT, output.getvalue())
        diagnostics = list(fresh_state.glob('run-*/*.out'))
        self.assertTrue(any(b'PRIVATE_CURSOR' in path.read_bytes() for path in diagnostics))
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in diagnostics))
        self.state = module.State(self.home / '.private' / 'state', self.home)

    def test_cloudshell_provider_survives_prepare_execute_and_uncertain_resume(self):
        settings = dict(AWS_CONTAINER_CREDENTIALS_FULL_URI='http://localhost:1338/synthetic',
                        AWS_CONTAINER_AUTHORIZATION_TOKEN='PRIVATE_SYNTHETIC_TOKEN',
                        AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE='/synthetic/private/token')
        captured = []
        def executor(command, **options):
            captured.append(options['env'])
            if not options['env'].get('AWS_CONTAINER_CREDENTIALS_FULL_URI'):
                options['stderr'].write(b'Unable to locate credentials.\n')
                return subprocess.CompletedProcess(command, 253)
            return self.fake(command, **options)
        self.installer.aws.executor = executor
        with patch.dict(os.environ, settings, clear=True):
            review = self.prepared()
            self.installer.aws = module.Aws(self.state, executor)
            self.fake.lost.add('execute-change-set')
            self.reject(lambda: self.installer.execute(review), 'AWS_RESPONSE_UNCERTAIN')
            self.installer.aws = module.Aws(self.state, executor)
            self.assertEqual(self.installer.resume(), ('INSTALL_PENDING', None))
            self.fake.installed = True
            self.installer.aws = module.Aws(self.state, executor)
            self.assertEqual(self.installer.resume(), ('CONFIGURATION_MATCH', None))
        self.assertEqual(len(self.fake.mutations()), 2)
        self.assertEqual([c[2] for c in self.fake.mutations()], ['create-change-set', 'execute-change-set'])
        self.assertTrue(captured)
        for env in captured:
            self.assertTrue(all(env[k] == v for k, v in settings.items()))
            self.assertEqual(env['AWS_EC2_METADATA_DISABLED'], 'true')
            self.assertEqual(env['AWS_MAX_ATTEMPTS'], '1')
        saved = (self.state.folder / 'configuration.json').read_text()
        self.assertNotIn('PRIVATE_SYNTHETIC_TOKEN', saved)
        self.assertNotIn('http://localhost', saved)

    def test_relative_container_provider_reaches_identity_and_preview(self):
        settings = dict(AWS_CONTAINER_CREDENTIALS_RELATIVE_URI='/synthetic-credentials?version=1')
        original = self.fake
        def executor(command, **options):
            self.assertEqual(options['env'].get('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'), settings['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'])
            return original(command, **options)
        self.installer.aws.executor = executor
        with patch.dict(os.environ, settings, clear=True):
            self.assertEqual(self.installer.prepare(), ('PREVIEW_SUBMITTED', None))
        self.assertEqual(len(self.fake.mutations()), 1)

    def test_supported_local_provider_hosts_preserved_verbatim(self):
        for uri in ['http://localhost:1338/path?version=1', 'http://127.0.0.1:1338/path',
                    'http://127.2.3.4/path', 'http://[::1]:1338/path',
                    'http://169.254.170.2/path', 'http://169.254.170.23/path',
                    'http://[fd00:ec2::23]/path', 'https://localhost/path']:
            with self.subTest(uri=uri), patch.dict(os.environ, {'AWS_CONTAINER_CREDENTIALS_FULL_URI': uri}, clear=True):
                def executor(command, **options):
                    self.assertEqual(options['env'].get('AWS_CONTAINER_CREDENTIALS_FULL_URI'), uri)
                    return self.fake(command, **options)
                self.installer.aws.executor = executor
                self.installer.identity()
        self.assertEqual(self.fake.mutations(), [])

    def test_arbitrary_or_malformed_provider_stops_before_cli_and_intent(self):
        bad = [{'AWS_CONTAINER_CREDENTIALS_FULL_URI': uri} for uri in [
            'https://example.invalid/credentials', 'http://example.invalid/credentials',
            'http://localhost.example.invalid/credentials', 'file:///private/credentials',
            'http://user:secret@localhost/path', 'http://localhost:70000/path',
            'http://localhost/path#fragment', 'http://localhost/\nprivate',
            'http://[bad]/path', 'http://169.254.169.254/latest/meta-data/credentials']]
        bad += [{'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI': uri} for uri in [
            '//example.invalid/path', 'https://example.invalid/path', 'relative/path', '/path#fragment', '/path\nprivate']]
        bad += [dict(AWS_CONTAINER_CREDENTIALS_FULL_URI='http://localhost/path', AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE='relative/token'),
                dict(AWS_CONTAINER_CREDENTIALS_FULL_URI='http://localhost/path', AWS_CONTAINER_AUTHORIZATION_TOKEN='private\nheader')]
        for settings in bad:
            with self.subTest(keys=list(settings)), patch.dict(os.environ, settings, clear=True):
                self.installer.aws = module.Aws(self.state, self.fake)
                self.reject(self.installer.prepare, 'CREDENTIAL_PROVIDER_REJECTED')
                self.assertEqual(self.installer.aws.calls, 0)
                self.assertIsNone(self.state.load('create.intent.json'))
        self.assertEqual(self.fake.calls, [])

    def test_profile_web_identity_and_service_endpoints_stay_disabled(self):
        settings = dict(AWS_CONTAINER_CREDENTIALS_FULL_URI='http://localhost/path',
                        AWS_PROFILE='private-profile', AWS_DEFAULT_PROFILE='private-profile',
                        AWS_ROLE_ARN='private-role', AWS_WEB_IDENTITY_TOKEN_FILE='/private/token',
                        AWS_ENDPOINT_URL='https://example.invalid', AWS_ENDPOINT_URL_STS='https://example.invalid',
                        AWS_CONFIG_FILE='/private/config', AWS_SHARED_CREDENTIALS_FILE='/private/credentials',
                        AWS_EC2_METADATA_DISABLED='false', AWS_REGION='eu-west-1', AWS_MAX_ATTEMPTS='9')
        def executor(command, **options):
            env = options['env']
            for key in ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_STS']:
                self.assertNotIn(key, env)
            self.assertEqual(env['AWS_CONTAINER_CREDENTIALS_FULL_URI'], settings['AWS_CONTAINER_CREDENTIALS_FULL_URI'])
            self.assertEqual(env['AWS_CONFIG_FILE'], '/dev/null')
            self.assertEqual(env['AWS_SHARED_CREDENTIALS_FILE'], '/dev/null')
            self.assertEqual(env['AWS_EC2_METADATA_DISABLED'], 'true')
            return self.fake(command, **options)
        self.installer.aws.executor = executor
        with patch.dict(os.environ, settings, clear=True):
            self.installer.identity()
        self.assertEqual(self.fake.mutations(), [])

    def test_missing_credentials_and_unrecognized_errors_are_not_absence(self):
        for diagnostic, code in [(b'Unable to locate credentials. Private detail\n', 'NO_CREDENTIALS'),
                                  (b'botocore.exceptions.NoCredentialsError: Unable to locate credentials\n', 'NO_CREDENTIALS'),
                                  (b'PRIVATE_UNKNOWN_ERROR\n', 'AWS_REQUEST_FAILED')]:
            def executor(command, **options):
                options['stderr'].write(diagnostic)
                return subprocess.CompletedProcess(command, 253)
            self.installer.aws = module.Aws(self.state, executor)
            with patch.dict(os.environ, {}, clear=True):
                self.reject(self.installer.prepare, code)
            self.assertIsNone(self.state.load('create.intent.json'))
            self.assertEqual(self.installer.aws.mutations, 0)
        self.fake.overrides['get-caller-identity'] = ('AccessDenied', 'PRIVATE_DENIAL')
        self.installer.aws = module.Aws(self.state, self.fake)
        with patch.dict(os.environ, {}, clear=True):
            self.reject(self.installer.prepare, 'AccessDenied')
        self.assertEqual(self.fake.mutations(), [])

    def test_provider_wrong_account_or_malformed_identity_cannot_submit(self):
        for value in [dict(Account='111111111111', Arn=f'arn:aws:iam::{module.ACCOUNT}:root'),
                      dict(Account=module.ACCOUNT, Arn=None), dict(Account=module.ACCOUNT, Arn=7),
                      dict(Account=module.ACCOUNT, Arn='not-an-arn'), dict(Arn=f'arn:aws:iam::{module.ACCOUNT}:root')]:
            self.fake.overrides['get-caller-identity'] = value
            def executor(command, **options):
                self.assertEqual(options['env'].get('AWS_CONTAINER_CREDENTIALS_FULL_URI'), 'http://localhost/path')
                return self.fake(command, **options)
            self.installer.aws = module.Aws(self.state, executor)
            with patch.dict(os.environ, {'AWS_CONTAINER_CREDENTIALS_FULL_URI': 'http://localhost/path'}, clear=True):
                self.reject(self.installer.prepare, 'IDENTITY_REJECTED')
            self.assertEqual(self.installer.aws.calls, 1)
            self.assertIsNone(self.state.load('create.intent.json'))
        self.assertEqual(self.fake.mutations(), [])

    def test_no_credentials_cli_summary_is_finite_and_private(self):
        self.state.close()
        fresh = self.home / '.private' / 'credentials-cli'
        def executor(command, **options):
            options['stderr'].write(b'Unable to locate credentials. PRIVATE_SYNTHETIC_TOKEN http://localhost/private\n')
            return subprocess.CompletedProcess(command, 253)
        original_aws = module.Aws
        output = io.StringIO()
        with patch.dict(os.environ, {'AWS_CONTAINER_CREDENTIALS_FULL_URI': 'http://localhost/path'}, clear=True), \
                patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda state: original_aws(state, executor)), \
                patch.object(sys, 'argv', ['create', 'prepare', '--source', SOURCE, '--state', str(fresh)]), \
                contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['classification'], 'NO_CREDENTIALS')
        self.assertEqual((value['requests'], value['mutations']), (1, 0))
        self.assertNotIn('PRIVATE_SYNTHETIC_TOKEN', output.getvalue())
        self.assertNotIn('http://localhost', output.getvalue())
        self.assertFalse((fresh / 'create.intent.json').exists())
        private = list(fresh.glob('run-*/*.err'))
        self.assertTrue(any(b'PRIVATE_SYNTHETIC_TOKEN' in f.read_bytes() for f in private))
        self.assertTrue(all(f.stat().st_mode & 0o777 == 0o600 for f in private))
        self.state = module.State(self.home / '.private' / 'state', self.home)

    def test_present_empty_create_intent_requires_reconciliation(self):
        self.state.save('create.intent.json', {})
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        self.reject(self.installer.prepare, 'CREATE_INTENT_REQUIRED')
        self.assertEqual([c[2] for c in self.fake.calls], ['get-caller-identity', 'get-open-id-connect-provider'])
        self.assertEqual(self.fake.mutations(), [])
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)
        self.assertFalse((self.state.folder / 'review.json').exists())

    def test_present_empty_execute_intent_cannot_report_review_ready(self):
        self.prepared()
        self.state.save('execute.intent.json', {})
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        before = len(self.fake.calls)
        mutations = len(self.fake.mutations())
        self.reject(self.installer.resume, 'EXECUTE_INTENT_REJECTED')
        self.assertEqual([c[2] for c in self.fake.calls[before:]], ['get-caller-identity', 'get-open-id-connect-provider'])
        self.assertEqual(len(self.fake.mutations()), mutations)
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_execute_with_empty_saved_intent_reconciles_without_revalidation_or_mutation(self):
        review = self.prepared()
        self.state.save('execute.intent.json', {})
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        before = len(self.fake.calls)
        mutations = len(self.fake.mutations())
        self.reject(lambda: self.installer.execute(review), 'EXECUTE_INTENT_REJECTED')
        self.assertEqual([c[2] for c in self.fake.calls[before:]], ['get-caller-identity', 'get-open-id-connect-provider'])
        self.assertEqual(len(self.fake.mutations()), mutations)
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_nonobject_false_values_are_corruption_not_missing_intents(self):
        for filename, action in [('create.intent.json', self.installer.prepare),
                                 ('execute.intent.json', self.installer.resume),
                                 ('execute.intent.json', lambda: self.installer.execute('0' * 64))]:
            for value in [False, 0, None, [], '']:
                with self.subTest(filename=filename, value=value):
                    raw = module.encoded(value)
                    self.state.save_bytes(filename, raw)
                    try:
                        self.installer.aws = module.Aws(self.state, self.fake)
                        self.reject(action, 'STATE_REJECTED')
                        self.assertEqual((self.state.folder / filename).read_bytes(), raw)
                    finally:
                        (self.state.folder / filename).unlink()
        self.assertEqual(self.fake.mutations(), [])

    def test_cli_empty_execute_intent_is_blocked_and_saved_bytes_stay_private(self):
        self.prepared()
        self.state.save('execute.intent.json', {})
        folder = self.state.folder
        saved = {f.name: f.read_bytes() for f in folder.iterdir() if f.is_file()}
        self.state.close()
        original_aws = module.Aws
        output = io.StringIO()
        with patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                patch.object(module, 'Aws', side_effect=lambda state: original_aws(state, self.fake)), \
                patch.object(sys, 'argv', ['create', 'resume', '--source', SOURCE, '--state', str(folder)]), \
                contextlib.redirect_stdout(output):
            code = module.main()
        self.state = module.State(folder, self.home)
        self.assertEqual(code, 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['result'], 'BLOCKED')
        self.assertEqual(value['classification'], 'EXECUTE_INTENT_REJECTED')
        self.assertEqual((value['requests'], value['mutations']), (2, 0))
        self.assertNotIn('reviewHash', value)
        self.assertNotIn(module.ACCOUNT, output.getvalue())
        self.assertNotIn('synthetic-stack', output.getvalue())
        self.assertNotIn(str(folder), output.getvalue())
        self.assertEqual({f.name: f.read_bytes() for f in folder.iterdir() if f.is_file()}, saved)

    def cli_review(self):
        folder = self.state.folder
        self.state.close()
        original_aws = module.Aws
        output = io.StringIO()
        try:
            with patch.object(module, 'verify_checkout'), patch.object(module.Path, 'home', return_value=self.home), \
                    patch.object(module, 'Aws', side_effect=lambda state: original_aws(state, self.fake)), \
                    patch.object(sys, 'argv', ['create', 'review', '--source', SOURCE, '--state', str(folder)]), \
                    contextlib.redirect_stdout(output):
                code = module.main()
        finally:
            self.state = module.State(folder, self.home)
        self.assertNotIn(module.ACCOUNT, output.getvalue())
        self.assertNotIn('synthetic-stack', output.getvalue())
        self.assertNotIn(str(folder), output.getvalue())
        return code, json.loads(output.getvalue())

    def test_cli_review_before_execution_still_returns_matching_review_hash(self):
        review = self.prepared()
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        mutations = len(self.fake.mutations())
        code, value = self.cli_review()
        self.assertEqual((code, value['result'], value['reviewHash']), (0, 'REVIEW_READY', review))
        self.assertEqual((value['requests'], value['mutations']), (5, 0))
        self.assertEqual(len(self.fake.mutations()), mutations)
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_cli_review_after_timeout_before_processing_reconciles_saved_execution(self):
        review = self.prepared()
        def uncertain(command, **options):
            if command[2] == 'execute-change-set':
                self.fake.calls.append(command)
                raise subprocess.TimeoutExpired(command, 10)
            return self.fake(command, **options)
        self.installer.aws.executor = uncertain
        self.reject(lambda: self.installer.execute(review), 'AWS_RESPONSE_UNCERTAIN')
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        before, mutations = len(self.fake.calls), len(self.fake.mutations())
        code, value = self.cli_review()
        self.assertEqual((code, value['result']), (0, 'INSTALL_PENDING'))
        self.assertNotIn('reviewHash', value)
        self.assertEqual((value['requests'], value['mutations']), (3, 0))
        self.assertEqual([c[2] for c in self.fake.calls[before:]],
                         ['get-caller-identity', 'get-open-id-connect-provider', 'describe-stacks'])
        self.assertEqual(len(self.fake.mutations()), mutations)
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_cli_review_after_accepted_execution_lost_ack_reports_pending(self):
        review = self.prepared()
        self.fake.lost.add('execute-change-set')
        self.reject(lambda: self.installer.execute(review), 'AWS_RESPONSE_UNCERTAIN')
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        mutations = len(self.fake.mutations())
        code, value = self.cli_review()
        self.assertEqual((code, value['result']), (0, 'INSTALL_PENDING'))
        self.assertNotIn('reviewHash', value)
        self.assertEqual((value['requests'], value['mutations']), (3, 0))
        self.assertEqual(len(self.fake.mutations()), mutations)
        self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_cli_review_cannot_ignore_present_corrupt_execution_intent(self):
        self.prepared()
        self.state.save('execute.intent.json', {})
        for intent, classification, requests in [({}, 'EXECUTE_INTENT_REJECTED', 2),
                                                  (False, 'STATE_REJECTED', 0),
                                                  ({'review': {'stackId': 'foreign-stack'}}, 'EXECUTE_INTENT_REJECTED', 2)]:
            with self.subTest(classification=classification, intent=intent):
                path = self.state.folder / 'execute.intent.json'
                path.write_bytes(module.encoded(intent))
                saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
                mutations = len(self.fake.mutations())
                code, value = self.cli_review()
                self.assertEqual((code, value['result'], value['classification']), (1, 'BLOCKED', classification))
                self.assertNotIn('reviewHash', value)
                self.assertEqual((value['requests'], value['mutations']), (requests, 0))
                self.assertEqual(len(self.fake.mutations()), mutations)
                self.assertEqual({f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}, saved)

    def test_cli_review_after_installation_performs_configuration_only_readback(self):
        self.installed()
        saved = {f.name: f.read_bytes() for f in self.state.folder.iterdir() if f.is_file()}
        mutations = len(self.fake.mutations())
        code, value = self.cli_review()
        self.assertEqual((code, value['result']), (0, 'CONFIGURATION_MATCH'))
        self.assertNotIn('reviewHash', value)
        self.assertEqual((value['requests'], value['mutations']), (21, 0))
        self.assertEqual((value['effectivePermissions'], value['managedRecovery']), ('UNKNOWN', 'NOT_EXECUTED'))
        self.assertEqual(len(self.fake.mutations()), mutations)
        for name, raw in saved.items():
            self.assertEqual((self.state.folder / name).read_bytes(), raw)

    def test_changed_source_or_template_preserves_original_state(self):
        original = (self.state.folder / 'plan.json').read_bytes()
        self.reject(lambda: module.Installer(self.state, 'b' * 40, TEMPLATE, self.installer.aws), 'STATE_CONFLICT')
        self.reject(lambda: module.Installer(self.state, SOURCE, TEMPLATE + b' ', self.installer.aws), 'TEMPLATE_REJECTED')
        self.assertEqual((self.state.folder / 'plan.json').read_bytes(), original)
        self.assertEqual(self.fake.calls, [])

    def test_private_file_modes_and_exclusive_lock(self):
        self.assertEqual(self.state.folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.state.folder / 'plan.json').stat().st_mode & 0o777, 0o600)
        self.reject(lambda: module.State(self.state.folder, self.home), 'STATE_BUSY')
        (self.state.folder / 'plan.json').chmod(0o644)
        self.reject(self.new_installer, 'PRIVATE_FILE_REQUIRED')

    def test_symlink_and_hardlink_state_rejected(self):
        target = self.home / 'target'
        target.write_text('{}'); target.chmod(0o600)
        (self.state.folder / 'bad.json').symlink_to(target)
        with self.assertRaises(OSError):
            self.state.load('bad.json')
        os.link(target, self.state.folder / 'linked.json')
        self.reject(lambda: self.state.load('linked.json'), 'PRIVATE_FILE_REQUIRED')
        outside = self.home / 'alias'; outside.symlink_to(self.state.folder)
        with self.assertRaises(ValueError):
            module.State(outside, self.home)

    def test_request_and_response_bounds_fail_closed(self):
        self.installer.aws.calls = 32
        self.reject(self.installer.prepare, 'REQUEST_BUDGET_EXHAUSTED')
        self.assertEqual(self.fake.calls, [])
        def oversized(command, **options):
            options['stdout'].write(b'x' * (module.inventory.CAPTURE_LIMIT + 1))
            return subprocess.CompletedProcess(command, 0)
        self.installer.aws = module.Aws(self.state, oversized)
        self.reject(self.installer.prepare, 'AWS_RESPONSE_LIMIT')

    def test_wrong_checkout_fails_before_aws_and_sanitizes_output(self):
        result = subprocess.run(['python3', '-B', str(HERE / 'cloudshell-create.py'), 'prepare', '--source', '0' * 40,
                                 '--state', str(self.state.folder)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        value = json.loads(result.stdout)
        self.assertEqual(value['classification'], 'CHECKOUT_REJECTED')
        self.assertEqual(value['requests'], 0)
        self.assertEqual(value['mutations'], 0)
        self.assertNotIn(str(self.state.folder), result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
