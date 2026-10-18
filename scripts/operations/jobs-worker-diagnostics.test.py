import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('jobs-worker-diagnostics.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class DiagnosticTests(unittest.TestCase):
    def test_private_or_unrecognized_log_content_cannot_escape(self):
        events = [{'timestamp': 1000, 'message': message} for message in [
            'REPORT RequestId: 12345678-1234-4234-8234-123456789abc\tDuration: 10023.52 ms\tMemory Size: 512 MB',
            'prefix {"event":"model-job-output-invalid","stage":"KERNEL_STALE"}',
            '{"event":"model-job-output-invalid","stage":"KERNEL_STALE","private":"CANARY"}',
            '{"event":"model-job-output-invalid","stage":[]}', 'PRIVATE_CANARY', 'bad-json {',
        ]]
        self.assertEqual(m.finite_events(events), [
            {'event': 'duration', 'timestamp': 1000, 'durationMs': 10023.52},
            {'event': 'model-job-output-invalid', 'stage': 'KERNEL_STALE', 'timestamp': 1000},
        ])


if __name__ == '__main__':
    unittest.main()
