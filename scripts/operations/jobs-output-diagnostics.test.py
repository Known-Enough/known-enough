import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('diag', Path(__file__).with_name('jobs-output-diagnostics.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class DiagnosticTests(unittest.TestCase):
    def test_only_closed_allowlisted_events_escape(self):
        events = [{'message': value} for value in [
            'timestamp request-id WARN {"event":"model-job-output-invalid","stage":"OUTPUT_SHAPE"}',
            '{"event":"model-job-output-invalid","stage":"PRIVATE"}',
            '{"event":"model-job-output-invalid","stage":"KERNEL_INVALID","body":"PRIVATE"}',
            '{"event":"other","stage":"KERNEL_INVALID"}', 'PRIVATE', '{malformed',
            '{"event":"model-job-output-invalid","stage":[]}', 4]]
        self.assertEqual(m.stages_from_logs(events), ['OUTPUT_SHAPE'])
if __name__ == '__main__': unittest.main()
