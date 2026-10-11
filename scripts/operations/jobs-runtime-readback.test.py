import base64
import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('readback', Path(__file__).with_name('jobs-runtime-readback.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.package = b'synthetic opaque worker bytes'
        self.sha = hashlib.sha256(self.package).hexdigest()
        self.config = dict(CodeSha256=base64.b64encode(bytes.fromhex(self.sha)).decode(),
                           FunctionName=module.FUNCTION, Runtime='nodejs24.x', Handler='worker.handler',
                           Role=f'arn:aws:iam::{module.ACCOUNT}:role/KnownEnoughModelJobRuntime',
                           Timeout=180, MemorySize=512, State='Active', LastUpdateStatus='Successful')
        self.rule = dict(Name=module.RULE, Arn=f'arn:aws:events:{module.REGION}:{module.ACCOUNT}:rule/{module.RULE}',
                         State='DISABLED', ScheduleExpression='rate(1 minute)')

    def result(self, config=None, rule=None, package=None):
        with patch.object(module, 'EXPECTED_SHA', self.sha):
            return module.validate(config or self.config, rule or self.rule, self.package if package is None else package)

    def test_matching_disabled_worker(self):
        self.assertEqual(self.result()['result'], 'INSTALLED_WORKER_READBACK_PASS')

    def test_artifact_and_deployed_hash_are_independent(self):
        self.assertEqual(self.result(package=b'other')['result'], 'INSTALLED_WORKER_MISMATCH')
        self.assertEqual(self.result(config={**self.config, 'CodeSha256': 'other'})['result'], 'INSTALLED_WORKER_MISMATCH')

    def test_each_configuration_fence(self):
        for field in ['FunctionName', 'Runtime', 'Handler', 'Role', 'Timeout', 'MemorySize', 'State', 'LastUpdateStatus']:
            with self.subTest(field=field):
                self.assertEqual(self.result(config={**self.config, field: 'wrong'})['result'], 'INSTALLED_WORKER_MISMATCH')

    def test_environment_never_disclosed(self):
        config = copy.deepcopy(self.config)
        config['Environment'] = {'Variables': {'PRIVATE': 'synthetic-value'}}
        result = self.result(config=config)
        self.assertEqual(result['result'], 'INSTALLED_WORKER_MISMATCH')
        self.assertNotIn('synthetic-value', str(result))

    def test_each_rule_fence(self):
        for field in ['Name', 'Arn', 'State', 'ScheduleExpression']:
            with self.subTest(field=field):
                self.assertEqual(self.result(rule={**self.rule, field: 'wrong'})['result'], 'INSTALLED_WORKER_MISMATCH')

    def test_unknown_capabilities_stay_unknown(self):
        report = self.result()
        self.assertEqual(report['reservedConcurrency'], 'NOT_READ')
        self.assertEqual(report['targetBinding'], 'NOT_READ')
        self.assertEqual(report['effectiveRuntimePermissions'], 'NOT_EXECUTED')
        self.assertEqual(report['mutations'], 0)
        self.assertEqual(report['providerCalls'], 0)


if __name__ == '__main__':
    unittest.main()
