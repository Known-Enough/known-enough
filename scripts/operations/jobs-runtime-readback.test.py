import base64
import copy
import hashlib
import io
import importlib.util
import json
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('readback', Path(__file__).with_name('jobs-runtime-readback.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        memory = io.BytesIO()
        with zipfile.ZipFile(memory, 'w') as archive:
            archive.writestr('jobs-private.json', json.dumps({'schemaVersion': 1, 'sourceSha': 'b' * 40}))
            archive.writestr('worker.mjs', '// synthetic opaque worker')
        self.package = memory.getvalue()
        self.sha = hashlib.sha256(self.package).hexdigest()
        self.config = dict(CodeSha256=base64.b64encode(bytes.fromhex(self.sha)).decode(),
                           FunctionName=module.FUNCTION, Runtime='nodejs24.x', Handler='worker.handler',
                           Role=f'arn:aws:iam::{module.ACCOUNT}:role/KnownEnoughModelJobRuntime',
                           Timeout=180, MemorySize=512, State='Active', LastUpdateStatus='Successful')
        self.rule = dict(Name=module.RULE, Arn=f'arn:aws:events:{module.REGION}:{module.ACCOUNT}:rule/{module.RULE}',
                         State='DISABLED', ScheduleExpression='rate(1 minute)')

    def result(self, config=None, rule=None, package=None):
        return module.validate(config or self.config, rule or self.rule, self.package if package is None else package, self.sha, 'b' * 40)

    def test_independent_release_hash_and_source_are_required(self):
        for sha,source in [('', 'b'*40), (self.sha, ''), ('z'*64, 'b'*40)]:
            with self.assertRaises(RuntimeError):
                module.validate(self.config, self.rule, self.package, sha, source)

    def test_matching_disabled_worker(self):
        self.assertEqual(self.result()['result'], 'INSTALLED_WORKER_READBACK_PASS')
        self.assertEqual(self.result()['packageSource'], 'b' * 40)

    def test_package_source_is_read_independently_of_the_expected_source(self):
        report = module.validate(self.config, self.rule, self.package, self.sha, 'c' * 40)
        self.assertEqual(report['result'], 'INSTALLED_WORKER_MISMATCH')
        self.assertEqual(report['packageSource'], 'b' * 40)
        self.assertFalse(report['checks']['packageSource'])

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
