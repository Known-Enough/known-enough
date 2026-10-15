import sys
sys.path.pop(0)
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

helper = runpy.run_path(str(Path(__file__).with_name('retention.py')))
SOURCE = 'a' * 40
POLICY = {'schemaVersion': 1, 'kind': 'RETENTION_POLICY', 'revision': 4, 'enabled': False, 'dataClass': 'SYNTHETIC',
          'rawConversationMs': 0, 'structuredMs': 86400000, 'replayMs': 3600000, 'journalMs': 604800000,
          'backupMs': None, 'providerMs': None, 'realPersonPolicy': 'UNAPPROVED'}


def envelope(policy):
    return {**helper['KEY'], 'revision': {'N': str(policy['revision'])}, 'payload': {'S': json.dumps(policy, separators=(',', ':'))}}


class RetentionTest(unittest.TestCase):
    def test_only_synthetic_enabled_and_revision_change(self):
        next_policy = json.loads(helper['candidate'](envelope(POLICY))['payload']['S'])
        self.assertEqual(next_policy, {**POLICY, 'enabled': True, 'revision': 5})
        self.assertEqual(helper['candidate'](envelope(next_policy)), envelope(next_policy))

    def test_real_or_malformed_policies_are_never_activated(self):
        for changed in [{'dataClass': 'REAL', 'realPersonPolicy': 'APPROVED'}, {'revision': True}, {'rawConversationMs': False},
                        {'schemaVersion': True}, {'structuredMs': 0}, {'providerMs': 400 * 86400000}, {'extra': 'private'}]:
            with self.assertRaises(ValueError):
                helper['candidate'](envelope({**POLICY, **changed}))

    def exercise(self, mode):
        current = envelope(POLICY)
        objects = {}
        writes = []
        phase = 'prepare'

        def aws(args, **_kwargs):
            nonlocal current
            if args[1:3] == ['sts', 'get-caller-identity']:
                role = 'KnownEnoughGithubQaRelease' if phase == 'backup' else 'KnownEnoughGithubRetentionPolicy'
                result = {'Account': '092954139775', 'Arn': 'arn:aws:sts::092954139775:assumed-role/' + role + '/test'}
            elif args[1:3] == ['dynamodb', 'get-item']:
                self.assertEqual(json.loads(args[args.index('--key') + 1]), helper['KEY'])
                result = {'Item': copy.deepcopy(current)}
            elif args[1:3] == ['s3api', 'put-object']:
                self.assertIn('--if-none-match', args)
                key = args[args.index('--key') + 1]
                objects[key] = Path(args[args.index('--body') + 1]).read_bytes()
                result = {'VersionId': 'private-version'}
            elif args[1:3] == ['s3api', 'get-object']:
                key = args[args.index('--key') + 1]
                Path(args[args.index('--key') + 2]).write_bytes(objects[key] if mode != 'backup_tamper' else b'private-tamper')
                result = {'VersionId': 'private-version', 'ServerSideEncryption': 'AES256'}
            elif args[1:3] == ['dynamodb', 'transact-write-items']:
                items = json.loads(args[args.index('--transact-items') + 1])
                self.assertEqual(len(items), 1)
                put = items[0]['Put']
                self.assertEqual(put['Item']['PK'], helper['KEY']['PK'])
                self.assertEqual(put['ExpressionAttributeValues'][':p'], current['payload'])
                self.assertEqual(put['ExpressionAttributeValues'][':r'], current['revision'])
                writes.append(items)
                current = put['Item']
                if mode == 'lost_ack':
                    return subprocess.CompletedProcess(args, 1, b'', b'An error occurred (RequestTimeout)')
                result = {}
            else:
                self.fail('Unexpected operation')
            return subprocess.CompletedProcess(args, 0, json.dumps(result).encode(), b'')

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['api', 'worker', 'logging', 'enable']:
                result = 'CONTROL_READBACK_PASS' if name == 'enable' else 'GUARD_PASS'
                (root / ('fix01-' + name + '-guard.json')).write_text(json.dumps({'source': SOURCE, 'result': result, 'enabled': True}))
            reports = []
            for phase in ['prepare', 'backup', 'apply']:
                if mode == 'no_backup' and phase == 'backup':
                    continue
                if mode == 'drift' and phase == 'apply':
                    current = envelope({**POLICY, 'revision': 6})
                with patch.dict(os.environ, {'RUNNER_TEMP': folder, 'EXPECTED_SOURCE': SOURCE}), patch('subprocess.run', aws), patch('sys.argv', ['retention.py', phase]), contextlib.redirect_stdout(io.StringIO()):
                    helper['main']()
                reports.append(json.loads((root / ('fix01-retention-' + phase + '-guard.json')).read_text()))
                if reports[-1]['result'] == 'BLOCKED':
                    break
        return reports, writes, current

    def test_private_backup_and_single_cas(self):
        reports, writes, current = self.exercise('success')
        self.assertEqual(reports[-1]['result'], 'SYNTHETIC_PROCESSING_APPLY_PASS')
        self.assertEqual(len(writes), 1)
        self.assertTrue(json.loads(current['payload']['S'])['enabled'])
        self.assertTrue(all(report['providerCalls'] == report['stampWrites'] == report['totalWrites'] == 0 for report in reports))

    def test_lost_ack_is_read_back_without_replay(self):
        reports, writes, _ = self.exercise('lost_ack')
        self.assertEqual(reports[-1]['result'], 'SYNTHETIC_PROCESSING_APPLY_PASS')
        self.assertEqual(len(writes), 1)

    def test_backup_drift_or_absence_and_policy_drift_stop_before_write(self):
        for mode in ['backup_tamper', 'no_backup', 'drift']:
            reports, writes, _ = self.exercise(mode)
            self.assertEqual(reports[-1]['result'], 'BLOCKED')
            self.assertEqual(writes, [])


if __name__ == '__main__':
    unittest.main()
