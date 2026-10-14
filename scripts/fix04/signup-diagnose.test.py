import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('signup-diagnose.py')


class Diagnosis(unittest.TestCase):
    def invoke(self, phase, responder):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'fix04-signup-configuration-private.json').write_text(json.dumps({
                'account': '092954139775', 'userPoolId': 'us-east-1_V9OMjd0zx', 'emailKey': 'k' * 32}))
            def command(args, **_):
                return subprocess.CompletedProcess(args, 0, json.dumps(responder(args)), '')
            output = io.StringIO()
            with patch.dict(os.environ, {'RUNNER_TEMP': folder, 'EXPECTED_SOURCE': 'a' * 40}), \
                    patch.object(sys, 'argv', [str(SCRIPT), phase]), \
                    patch('subprocess.run', side_effect=command), contextlib.redirect_stdout(output):
                try:
                    runpy.run_path(str(SCRIPT))
                except SystemExit:
                    pass
            return json.loads(output.getvalue())

    def test_missing_account_and_owned_email_conflict_are_counts_only(self):
        def response(args):
            if args[1] == 'sts':
                return {'Account': '092954139775'}
            if args[1] == 'cognito-idp':
                return {'Users': [{'UserStatus': 'CONFIRMED', 'Username': 'PRIVATE_NAME',
                    'UserCreateDate': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'Attributes': [{'Name': key, 'Value': value} for key, value in
                        {'sub': 'private-new', 'email': 'PRIVATE_EMAIL@example.invalid', 'email_verified': 'true'}.items()]}]}
            key = json.loads(args[args.index('--key') + 1])['PK']['S']
            if key == 'ACCOUNT#private-new':
                return {}
            value = {'subject': 'private-old'} if key.startswith('EMAIL#') else {'status': 'APPROVED'}
            return {'Item': {'payload': {'S': json.dumps({'value': value})}}}
        report = self.invoke('identity', response)
        self.assertEqual(report['checks']['intake']['missingWithOtherEmailOwner'], 1)
        self.assertEqual(report['checks']['intake']['existingEmailOwnerStatus'], {'APPROVED': 1})
        encoded = json.dumps(report)
        for private in ['PRIVATE_NAME', 'PRIVATE_EMAIL', 'private-new', 'private-old', 'k' * 32]:
            self.assertNotIn(private, encoded)

    def test_foreign_account_stops_before_provider_or_storage_reads(self):
        operations = []
        def response(args):
            operations.append(args[1])
            return {'Account': 'other'}
        report = self.invoke('identity', response)
        self.assertEqual(report['error'], 'WRONG_ACCOUNT')
        self.assertEqual(operations, ['sts'])

    def test_log_messages_are_not_exported(self):
        report = self.invoke('logs', lambda args: {'Account': '092954139775'} if args[1] == 'sts' else {
            'events': [{'message': 'SIGNUP_INTAKE_UNAVAILABLE PRIVATE_EMAIL PRIVATE_TOKEN'}], 'nextToken': 'PRIVATE_CURSOR'})
        self.assertEqual(report['checks']['logs']['markers'], ['SIGNUP_INTAKE_UNAVAILABLE'])
        self.assertTrue(report['checks']['logs']['truncated'])
        self.assertNotIn('PRIVATE', json.dumps(report))


if __name__ == '__main__':
    unittest.main()
