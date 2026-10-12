import importlib.util
import json
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('jobs-group-read-probe.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_exact_missing_action_then_scoped_absent_reads_never_writes(self):
  calls=[]
  def aws(*args):
   calls.append(args)
   if args[1]=='get-caller-identity':return {'Account':m.ACCOUNT,'Arn':f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubModelJobOperations/test'}
   if args[1]=='batch-get-item':raise RuntimeError('AccessDeniedException_dynamodb_BatchGetItem')
   if args[1]=='get-item':return {}
   raise AssertionError(args)
  report=m.probe(aws,'11111111-1111-4111-9111-111111111111');self.assertEqual(report['result'],'SCOPED_GET_PERMISSION_PASS');self.assertEqual(len(calls),4);self.assertEqual(report['mutations'],0)
  self.assertNotIn('ACCOUNT#',json.dumps(report))
 def test_unexpected_authorization_or_existing_key_never_counts_as_pass(self):
  for mode in ['allowed','collision']:
   def aws(*args):
    if args[1]=='get-caller-identity':return {'Account':m.ACCOUNT,'Arn':f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubModelJobOperations/test'}
    if args[1]=='batch-get-item' and mode=='collision':raise RuntimeError('AccessDeniedException_dynamodb_BatchGetItem')
    return {'Item':{'private':'notpublished'}} if mode=='collision' else {}
   report=m.probe(aws,'11111111-1111-4111-9111-111111111111');self.assertEqual(report['result'],'GROUP_READ_PROBE_BLOCKED');self.assertNotIn('notpublished',json.dumps(report))
if __name__=='__main__':unittest.main()
