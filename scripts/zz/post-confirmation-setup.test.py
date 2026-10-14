import importlib.util
import base64
import copy
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('post-confirmation-setup.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SetupBoundary(unittest.TestCase):
    def test_preserves_auth_and_foreign_hooks(self):
        pool = {'Id': module.POOL, 'Policies': {'PasswordPolicy': {'MinimumLength': 8}}, 'AdminCreateUserConfig': {'AllowAdminCreateUserOnly': False},
                'AutoVerifiedAttributes': ['email'], 'LambdaConfig': {'PreSignUp': 'existing-trusted-hook'}}
        skeleton = {key: None for key in ['Policies', 'AdminCreateUserConfig', 'AutoVerifiedAttributes', 'LambdaConfig', 'UserPoolId']}
        update = module.preserved_update(pool, skeleton)
        self.assertEqual(update['Policies'], pool['Policies'])
        self.assertFalse(update['AdminCreateUserConfig']['AllowAdminCreateUserOnly'])
        self.assertEqual(update['LambdaConfig']['PreSignUp'], 'existing-trusted-hook')
        pool['LambdaConfig']['PostConfirmation'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'FOREIGN_POST_CONFIRMATION'):
            module.preserved_update(pool, skeleton)

    def test_profile_routes_retain_jwt_and_fixed_integration(self):
        basis = {'AuthorizationType': 'JWT', 'AuthorizerId': 'abc', 'Target': 'integrations/xyz'}
        profile = module.checked_route(basis, 'POST /account/profile')
        self.assertEqual(profile['AuthorizationType'], 'JWT')
        self.assertEqual(profile['AuthorizerId'], 'abc')
        self.assertEqual(module.checked_route(basis, 'OPTIONS /account/profile')['AuthorizationType'], 'NONE')
        with self.assertRaisesRegex(RuntimeError, 'ACCOUNT_ROUTE_INVALID'):
            module.checked_route({'AuthorizationType': 'NONE', 'Target': 'integrations/xyz'}, 'GET /account/profile')

    def test_foreign_integration_or_audience_rejected(self):
        auth = {'JwtConfiguration': {'Issuer': f'https://cognito-idp.{module.REGION}.amazonaws.com/{module.POOL}', 'Audience': ['3accf7paalvon2m8ue8okfi853']}}
        integration = {'IntegrationType': 'AWS_PROXY', 'IntegrationUri': module.ARN}
        module.verify_integration(auth, integration)
        with self.assertRaisesRegex(RuntimeError, 'INTEGRATION_IDENTITY_INVALID'):
            module.verify_integration(auth, {**integration, 'IntegrationUri': 'foreign'})
        auth['JwtConfiguration']['Audience'] = ['foreign']
        with self.assertRaisesRegex(RuntimeError, 'AUTHORIZER_IDENTITY_INVALID'):
            module.verify_integration(auth, integration)


class SetupExecution(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.fail = None
        self.lost_ack = False
        self.config = module.configuration()
        self.pool = {'Id': module.POOL, 'Policies': {'PasswordPolicy': {'MinimumLength': 8}}, 'AdminCreateUserConfig': {'AllowAdminCreateUserOnly': False},
                     'AutoVerifiedAttributes': ['email'], 'LambdaConfig': {'PreSignUp': 'preserved-hook'}}
        self.routes = [{'RouteKey': 'GET /account', 'AuthorizationType': 'JWT', 'AuthorizerId': 'abc', 'Target': 'integrations/xyz'}]
        self.policy = []
        self.backup = None
        self.hash = self.config['apiSha256']

    def fake_cli(self, cmd, **_):
        service, operation = cmd[1:3]
        self.calls.append((service, operation))
        data = json.loads(cmd[cmd.index('--cli-input-json') + 1]) if '--cli-input-json' in cmd else {}
        if self.fail == operation:
            return subprocess.CompletedProcess(cmd, 1, b'', b'An error occurred (AccessDenied)')
        if operation == 'get-caller-identity':
            value = {'Account': module.ACCOUNT}
        elif operation == 'describe-user-pool':
            value = {'UserPool': copy.deepcopy(self.pool)}
        elif operation == 'get-function-configuration':
            value = {'FunctionArn': module.ARN, 'CodeSha256': base64.b64encode(bytes.fromhex(self.hash)).decode(),
                     'RevisionId': 'revision1', 'State': 'Active', 'LastUpdateStatus': 'Successful'}
        elif operation == 'get-routes':
            value = {'Items': copy.deepcopy(self.routes)}
        elif operation == 'get-authorizer':
            value = {'JwtConfiguration': {'Issuer': f'https://cognito-idp.{module.REGION}.amazonaws.com/{module.POOL}', 'Audience': ['3accf7paalvon2m8ue8okfi853']}}
        elif operation == 'get-integration':
            value = {'IntegrationType': 'AWS_PROXY', 'IntegrationUri': module.ARN}
        elif operation == 'get-stage':
            value = {'AutoDeploy': True}
        elif operation == 'get-policy':
            value = {'Policy': json.dumps({'Statement': self.policy}), 'RevisionId': 'policy1'}
        elif operation == 'put-object':
            content = Path(cmd[cmd.index('--body') + 1]).read_bytes()
            self.backup = (content, data)
            value = {}
        elif operation == 'head-object':
            value = {'ContentLength': len(self.backup[0]), 'Metadata': self.backup[1]['Metadata']}
        elif operation == 'update-user-pool' and '--generate-cli-skeleton' in cmd:
            value = {key: None for key in ['UserPoolId', 'Policies', 'AdminCreateUserConfig', 'AutoVerifiedAttributes', 'LambdaConfig']}
        elif operation == 'add-permission':
            self.policy.append({'Sid': module.SID, 'Effect': 'Allow', 'Principal': {'Service': 'cognito-idp.amazonaws.com'}, 'Action': 'lambda:InvokeFunction',
                                'Resource': module.ARN, 'Condition': {'ArnLike': {'AWS:SourceArn': module.POOL_ARN}, 'StringEquals': {'AWS:SourceAccount': module.ACCOUNT}}})
            value = {}
        elif operation == 'create-route':
            self.routes.append({key: value for key, value in data.items() if key != 'ApiId'})
            value = {}
        elif operation == 'update-user-pool':
            self.pool.update({key: value for key, value in data.items() if key != 'UserPoolId'})
            value = {}
        else:
            raise AssertionError((service, operation))
        if self.lost_ack and operation in ['add-permission', 'create-route', 'update-user-pool'] and '--generate-cli-skeleton' not in cmd:
            raise subprocess.TimeoutExpired(cmd, 30)
        return subprocess.CompletedProcess(cmd, 0, json.dumps(value).encode(), b'')

    def execute(self, args=None):
        with tempfile.TemporaryDirectory() as home, patch.object(module.Path, 'home', return_value=Path(home)), \
                patch.object(module.subprocess, 'run', side_effect=self.fake_cli), patch('sys.argv', ['setup', *(args or ['--apply', '--backup-to-s3'])]), \
                patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}):
            return module.main()

    def test_complete_setup_then_repeat_is_write_free(self):
        report = self.execute()
        self.assertEqual(report['result'], 'ZZ02_SETUP_READBACK_PASS')
        self.assertEqual(report['configurationWrites'], 2 + len(self.config['routes']))
        self.assertEqual(self.pool['LambdaConfig']['PreSignUp'], 'preserved-hook')
        backup_index = self.calls.index(('s3api', 'head-object'))
        self.assertLess(backup_index, self.calls.index(('lambda', 'add-permission')))
        self.calls.clear()
        repeat = self.execute()
        self.assertEqual(repeat['result'], 'ZZ02_SETUP_READBACK_PASS')
        self.assertEqual(repeat['configurationWrites'], 0)
        self.assertFalse(any(operation in ['put-object', 'add-permission', 'create-route', 'update-user-pool'] for _, operation in self.calls))

    def test_failed_private_backup_prevents_all_application_writes(self):
        self.fail = 'put-object'
        report = self.execute()
        self.assertEqual(report['code'], 'AccessDenied')
        self.assertEqual(report['configurationWrites'], 0)
        self.assertEqual(self.policy, [])
        self.assertEqual(len(self.routes), 1)
        self.assertNotIn('PostConfirmation', self.pool['LambdaConfig'])

    def test_wrong_runtime_and_foreign_route_do_not_write(self):
        self.hash = '0' * 64
        self.assertEqual(self.execute()['code'], 'CHECKED_RUNTIME_HASH_REQUIRED')
        self.hash = self.config['apiSha256']
        self.routes.append({'RouteKey': 'GET /account/profile', 'AuthorizationType': 'NONE', 'Target': 'integrations/foreign'})
        self.assertEqual(self.execute()['code'], 'PROFILE_ROUTE_DRIFT')
        self.assertNotIn(('s3api', 'put-object'), self.calls)

    def test_lost_ack_readback_does_not_repeat_writes(self):
        self.lost_ack = True
        report = self.execute()
        self.assertEqual(report['result'], 'ZZ02_SETUP_READBACK_PASS')
        self.assertEqual(self.calls.count(('lambda', 'add-permission')), 1)
        self.assertEqual(self.calls.count(('apigatewayv2', 'create-route')), len(self.config['routes']))

    def test_ci_requires_durable_backup_but_inspection_is_read_only(self):
        self.assertEqual(self.execute(['--apply'])['code'], 'DURABLE_CONFIGURATION_BACKUP_REQUIRED')
        report = self.execute(['--api-sha256', self.hash])
        self.assertEqual(report['result'], 'ZZ02_SETUP_METADATA_READ')
        self.assertNotIn(('s3api', 'put-object'), self.calls)


if __name__ == '__main__':
    unittest.main()
