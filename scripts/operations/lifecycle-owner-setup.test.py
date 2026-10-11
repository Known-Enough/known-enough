import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('lifecycle-owner-setup.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
class SetupTests(unittest.TestCase):
    def test_preview_or_install_pending_never_starts_routes(self):
        for state in ['LIFECYCLE_OWNER_READ_REVIEW_READY', 'LIFECYCLE_OWNER_PREVIEW_PENDING', 'LIFECYCLE_OWNER_INSTALL_PENDING']:
            with self.subTest(state=state), patch.object(r.access, 'run', return_value={'result': state}), patch.object(r.routes, 'run') as route:
                self.assertEqual(r.run('a'*40, True)['result'], state)
                route.assert_not_called()
    def test_verified_scope_and_routes_are_configuration_only_not_deployment_or_erasure_proof(self):
        with patch.object(r.access, 'run', return_value={'result': 'LIFECYCLE_OWNER_READ_POLICY_PASS'}), patch.object(r.routes, 'run', return_value={'result': 'LIFECYCLE_OWNER_ROUTES_CONFIGURATION_PASS'}):
            result = r.run('a'*40, True)
            self.assertEqual(result['result'], 'LIFECYCLE_OWNER_SETUP_CONFIGURATION_PASS')
            self.assertEqual(result['dataChanges'], 0)
            self.assertEqual(result['codePublication'], 'NOT_EXECUTED')
            self.assertEqual(result['managedOwnerProof'], 'NOT_EXECUTED')
if __name__ == '__main__': unittest.main()
