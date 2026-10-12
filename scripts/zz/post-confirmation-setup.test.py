import importlib.util
import unittest
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


if __name__ == '__main__':
    unittest.main()
