import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('readback', Path(__file__).with_name('jobs-consent-access-readback.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ReadbackTests(unittest.TestCase):
    def fixture(self, deny=None, drift=False):
        inline = {'Statement': [{'Sid': 'JoinedKernelStateAndGuardCAS', 'Action': ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem']}]}
        boundary = {'Statement': []}
        expected = {'inline': inline, 'boundary': boundary}
        calls = []
        def aws(*args):
            calls.append(args)
            if args[1] == deny: raise RuntimeError('AccessDenied')
            return {
                'get-caller-identity': {'Account': m.ACCOUNT, 'Arn': f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubStagingInspector/test'},
                'get-role': {'Role': {'Arn': f'arn:aws:iam::{m.ACCOUNT}:role/{m.ROLE}', 'PermissionsBoundary': {'PermissionsBoundaryArn': m.BOUNDARY}}},
                'get-role-policy': {'PolicyDocument': inline},
                'get-policy': {'Policy': {'DefaultVersionId': 'v1'}},
                'get-policy-version': {'PolicyVersion': {'Document': {} if drift else boundary}},
            }[args[1]]
        return expected, aws, calls
    def test_actual_match_identifies_missing_update_without_claiming_execution(self):
        expected, aws, calls = self.fixture()
        report = m.readback(expected, aws)
        self.assertEqual(report['result'], 'CONSENT_POLICY_CONFIGURATION_MATCH')
        self.assertEqual(report['installedRoomActions'], ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem'])
        self.assertEqual(report['effectiveTransaction'], 'NOT_EXECUTED')
        self.assertEqual(len(calls), 5)
        self.assertTrue(all(c[1].startswith('get-') for c in calls))
    def test_denial_is_exact_and_stops_without_retries(self):
        expected, aws, calls = self.fixture(deny='get-role-policy')
        report = m.readback(expected, aws)
        self.assertEqual(report['operation'], 'iam:GetRolePolicy')
        self.assertEqual(report['code'], 'AccessDenied')
        self.assertEqual(len(calls), 3)
        self.assertEqual(report['mutations'], 0)
    def test_boundary_drift_blocks(self):
        expected, aws, _ = self.fixture(drift=True)
        self.assertEqual(m.readback(expected, aws)['code'], 'INSTALLED_CONSENT_PROFILE_DRIFT')

if __name__ == '__main__': unittest.main()
