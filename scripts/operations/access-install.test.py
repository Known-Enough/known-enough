#!/usr/bin/env python3
"""Offline installation, drift and lost-ack recovery tests; no AWS credentials."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('access_install', ROOT / 'scripts/operations/access-install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TEMPLATE = json.loads((ROOT / 'infra/operations/access-setup.json').read_text())
PARTICIPANT = json.loads((ROOT / 'docs/review-artifacts/OPS00/participant-policy-corrected.json').read_text())
STACK_ID = module.PREFIX + 'synthetic-stack'
CHANGE_ID = f'arn:aws:cloudformation:{module.m.REGION}:{module.m.ACCOUNT}:changeSet/synthetic/test'


class Aws:
    def __init__(self):
        self.phase = 'absent'
        self.calls = []
        self.writes = []
        self.lose = None
        self.account = module.m.ACCOUNT
        self.unowned = False
        self.modified = False
        self.warning = False
        self.pending = False
        self.unowned_runtime_policy = False
        self.bad_runtime_trust = False
        self.template = copy.deepcopy(TEMPLATE)
        self.old = {'KnownEnoughStageApiRole': {'KnownEnoughPartitionParticipant': PARTICIPANT, 'Preserved': {'Version': '2012-10-17', 'Statement': []}},
                    'KnownEnoughGithubStagingInspector': {'PreservedInspector': {'Version': '2012-10-17', 'Statement': []}}}

    def call(self, service, action, *args, mutation=False, missing=None):
        self.calls.append((service, action, args))
        value = lambda key: args[args.index(key) + 1]
        resources = self.template['Resources']
        if mutation:
            self.writes.append(action)
            self.phase = 'preview' if action == 'create-change-set' else 'complete'
            if self.lose == action:
                raise module.m.Rejected('AWS_RESPONSE_UNCERTAIN')
            return {}
        if action == 'get-caller-identity':
            return {'Account': self.account}
        if action == 'describe-stacks':
            if self.phase == 'absent':
                return None
            return {'Stacks': [{'StackName': module.STACK, 'StackId': STACK_ID,
                                'StackStatus': 'CREATE_COMPLETE' if self.phase == 'complete' else 'REVIEW_IN_PROGRESS'}]}
        if action == 'validate-policy':
            return {'findings': [{'issueCode': 'SYNTHETIC_WARNING'}] if self.warning else []}
        if action == 'describe-change-set':
            return {'StackId': STACK_ID, 'ChangeSetId': CHANGE_ID,
                    'Status': 'CREATE_IN_PROGRESS' if self.pending else 'CREATE_COMPLETE', 'ExecutionStatus': 'AVAILABLE',
                    'Changes': [{'ResourceChange': {'LogicalResourceId': name, 'ResourceType': row['Type'], 'Action': 'Add'}}
                                for name, row in resources.items()]}
        if action == 'get-template':
            return {'TemplateBody': self.template}
        if action == 'get-role':
            name = value('--role-name')
            if name in self.old:
                trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}}]} if name == 'KnownEnoughStageApiRole' else json.loads((ROOT / 'infra/permissions/shared-staging-github-inspect-trust.json').read_text())
                if self.bad_runtime_trust and name == 'KnownEnoughStageApiRole':
                    trust['Statement'][0]['Principal'] = {'AWS': 'arn:aws:iam::092954139775:user/untrusted-fixture'}
                return {'Role': {'RoleId': 'SYNTHETIC-' + name, 'Arn': f'arn:aws:iam::{module.m.ACCOUNT}:role/{name}', 'Path': '/',
                                 'AssumeRolePolicyDocument': trust}}
            if self.phase != 'complete' and not self.unowned:
                return None
            proposed = next(row['Properties'] for row in resources.values() if row['Type'] == 'AWS::IAM::Role' and row['Properties']['RoleName'] == name)
            return {'Role': {'Arn': f'arn:aws:iam::{module.m.ACCOUNT}:role/{name}', 'Path': '/', 'MaxSessionDuration': 3600,
                             'AssumeRolePolicyDocument': proposed['AssumeRolePolicyDocument'],
                             'PermissionsBoundary': {'PermissionsBoundaryArn': f'arn:aws:iam::{module.m.ACCOUNT}:policy/{name}Boundary'}}}
        if action == 'list-role-policies':
            name = value('--role-name')
            if name not in self.old:
                return {'IsTruncated': False, 'PolicyNames': ['ScopedOperations']}
            names = list(self.old[name])
            if self.phase == 'complete':
                names.append('KnownEnoughLifecycleOwner' if name == 'KnownEnoughStageApiRole' else 'KnownEnoughOperationsAccessMetadata')
            return {'IsTruncated': False, 'PolicyNames': names}
        if action == 'list-attached-role-policies':
            name = value('--role-name')
            rows = [{'PolicyName': 'KnownEnoughRuntimeModelJobs', 'PolicyArn': f'arn:aws:iam::{module.m.ACCOUNT}:policy/KnownEnoughRuntimeModelJobs'}] if self.phase == 'complete' and name == 'KnownEnoughStageApiRole' else []
            return {'IsTruncated': False, 'AttachedPolicies': rows}
        if action == 'get-role-policy':
            name, policy = value('--role-name'), value('--policy-name')
            if name in self.old and policy in self.old[name]:
                document = self.old[name][policy]
                if self.modified and policy == 'Preserved':
                    document = {'drift': True}
            else:
                document = next(row['Properties']['PolicyDocument'] for row in resources.values()
                                if row['Type'] == 'AWS::IAM::Policy' and row['Properties']['PolicyName'] == policy) if policy != 'ScopedOperations' else next(
                    row['Properties']['Policies'][0]['PolicyDocument'] for row in resources.values() if row['Type'] == 'AWS::IAM::Role' and row['Properties']['RoleName'] == name)
            return {'RoleName': name, 'PolicyName': policy, 'PolicyDocument': document}
        if action in ['get-policy', 'get-policy-version']:
            if self.unowned_runtime_policy and value('--policy-arn').endswith('/KnownEnoughRuntimeModelJobs'):
                return {'Policy': {'DefaultVersionId': 'v1'}}
            if self.phase != 'complete':
                return None
            name = value('--policy-arn').split('/')[-1]
            proposed = next(row['Properties']['PolicyDocument'] for row in resources.values()
                            if row['Type'] == 'AWS::IAM::ManagedPolicy' and row['Properties']['ManagedPolicyName'] == name)
            if action == 'get-policy':
                return {'Policy': {'Arn': value('--policy-arn'), 'DefaultVersionId': 'v1'}}
            return {'PolicyVersion': {'Document': proposed}}
        raise AssertionError(action)


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.state = module.m.State(self.home / 'state', self.home)
        self.aws = Aws()

    def tearDown(self):
        self.state.close()
        self.temp.cleanup()

    def run_install(self):
        return module.Installation(self.state, self.aws, 'a' * 40, TEMPLATE).run()

    def test_complete_and_repeat_has_exact_readback_without_new_writes(self):
        self.assertEqual(self.run_install(), 'ACCESS_INSTALL_SUBMITTED')
        self.assertEqual(self.run_install(), 'ACCESS_INSTALL_READBACK_PASS')
        self.assertEqual(self.run_install(), 'ACCESS_INSTALL_READBACK_PASS')
        self.assertEqual(self.aws.writes, ['create-change-set', 'execute-change-set'])
        self.assertEqual(json.loads((self.state.folder / 'template.json').read_bytes()), TEMPLATE)
        self.assertLess((self.state.folder / 'template.json').stat().st_size, 51200)

    def test_lost_preview_ack_reconciles_without_second_create(self):
        self.aws.lose = 'create-change-set'
        with self.assertRaisesRegex(module.m.Rejected, 'AWS_RESPONSE_UNCERTAIN'):
            self.run_install()
        self.aws.lose = None
        self.assertEqual(self.run_install(), 'ACCESS_INSTALL_SUBMITTED')
        self.assertEqual(self.aws.writes, ['create-change-set', 'execute-change-set'])

    def test_lost_execute_ack_only_reads_completed_install(self):
        self.aws.lose = 'execute-change-set'
        with self.assertRaisesRegex(module.m.Rejected, 'AWS_RESPONSE_UNCERTAIN'):
            self.run_install()
        self.aws.lose = None
        self.assertEqual(self.run_install(), 'ACCESS_INSTALL_READBACK_PASS')
        self.assertEqual(self.aws.writes, ['create-change-set', 'execute-change-set'])

    def test_unapplied_execute_intent_never_resubmits_or_reports_completion(self):
        self.run_install()
        self.aws.phase = 'preview'
        with self.assertRaisesRegex(module.m.Rejected, 'EXECUTE_OUTCOME_UNKNOWN'):
            self.run_install()
        self.assertEqual(len(self.aws.writes), 2)

    def test_pending_preview_only_creates_once(self):
        self.aws.pending = True
        self.assertEqual(self.run_install(), 'ACCESS_PREVIEW_PENDING')
        self.assertEqual(self.run_install(), 'ACCESS_PREVIEW_PENDING')
        self.assertEqual(self.aws.writes, ['create-change-set'])

    def test_account_or_unowned_role_prevents_preview(self):
        self.aws.account = '123456789012'
        with self.assertRaisesRegex(module.m.Rejected, 'ACCOUNT_REJECTED'):
            self.run_install()
        self.aws.account = module.m.ACCOUNT
        self.aws.unowned = True
        with self.assertRaisesRegex(module.m.Rejected, 'UNOWNED_ROLE_EXISTS'):
            self.run_install()
        self.assertEqual(self.aws.writes, [])

    def test_validation_warning_stops_before_any_cloud_change(self):
        self.aws.warning = True
        with self.assertRaisesRegex(module.m.Rejected, 'POLICY_VALIDATION_FINDINGS'):
            self.run_install()
        self.assertEqual(self.aws.writes, [])

    def test_baseline_drift_does_not_execute_preview(self):
        self.aws.pending = True
        self.run_install()
        self.aws.pending = False
        self.aws.modified = True
        with self.assertRaisesRegex(module.m.Rejected, 'EXISTING_ROLE_CHANGED'):
            self.run_install()
        self.assertEqual(self.aws.writes, ['create-change-set'])

    def test_installed_boundary_drift_stops_readback(self):
        self.run_install()
        self.aws.template['Resources']['MigrationBoundary']['Properties']['PolicyDocument']['Statement'][0]['Resource'].append('*')
        with self.assertRaisesRegex(module.m.Rejected, 'INSTALLED_TEMPLATE_CHANGED'):
            self.run_install()
        self.assertEqual(len(self.aws.writes), 2)

    def test_source_change_never_repins_private_progress(self):
        self.aws.pending = True
        self.run_install()
        with self.assertRaisesRegex(module.m.Rejected, 'STATE_CONFLICT'):
            module.Installation(self.state, self.aws, 'b' * 40, TEMPLATE).run()
        self.assertEqual(self.aws.writes, ['create-change-set'])

    def test_unowned_runtime_managed_policy_prevents_any_partial_cloud_install(self):
        self.aws.unowned_runtime_policy = True
        with self.assertRaisesRegex(module.m.Rejected, 'UNOWNED_BOUNDARY_EXISTS'):
            self.run_install()
        self.assertEqual(self.aws.writes, [])

    def test_runtime_trust_cannot_give_github_or_humans_self_consent_authority(self):
        self.aws.bad_runtime_trust = True
        with self.assertRaisesRegex(module.m.Rejected, 'RUNTIME_TRUST_REJECTED'):
            self.run_install()
        self.assertEqual(self.aws.writes, [])


if __name__ == '__main__':
    unittest.main()
