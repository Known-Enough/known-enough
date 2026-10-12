import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('grant',Path(__file__).with_name('jobs-journal-permission-grant.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=Path(__file__).resolve().parents[2]
TEMPLATE=json.loads((ROOT/'infra/operations/access-setup.json').read_text())
WANTED_INLINE=TEMPLATE['Resources']['JobsRole']['Properties']['Policies'][0]['PolicyDocument']
WANTED_BOUNDARY=TEMPLATE['Resources']['JobsBoundary']['Properties']['PolicyDocument']
def base(doc):return {**doc,'Statement':[s for s in doc['Statement'] if s.get('Sid')!=m.GRANT['Sid']]}
class GrantTests(unittest.TestCase):
    def test_actual_readback_baselines_and_prepared_source_match_without_union(self):
        self.assertEqual(m.digest(base(WANTED_INLINE)),m.INLINE_HASH)
        self.assertEqual(m.digest(base(WANTED_BOUNDARY)),m.BOUNDARY_HASH)
        self.assertEqual(m.candidate(base(WANTED_INLINE),m.INLINE_HASH),WANTED_INLINE)
        self.assertEqual(m.candidate(base(WANTED_BOUNDARY),m.BOUNDARY_HASH),WANTED_BOUNDARY)
    def test_source_drift_or_broader_sid_is_never_merged(self):
        drift=copy.deepcopy(WANTED_INLINE);drift['Statement'][0]['Action'].append('iam:CreateRole')
        with self.assertRaisesRegex(RuntimeError,'BASE_POLICY_DRIFT'):m.candidate(drift,m.INLINE_HASH)
        broad=copy.deepcopy(WANTED_INLINE)
        next(s for s in broad['Statement'] if s.get('Sid')==m.GRANT['Sid'])['Resource']='*'
        with self.assertRaisesRegex(RuntimeError,'SID_CONFLICT'):m.candidate(broad,m.INLINE_HASH)
    def simulate(self, already=False,lost=False,denied=False,foreign=False):
        inline=copy.deepcopy(WANTED_INLINE if already else base(WANTED_INLINE));boundary=copy.deepcopy(WANTED_BOUNDARY if already else base(WANTED_BOUNDARY));calls=[]
        def aws(*args):
            nonlocal inline,boundary
            calls.append(args[:2])
            op=args[:2]
            if op==('sts','get-caller-identity'):return {'Account':'000000000000' if foreign else m.ACCOUNT}
            if op==('iam','get-role'):return {'Role':{'Arn':f'arn:aws:iam::{m.ACCOUNT}:role/{m.ROLE}','PermissionsBoundary':{'PermissionsBoundaryArn':m.BOUNDARY}}}
            if op==('iam','get-role-policy'):return {'PolicyDocument':inline}
            if op==('iam','get-policy'):return {'Policy':{'DefaultVersionId':'v1'}}
            if op==('iam','get-policy-version'):return {'PolicyVersion':{'Document':boundary}}
            if op==('iam','create-policy-version'):
                if denied:raise RuntimeError('AccessDenied')
                boundary=json.loads(Path(args[args.index('--policy-document')+1][7:]).read_text())
                if lost:raise RuntimeError('NETWORK')
                return {}
            if op==('iam','put-role-policy'):
                inline=json.loads(Path(args[args.index('--policy-document')+1][7:]).read_text());return {}
            raise AssertionError(op)
        with tempfile.TemporaryDirectory() as d:
            result=m.apply(aws,Path(d))
        return result,calls
    def test_two_scoped_updates_read_back_without_data_or_worker_actions(self):
        result,calls=self.simulate();self.assertEqual(result['iamWriteRequests'],2)
        self.assertEqual(result['result'],'OPS03_TERMINAL_POLICY_READBACK_PASS');self.assertEqual(result['effectiveBAccess'],'NOT_EXECUTED')
        self.assertEqual(result['dataWrites'],0);self.assertTrue(all(s in ['sts','iam'] for s,_ in calls))
    def test_already_matching_grant_is_read_only(self):
        result,calls=self.simulate(already=True);self.assertEqual(result['iamWriteRequests'],0)
        self.assertNotIn(('iam','create-policy-version'),calls);self.assertNotIn(('iam','put-role-policy'),calls)
    def test_lost_write_ack_is_read_back_without_reissue(self):
        result,calls=self.simulate(lost=True);self.assertEqual(result['result'],'OPS03_TERMINAL_POLICY_READBACK_PASS')
        self.assertEqual(calls.count(('iam','create-policy-version')),1)
    def test_denied_admin_or_foreign_account_never_passes(self):
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'):self.simulate(denied=True)
        with self.assertRaisesRegex(RuntimeError,'ACCOUNT_MISMATCH'):self.simulate(foreign=True)
if __name__=='__main__':unittest.main()
