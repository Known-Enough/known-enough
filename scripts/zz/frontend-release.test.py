import importlib.util
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('frontend', Path(__file__).with_name('frontend-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicBoundary(unittest.TestCase):
    def test_private_build_bytes_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'index.html').write_text('public')
            (directory / 'configuration-private.json').write_text('never publish')
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_BUILD_INVALID'):
                module.public_manifest(directory)

    def test_only_public_assets_and_own_role(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / 'index.html').write_text('public')
            self.assertEqual(module.public_manifest(directory)[0]['path'], '/')
        module.validate_identity({'Account': module.ACCOUNT, 'Arn': f'arn:aws:sts::{module.ACCOUNT}:assumed-role/KnownEnoughAmplifyMainDeploy/test'})
        with self.assertRaisesRegex(RuntimeError, 'FRONTEND_ROLE_INVALID'):
            module.validate_identity({'Account': module.ACCOUNT, 'Arn': f'arn:aws:sts::{module.ACCOUNT}:assumed-role/Other/test'})


if __name__ == '__main__':
    unittest.main()
