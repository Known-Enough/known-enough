import base64
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('jobs-worker-release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.source='b'*40;self.package=b'synthetic worker';self.sha=hashlib.sha256(self.package).hexdigest()
        self.report=dict(sourceSha=self.source,worker=dict(sourceSha=self.source,sha256=self.sha,workerKey=self.sha+'/model-worker.zip',artifactStorage='VERIFIED'))
        self.config=dict(FunctionName=m.FUNCTION,Role=f'arn:aws:iam::{m.ACCOUNT}:role/KnownEnoughModelJobRuntime',
                         Runtime='nodejs24.x',Handler='worker.handler',Timeout=180,MemorySize=512,State='Active',
                         LastUpdateStatus='Successful',RevisionId='revision',CodeSha256=base64.b64encode(bytes.fromhex(m.OLD_HASH)).decode())
        self.rule=dict(Name='KnownEnoughModelJobs',Arn=f'arn:aws:events:us-east-1:{m.ACCOUNT}:rule/KnownEnoughModelJobs',
                       State='DISABLED',ScheduleExpression='rate(1 minute)')

    def test_candidate_hash_source_storage(self):
        self.assertEqual(m.validate_candidate(self.report,self.source,self.package),self.sha)
        for edit in [dict(sourceSha='c'*40),dict(sha256='c'*64),dict(workerKey='foreign'),dict(artifactStorage='UNVERIFIED')]:
            report={**self.report,'worker':{**self.report['worker'],**edit}}
            with self.assertRaises(RuntimeError):m.validate_candidate(report,self.source,self.package)
        with self.assertRaises(RuntimeError):m.validate_candidate(self.report,self.source,b'corrupt')

    def test_existing_source_fences(self):
        self.assertEqual(m.validate_installed(self.config,self.rule,self.sha),m.OLD_HASH)
        for field in ['Role','Runtime','Handler','Timeout','MemorySize','State','LastUpdateStatus','RevisionId']:
            with self.subTest(field=field),self.assertRaises(RuntimeError):
                m.validate_installed({**self.config,field:'wrong' if field!='RevisionId' else ''},self.rule,self.sha)
        with self.assertRaises(RuntimeError):m.validate_installed({**self.config,'Environment':{'Variables':{'PRIVATE':'synthetic'}}},self.rule,self.sha)
        for field in ['Name','Arn','State','ScheduleExpression']:
            with self.subTest(field=field),self.assertRaises(RuntimeError):m.validate_installed(self.config,{**self.rule,field:'wrong'},self.sha)

    def test_foreign_code_is_never_overwritten(self):
        with self.assertRaises(RuntimeError):m.validate_installed({**self.config,'CodeSha256':base64.b64encode(b'c'*32).decode()},self.rule,self.sha)

    def execute(self, lost=False, denied=False, already=False):
        calls=[];updated=already
        def run(args,**kwargs):
            nonlocal updated
            op=args[1:3];calls.append(op)
            if op==['sts','get-caller-identity']:data=dict(Account=m.ACCOUNT,Arn=f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubModelJobRelease/test')
            elif op==['s3api','get-object']:
                Path(args[args.index('--region')-1]).write_bytes(self.package);data={}
            elif op==['lambda','get-function-configuration']:
                data={**self.config}
                if updated:data['CodeSha256']=base64.b64encode(bytes.fromhex(self.sha)).decode()
            elif op==['events','describe-rule']:data=self.rule
            elif op==['lambda','update-function-code']:
                if not denied:updated=True
                if lost or denied:return type('R',(),dict(returncode=1,stdout=b'',stderr=b'An error occurred (AccessDeniedException)' if denied else b'network unavailable'))()
                data={}
            else:raise AssertionError(op)
            return type('R',(),dict(returncode=0,stdout=json.dumps(data).encode(),stderr=b''))()
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'RUNNER_TEMP':d,'GITHUB_SHA':self.source}),patch.object(m.subprocess,'run',run):
            Path(d,'partition-prepare-report.json').write_text(json.dumps(self.report));result=m.main()
            report=json.loads(Path(d,'partition-worker-publish-report.json').read_text())
        return result,report,calls

    def test_lost_acknowledgment_reads_without_retry(self):
        result,report,calls=self.execute(lost=True)
        self.assertEqual(result,0);self.assertEqual(calls.count(['lambda','update-function-code']),1)
        self.assertEqual(report['result'],'WORKER_CODE_DISABLED_READBACK_PASS')
        self.assertEqual(report['providerCalls'],0);self.assertEqual(report['activation'],'NOT_EXECUTED')

    def test_denied_write_never_becomes_pass(self):
        result,report,calls=self.execute(denied=True)
        self.assertEqual(result,1);self.assertEqual(report['writeError'],'AccessDeniedException')
        self.assertEqual(calls.count(['lambda','update-function-code']),1)

    def test_matching_code_needs_no_mutation(self):
        result,report,calls=self.execute(already=True)
        self.assertEqual(result,0);self.assertNotIn(['lambda','update-function-code'],calls)
        self.assertFalse(report['codeWriteRequested'])


if __name__=='__main__':unittest.main()
