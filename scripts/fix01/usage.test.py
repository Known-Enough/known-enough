"""Synthetic finite two-job cleanup qualification; never contacts AWS."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import sys
sys.path = [entry for entry in sys.path if Path(entry).resolve() != Path(__file__).resolve().parent]
import unittest
import uuid
from unittest.mock import patch

SOURCE = 'a' * 40


class UsageCleanupTest(unittest.TestCase):
    def exercise(self, mode):
        fixture = {'groupId': 'owned-group', 'subject': 'owned-person', 'decisionId': 'owned-decision',
                   'draftRequestKey': 'public-request', 'ownerRequestKey': 'owner-request'}
        key = lambda pk: {'PK': {'S': pk}, 'SK': {'S': 'STATE'}}
        control = {'sourceSha': SOURCE, 'active': [], 'slots': []}
        total = {'runs': 5, 'messages': 4, 'reservedTokens': 36864, 'reservedCostMicros': 20000}
        journal = {}
        for kind, decision, nonce in [('ARCHITECT', fixture['groupId'], fixture['draftRequestKey']),
                                      ('OWNER', fixture['decisionId'], fixture['ownerRequestKey'])]:
            values = [fixture['groupId'], fixture['subject'], nonce] if kind == 'ARCHITECT' else [fixture['subject'], decision, nonce]
            draft = ('draft-' if kind == 'ARCHITECT' else 'owner-') + hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()[:40]
            digest = hashlib.sha256(json.dumps([SOURCE, decision, draft], separators=(',', ':')).encode()).digest()[:16]
            pk = 'MODELJOB#' + str(uuid.UUID(bytes=digest, version=4))
            job = {'reference': {'kind': kind, 'subject': fixture['subject'], 'sourceSha': SOURCE,
                                 'decisionId': decision, 'requestKey': nonce},
                   'attempts': 1, 'phase': 'SUCCEEDED', 'reason': None, 'usage': {'inputTokens': 20, 'outputTokens': 30},
                   'reservedTokens': 18432, 'reservedCostMicros': 10000}
            if kind == 'OWNER' and mode == 'uncertain':
                job.update(phase='DEAD', reason='PROVIDER_UNCONFIRMED', usage=None)
            if kind == 'OWNER' and mode == 'foreign':
                job['reference']['subject'] = 'foreign-person'
            journal[pk] = {**key(pk), 'revision': {'N': '5'}, 'payload': {'S': json.dumps(job)}}
        writes = []

        def aws(args, **_kwargs):
            if args[1:3] == ['sts', 'get-caller-identity']:
                result = {'Account': '092954139775', 'Arn': 'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/synthetic'}
            elif args[1:3] == ['dynamodb', 'get-item']:
                pk = json.loads(args[args.index('--key') + 1])['PK']['S']
                item = ({'payload': {'S': json.dumps(total)}} if pk == 'TOTAL' else
                        {**key(pk), 'revision': {'N': '2'}, 'payload': {'S': json.dumps(control)}} if pk == 'OPERATIONS#MODEL_JOBS' else journal.get(pk))
                result = {'Item': item} if item else {}
            elif args[1:3] == ['dynamodb', 'transact-write-items']:
                items = json.loads(args[args.index('--transact-items') + 1]); writes.append(items)
                self.assertEqual(len(items), 2)
                self.assertEqual(items[0]['Delete']['TableName'], 'KnownEnoughOperationsJournal')
                self.assertEqual(items[1]['ConditionCheck']['Key'], key('OPERATIONS#MODEL_JOBS'))
                delete = items[0]['Delete']; pk = delete['Key']['PK']['S']
                self.assertEqual(delete['ExpressionAttributeValues'][':p'], journal[pk]['payload'])
                self.assertEqual(delete['ExpressionAttributeValues'][':r'], journal[pk]['revision'])
                del journal[pk]
                if mode == 'lost_ack':
                    return subprocess.CompletedProcess(args, 1, '', 'An error occurred (RequestTimeout)')
                result = {}
            else:
                self.fail('Unexpected AWS operation')
            return subprocess.CompletedProcess(args, 0, json.dumps(result), '')

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'partition-cutover-private').mkdir()
            (root / 'partition-cutover-private/owned-fixtures-private.json').write_text(json.dumps({'sourceSha': SOURCE, 'fixtures': [fixture]}))
            (root / 'fix01-usage-before-report.json').write_text(json.dumps({'source': SOURCE, 'totals': {**total, 'reservedTokens': 0, 'reservedCostMicros': 0}}))
            with patch.dict(os.environ, {'RUNNER_TEMP': folder, 'EXPECTED_SOURCE': SOURCE}), patch('subprocess.run', aws), patch('sys.argv', ['usage.py']), contextlib.redirect_stdout(io.StringIO()):
                try:
                    runpy.run_path(str(Path(__file__).with_name('usage.py')), run_name='__main__')
                except SystemExit as error:
                    self.assertEqual(error.code, 1)
            report = json.loads((root / 'fix01-usage-report.json').read_text())
        self.assertEqual(report['totalWrites'], 0)
        self.assertNotIn('owned-person', json.dumps(report))
        self.assertNotIn('MODELJOB#', json.dumps(report))
        return report, journal, writes

    def test_both_known_owned_terminal_jobs(self):
        report, journal, writes = self.exercise('success')
        self.assertEqual(report['result'], 'OWN_USAGE_AND_TERMINAL_CLEANUP_PASS')
        self.assertEqual(report['providerCalls'], 2)
        self.assertEqual(report['journalDeletes'], 2)
        self.assertEqual(len(writes), 2)
        self.assertEqual(journal, {})

    def test_unknown_owner_call_is_preserved(self):
        report, journal, writes = self.exercise('uncertain')
        self.assertEqual(report['error'], 'PROVIDER_OUTCOME_UNKNOWN_PRESERVE_JOB')
        self.assertEqual(len(journal), 1)
        self.assertEqual(len(writes), 1)

    def test_foreign_reference_is_not_deleted(self):
        report, journal, writes = self.exercise('foreign')
        self.assertEqual(report['error'], 'OWN_MODEL_REFERENCE_MISMATCH')
        self.assertEqual(len(journal), 1)
        self.assertEqual(len(writes), 1)

    def test_lost_delete_acknowledgment_is_read_back_without_replay(self):
        report, journal, writes = self.exercise('lost_ack')
        self.assertEqual(report['result'], 'OWN_USAGE_AND_TERMINAL_CLEANUP_PASS')
        self.assertEqual(len(writes), 2)
        self.assertEqual(journal, {})


if __name__ == '__main__':
    unittest.main()
