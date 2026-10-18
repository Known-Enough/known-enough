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

    def execute(self,failed=False,missing=False,activate=False,logging=True,deactivate=False):
        calls=[];source='c'*40;sha='d'*64;enabled=deactivate
        def run(args,**kwargs):
            nonlocal enabled
            op=args[1:3];calls.append(op)
            if op==['sts','get-caller-identity']:data=dict(Account=m.ACCOUNT,Arn=f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubModelJobRelease/test')
            elif op==['lambda','get-function-configuration']:data=dict(CodeSha256=base64.b64encode(bytes.fromhex(sha)).decode(),State='Active',LastUpdateStatus='Successful')
            elif op==['events','describe-rule']:data=dict(State='ENABLED' if enabled else 'DISABLED',ScheduleExpression='rate(1 minute)')
            elif op==['logs','filter-log-events']:
                body={'event':'model-job-run',**{k:0 for k in m.COUNTS}}
                if failed:body={'event':'model-job-run','result':'UNAVAILABLE'}
                data={'events':[] if missing else [{'message':'request-prefix '+json.dumps(body)}]}
            elif op in [['events','enable-rule'],['events','disable-rule']]:enabled=op[1]=='enable-rule';data={}
            else:raise AssertionError(op)
            return type('R',(),dict(returncode=0,stdout=json.dumps(data).encode(),stderr=b''))()
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'RUNNER_TEMP':d,'GITHUB_SHA':source,'PACKAGE_SOURCE':source,'WORKER_SHA':sha,'SMOKE_PHASE':'schedule','SCHEDULE_OPERATION':'deactivate' if deactivate else 'activate' if activate else 'smoke'}),patch.object(m.subprocess,'run',run),patch.object(m.time,'sleep'):
            Path(d,'worker-smoke-control.json').write_text(json.dumps(dict(sourceSha=source,result='ENABLED_EMPTY_CONTROL_VERIFIED' if activate or deactivate else 'DISABLED_EMPTY_CONTROL_VERIFIED')))
            Path(d,'fix01-logging-guard.json').write_text(json.dumps(dict(source=source,result='GUARD_PASS',logging='DISABLED' if logging else 'ENABLED')))
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

    def test_activation_keeps_existing_schedule_enabled_only_after_observed_empty_tick(self):
        result,report,calls=self.execute(activate=True)
        self.assertEqual(result,0);self.assertEqual(report['result'],'WORKER_SCHEDULE_ACTIVATION_PASS')
        self.assertEqual(calls.count(['events','enable-rule']),1);self.assertNotIn(['events','disable-rule'],calls)

    def test_activation_failure_disables_schedule_and_logging_guard_prevents_enabling(self):
        result,report,calls=self.execute(activate=True,failed=True)
        self.assertEqual(result,1);self.assertTrue(report['ruleDisabledReadback'])
        result,report,calls=self.execute(activate=True,logging=False)
        self.assertEqual(result,1);self.assertEqual(report['code'],'SCHEDULE_LOGGING_GUARD_MISSING')
        self.assertNotIn(['events','enable-rule'],calls)

    def test_deactivation_verifies_empty_control_and_worker_before_disabling_existing_schedule(self):
        result,report,calls=self.execute(deactivate=True)
        self.assertEqual(result,0);self.assertEqual(report['result'],'WORKER_SCHEDULE_DEACTIVATION_PASS')
        self.assertEqual(calls.count(['events','disable-rule']),1);self.assertNotIn(['events','enable-rule'],calls)
        self.assertNotIn(['logs','filter-log-events'],calls)


if __name__=='__main__':unittest.main()
