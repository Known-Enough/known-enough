import hashlib
import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('entry', Path(__file__).with_name('entry-only-build.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Isolation(unittest.TestCase):
    def test_only_exact_removal_is_allowed(self):
        original = b'before\n' + module.BLOCK + b'after\n'
        module.verify_patch(original, b'before\nafter\n')
        for candidate in [original, b'other', b'before\nafter\n' + b'other edit']:
            with self.assertRaisesRegex(RuntimeError, 'ENTRY_PATCH_NOT_ISOLATED'):
                module.verify_patch(original, candidate)

    def test_changed_live_bytes_block_publication(self):
        data = b'public'
        paths = ['/', '/assets/one.js', '/assets/two.js', '/assets/three.js', '/assets/style.css']
        publication = {'sourceSha': module.BASE, 'files': [{'path': p, 'sha256': hashlib.sha256(data).hexdigest()} for p in paths]}
        module.verify_live(publication, lambda _: data)
        with self.assertRaisesRegex(RuntimeError, 'LIVE_FRONTEND_CHANGED'):
            module.verify_live(publication, lambda _: b'changed')
        publication['sourceSha'] = 'a' * 40
        with self.assertRaisesRegex(RuntimeError, 'ENTRY_BASE_INVALID'):
            module.verify_live(publication, lambda _: data)

    def test_foreign_path_and_duplicates_are_rejected(self):
        files = [{'path': '/', 'sha256': 'a' * 64}] * 5
        with self.assertRaisesRegex(RuntimeError, 'ENTRY_BASE_INVALID'):
            module.verify_live({'sourceSha': module.BASE, 'files': files}, lambda _: b'')
        files = [{'path': p, 'sha256': 'a' * 64} for p in ['/', '/assets/a.js', '/assets/b.js', '/assets/c.js', '//other.example/file.js']]
        with self.assertRaisesRegex(RuntimeError, 'ENTRY_BASE_INVALID'):
            module.verify_live({'sourceSha': module.BASE, 'files': files}, lambda _: b'')


if __name__ == '__main__':
    unittest.main()
