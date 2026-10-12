import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('request', Path(__file__).with_name('jobs-provider-request.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def state():
    return {'sourceSha': m.SOURCE, 'runId': m.RUN, 'fixtures': [{'mailboxRemoved': True},
            {'mailbox': {'address': 'keqa-' + 'a' * 32 + '@example.test', 'password': 'PRIVATE_PASSWORD', 'token': 'PRIVATE_TOKEN'}, 'accessToken': 'PRIVATE_COGNITO'}]}

class Tests(unittest.TestCase):
    def test_only_password_free_request_rendered_and_foreign_source_blocked(self):
        text = m.request_text(state())
        self.assertNotIn('PRIVATE_', text)
        self.assertIn('HTTP 401', text)
        other = state(); other['sourceSha'] = 'foreign'
        with self.assertRaises(RuntimeError): m.request_text(other)
        other = state(); other['fixtures'][1]['mailbox']['address'] = 'real@example.test'
        with self.assertRaises(RuntimeError): m.request_text(other)
    def test_unknown_ack_uses_read_without_second_put_and_private_files_removed(self):
        calls = []
        def aws(*args):
            calls.append(args)
            if args[1] == 'get-caller-identity': return {'Account': m.ACCOUNT, 'Arn': f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubQaRelease/test'}
            if args[1] == 'put-object': raise RuntimeError('PreconditionFailed')
            if args[1] == 'get-object':
                Path(args[-1]).write_text(json.dumps(state()) if args[args.index('--key')+1].endswith('state-private.json') else m.request_text(state()))
            return {}
        with tempfile.TemporaryDirectory() as folder:
            report = m.prepare(aws, Path(folder));self.assertEqual(list(Path(folder).iterdir()), [])
        self.assertEqual(report['result'], 'PRIVATE_PROVIDER_REQUEST_AVAILABLE')
        self.assertEqual(report['putAcknowledgment'], 'READ_RECONCILED')
        self.assertEqual(sum(c[1]=='put-object' for c in calls), 1)
        self.assertNotIn('keqa-', json.dumps(report));self.assertFalse(report['emailSent'])
    def test_existing_mismatched_request_is_never_replaced_or_accepted(self):
        def aws(*args):
            if args[1]=='get-caller-identity':return {'Account':m.ACCOUNT,'Arn':f'arn:aws:sts::{m.ACCOUNT}:assumed-role/KnownEnoughGithubQaRelease/test'}
            if args[1]=='put-object':raise RuntimeError('PreconditionFailed')
            Path(args[-1]).write_text(json.dumps(state()) if args[args.index('--key')+1].endswith('state-private.json') else 'foreign content')
            return {}
        with tempfile.TemporaryDirectory() as folder:report=m.prepare(aws,Path(folder))
        self.assertEqual(report['code'],'PRIVATE_REQUEST_CONTENT_MISMATCH')

if __name__=='__main__':unittest.main()
