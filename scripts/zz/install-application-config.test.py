import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install-application-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallerExecution(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads((module.ROOT / 'infra/zz/github-application-config-policy.json').read_text())
        self.trust = json.loads((module.ROOT / 'infra/zz/github-application-config-trust.json').read_text())
        self.calls = []
        self.boundary = None
        self.role = None
        self.inline = None
        self.extra_policy = False
        self.wrong_account = False
        self.lost_ack = False

    def fake_aws(self, service, action, data=None):
        self.calls.append((service, action))
        if service == 'sts':
            return {'Account': 'other' if self.wrong_account else module.ACCOUNT, 'Arn': f'arn:aws:iam::{module.ACCOUNT}:root'}
        if action == 'get-policy':
            if self.boundary is None:
                raise RuntimeError('iam:get-policy:NoSuchEntity')
            return {'Policy': self.boundary}
        if action == 'get-policy-version':
            return {'PolicyVersion': {'Document': self.policy}}
        if action == 'get-role':
            if self.role is None:
                raise RuntimeError('iam:get-role:NoSuchEntity')
            return {'Role': self.role}
        if action == 'list-attached-role-policies':
            return {'AttachedPolicies': [{'PolicyArn': 'foreign'}] if self.extra_policy else [], 'IsTruncated': False}
        if action == 'list-role-policies':
            return {'PolicyNames': [module.POLICY] if self.inline is not None else [], 'IsTruncated': False}
        if action == 'get-role-policy':
            return {'PolicyDocument': self.inline}
        if action == 'create-policy':
            self.boundary = {'DefaultVersionId': 'v1', 'Tags': data['Tags']}
        elif action == 'create-role':
            self.role = {'Arn': f'arn:aws:iam::{module.ACCOUNT}:role/{module.ROLE}', 'Path': '/', 'MaxSessionDuration': 3600,
                         'Tags': data['Tags'], 'PermissionsBoundary': {'PermissionsBoundaryArn': data['PermissionsBoundary']},
                         'AssumeRolePolicyDocument': json.loads(data['AssumeRolePolicyDocument'])}
        elif action == 'put-role-policy':
            self.inline = json.loads(data['PolicyDocument'])
        else:
            raise AssertionError(action)
        if self.lost_ack and action == 'create-role':
            raise RuntimeError('iam:create-role:CLI_FAILED')
        return {}

    def execute(self, apply=True):
        def git(cmd, **_):
            if cmd[1] == 'rev-parse':
                return 'a' * 40
            if cmd[1] == 'remote':
                return 'https://github.com/Known-Enough/known-enough.git'
            return ''
        with tempfile.TemporaryDirectory() as home, patch.object(module.Path, 'home', return_value=Path(home)), \
                patch.object(module, 'aws', side_effect=self.fake_aws), patch.object(module.subprocess, 'check_output', side_effect=git):
            return module.install('a' * 40, apply)

    def test_review_does_not_create_and_install_repeats_without_writes(self):
        self.assertEqual(self.execute(False)['configurationWrites'], 0)
        self.assertIsNone(self.role)
        report = self.execute()
        self.assertEqual(report['result'], 'APPLICATION_CONFIG_ROLE_READBACK_PASS')
        self.assertEqual(report['configurationWrites'], 3)
        self.calls.clear()
        self.assertEqual(self.execute()['configurationWrites'], 0)
        self.assertFalse(any(action.startswith(('create-', 'put-')) for _, action in self.calls))

    def test_lost_role_ack_resumes_owned_partial_installation(self):
        self.lost_ack = True
        with self.assertRaisesRegex(RuntimeError, 'iam:create-role:CLI_FAILED'):
            self.execute()
        self.lost_ack = False
        report = self.execute()
        self.assertEqual(report['configurationWrites'], 1)
        self.assertEqual(self.calls.count(('iam', 'create-role')), 1)

    def test_foreign_attachment_or_trust_is_not_overwritten(self):
        self.execute()
        self.extra_policy = True
        with self.assertRaisesRegex(RuntimeError, 'FOREIGN_ROLE_POLICY'):
            self.execute()
        self.extra_policy = False
        self.role['AssumeRolePolicyDocument'] = {'Statement': []}
        with self.assertRaisesRegex(RuntimeError, 'ROLE_CONFIGURATION_CHANGED'):
            self.execute()

    def test_other_account_and_unowned_policy_block_before_mutation(self):
        self.wrong_account = True
        with self.assertRaisesRegex(RuntimeError, 'WRONG_AWS_ACCOUNT'):
            self.execute()
        self.wrong_account = False
        self.boundary = {'Tags': [], 'DefaultVersionId': 'v1'}
        with self.assertRaisesRegex(RuntimeError, 'EXISTING_RESOURCE_NOT_OWNED'):
            self.execute()
        self.assertIsNone(self.role)

    def test_changed_inline_or_boundary_is_not_repaired_implicitly(self):
        self.execute()
        self.inline = {'Statement': []}
        with self.assertRaisesRegex(RuntimeError, 'INLINE_POLICY_CHANGED'):
            self.execute()
        self.inline = copy.deepcopy(self.policy)
        self.role['PermissionsBoundary']['PermissionsBoundaryArn'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'ROLE_CONFIGURATION_CHANGED'):
            self.execute()


class DeploymentAccess(unittest.TestCase):
    def test_scope_has_no_database_model_or_iam_allowance(self):
        policy = json.loads((module.ROOT / 'infra/zz/github-application-config-policy.json').read_text())
        for statement in policy['Statement']:
            if statement['Effect'] != 'Allow':
                continue
            actions = statement['Action'] if isinstance(statement['Action'], list) else [statement['Action']]
            self.assertFalse(any(action.startswith(('iam:', 'sts:', 'dynamodb:', 'bedrock:')) for action in actions))
            self.assertNotEqual(statement['Resource'], '*')
        trust = json.loads((module.ROOT / 'infra/zz/github-application-config-trust.json').read_text())
        self.assertEqual(trust['Statement'][0]['Condition']['StringEquals']['token.actions.githubusercontent.com:sub'],
                         'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main')

    def test_normal_publication_paths_configure_before_amplify_and_share_lock(self):
        for filename in ['deploy-amplify-staging.yml', 'zz-frontend-release.yml']:
            text = (module.ROOT / '.github/workflows' / filename).read_text()
            configuration = text.index('post-confirmation-setup.py --apply --backup-to-s3')
            publication_role = text.index('role/KnownEnoughAmplifyMainDeploy')
            self.assertLess(configuration, publication_role)
            self.assertIn('group: known-enough-primary-frontend', text)
            self.assertIn('cancel-in-progress: false', text)
            self.assertIn("github.actor_id == '143764700'", text)
            self.assertIn("github.actor_id == '44531296'", text)


if __name__ == '__main__':
    unittest.main()
