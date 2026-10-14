import base64
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('config', Path(__file__).with_name('shared-email-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Tests(unittest.TestCase):
    def fixture(self):
        return {'CodeSha256': base64.b64encode(bytes.fromhex('a' * 64)).decode(), 'RevisionId': 'fresh',
                'FunctionArn': 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api',
                'Role': 'arn:aws:iam::092954139775:role/KnownEnoughStageApiRole', 'Handler': 'api.handler',
                'State': 'Active', 'LastUpdateStatus': 'Successful', 'Environment': {'Variables': {
                    'COGNITO_USER_POOL_ID': 'us-east-1_V9OMjd0zx', 'NP_GROUP_EMAIL_KEY': 'k' * 64,
                    'KE14_MODEL_MODE': 'DISABLED', 'KE14_PAID_CALLS_APPROVED': 'false', 'UNRELATED_PRIVATE': 'preserve'}}}

    def test_private_exact_normalized_digest_preserves_configuration_and_is_idempotent(self):
        current = self.fixture()
        result = module.proposed(current, 'a' * 64, 'Test@example.invalid')
        self.assertEqual(result['Variables']['UNRELATED_PRIVATE'], 'preserve')
        self.assertNotIn('Test@example.invalid', json.dumps(result))
        self.assertEqual(len(json.loads(result['Variables'][module.SETTING])), 1)
        current['Environment'] = result
        self.assertEqual(module.proposed(current, 'a' * 64, 'test@example.invalid'), result)
        other = module.proposed(current, 'a' * 64, 'different@example.invalid')
        self.assertEqual(len(json.loads(other['Variables'][module.SETTING])), 2)

    def test_foreign_or_drifted_target_and_malformed_setting_fail_before_writes(self):
        for field, value in [('CodeSha256', 'changed'), ('Role', 'other'), ('Handler', 'ke13b-lambda.handler'), ('LastUpdateStatus', 'InProgress')]:
            current = self.fixture()
            current[field] = value
            with self.assertRaises(RuntimeError):
                module.proposed(current, 'a' * 64, 'test@example.invalid')
        current = self.fixture()
        current['Environment']['Variables'][module.SETTING] = '["invalid"]'
        with self.assertRaises(RuntimeError):
            module.proposed(current, 'a' * 64, 'test@example.invalid')
        with self.assertRaises(RuntimeError):
            module.proposed(self.fixture(), 'a' * 64, '')


if __name__ == '__main__':
    unittest.main()
