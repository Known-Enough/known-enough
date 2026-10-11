import base64
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('smoke',Path(__file__).with_name('jobs-worker-smoke.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SmokeTests(unittest.TestCase):
    def test_exact_empty_summary_only(self):
        good=dict(event='model-job-run',**{k:0 for k in m.COUNTS})
        self.assertTrue(m.empty_summary(json.dumps(good)))
        for bad in [{**good,'attempted':1},{**good,'attempted':False},{**good,'private':'synthetic'},dict(event='model-job-run'),'not-json']:
            self.assertFalse(m.empty_summary(json.dumps(bad) if isinstance(bad,dict) else bad))

    def execute(self,failed=False,missing=False):
        calls=[];source='c'*40;sha='d'*64
        def run(args,**kwargs):
            op=args[1:3];calls.append(op)
            if op==['sts','get-caller-identity']:data=dict(Account=m.ACCOUNT,Arn=f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubModelJobRelease/test')
            elif op==['lambda','get-function-configuration']:data=dict(CodeSha256=base64.b64encode(bytes.fromhex(sha)).decode(),State='Active',LastUpdateStatus='Successful')
            elif op==['events','describe-rule']:data=dict(State='DISABLED',ScheduleExpression='rate(1 minute)')
            elif op==['logs','filter-log-events']:
                body={'event':'model-job-run',**{k:0 for k in m.COUNTS}}
                if failed:body={'event':'model-job-run','result':'UNAVAILABLE'}
                data={'events':[] if missing else [{'message':'request-prefix '+json.dumps(body)}]}
            elif op in [['events','enable-rule'],['events','disable-rule']]:data={}
            else:raise AssertionError(op)
            return type('R',(),dict(returncode=0,stdout=json.dumps(data).encode(),stderr=b''))()
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'RUNNER_TEMP':d,'GITHUB_SHA':source,'PACKAGE_SOURCE':source,'WORKER_SHA':sha,'SMOKE_PHASE':'schedule'}),patch.object(m.subprocess,'run',run),patch.object(m.time,'sleep'):
            Path(d,'worker-smoke-control.json').write_text(json.dumps(dict(sourceSha=source,result='DISABLED_EMPTY_CONTROL_VERIFIED')))
            result=m.main();report=json.loads(Path(d,'worker-smoke-schedule-report.json').read_text())
        return result,report,calls

    def test_real_schedule_path_observed_and_disabled(self):
        result,report,calls=self.execute()
        self.assertEqual(result,0);self.assertTrue(report['ruleDisabledReadback'])
        self.assertEqual(calls.count(['events','enable-rule']),1);self.assertEqual(calls.count(['events','disable-rule']),1)
        self.assertNotIn(['lambda','invoke'],calls)

    def test_unavailable_is_failure_and_schedule_disabled(self):
        result,report,calls=self.execute(failed=True)
        self.assertEqual(result,1);self.assertEqual(report['code'],'MODEL_JOB_RUN_UNAVAILABLE')
        self.assertTrue(report['ruleDisabledReadback']);self.assertEqual(calls.count(['events','enable-rule']),1)

    def test_absent_execution_is_unknown_not_pass(self):
        result,report,calls=self.execute(missing=True)
        self.assertEqual(result,1);self.assertEqual(report['code'],'EMPTY_WORKER_EXECUTION_NOT_OBSERVED')
        self.assertEqual(calls.count(['logs','filter-log-events']),15);self.assertTrue(report['ruleDisabledReadback'])


if __name__=='__main__':unittest.main()
