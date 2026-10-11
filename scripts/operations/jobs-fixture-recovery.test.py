import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('recovery',Path(__file__).with_name('jobs-fixture-recovery.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_only_owned_run_time_and_state_path(self):
  key='ops01-owned/11111111-1111-4111-9111-111111111111/state-private.json'
  self.assertTrue(m.candidate(key,'2026-10-11T23:27:00Z'))
  for other in ['ops01-owned/11111111-1111-4111-9111-111111111111/intent-private.json','outside/'+key,'ops01-owned/secret/state-private.json']:
   self.assertFalse(m.candidate(other,'2026-10-11T23:27:00Z'))
  self.assertFalse(m.candidate(key,'2026-10-11T23:26:44Z'))
  self.assertFalse(m.candidate(key,'2026-10-11T23:28:17Z'))
if __name__=='__main__':unittest.main()
