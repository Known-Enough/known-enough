import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('cloudshell-inventory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PRIVATE = 'SYNTHETIC_PRIVATE_METADATA_DO_NOT_PUBLISH'


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def executor(self, patch=None):
        patch = patch or {}

        def run(args, **options):
            self.calls.append((args, options))
            op = args[2]
            value = patch.get(op, {'private': PRIVATE})
            if op == 'get-caller-identity' and op not in patch:
                value = {'Account': module.ACCOUNT,
                         'Arn': f'arn:aws:sts::{module.ACCOUNT}:assumed-role/OwnSetupRole/private-session', 'UserId': PRIVATE}
            if isinstance(value, Exception):
                raise value
            if isinstance(value, tuple):
                options['stderr'].write(value[1].encode())
                return types.SimpleNamespace(returncode=value[0])
            options['stdout'].write(value if isinstance(value, bytes) else json.dumps(value).encode())
            return types.SimpleNamespace(returncode=0)
        return run

    def test_read_only_inventory_private_outputs_and_bounded_transport(self):
        report = module.Inventory(self.folder, 'a' * 40, self.executor()).collect()
        self.assertEqual(report['identity'], 'VERIFIED_ACCOUNT_ONLY')
        self.assertEqual(report['mutations'], 0)
        self.assertEqual(report['result'], 'INVENTORY_REQUIRED')
        self.assertEqual(report['setupCapabilities'], 'UNKNOWN')
        self.assertEqual(report['managedProof'], 'NOT_EXECUTED')
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertNotIn('private-session', json.dumps(report))
        self.assertIn(PRIVATE, (self.folder / 'primary-runtime.json').read_text())
        for args, options in self.calls:
            self.assertRegex(args[2], r'^(get-|describe-|list-)')
            self.assertNotIn('get-secret-value', args)
            self.assertNotIn('list-users', args)
            self.assertIn('--no-paginate', args)
            self.assertEqual(options['env']['AWS_MAX_ATTEMPTS'], '1')
            self.assertLessEqual(options['timeout'], 10)
            if args[1] == 's3api':
                self.assertEqual(args[args.index('--expected-bucket-owner') + 1], module.ACCOUNT)
        self.assertTrue(all(p.stat().st_mode & 0o077 == 0 for p in self.folder.glob('*.json')))

    def test_wrong_account_foreign_root_arn_and_missing_identity_stop_before_inventory(self):
        for identity in ({'Account': '000000000000', 'Arn': 'private'},
                         {'Account': module.ACCOUNT, 'Arn': 'arn:aws:iam::000000000000:root'},
                         {'Account': module.ACCOUNT, 'Arn': 'arn:aws:sts::000000000000:assumed-role/Own/x'},
                         {'Account': module.ACCOUNT}, (1, 'An error occurred (ExpiredToken): ' + PRIVATE)):
            with self.subTest(identity=identity), tempfile.TemporaryDirectory() as folder:
                self.calls.clear()
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({'get-caller-identity': identity})).collect()
                self.assertEqual(report['identity'], 'REJECTED')
                self.assertEqual(len(self.calls), 1)
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_same_account_root_collects_bounded_metadata_without_principal_or_permission_claims(self):
        arn = f'arn:aws:iam::{module.ACCOUNT}:root'
        report = module.Inventory(self.folder, 'a' * 40, self.executor({
            'get-caller-identity': {'Account': module.ACCOUNT, 'Arn': arn, 'UserId': PRIVATE}})).collect()
        self.assertEqual(report['identity'], 'VERIFIED_ACCOUNT_ONLY')
        self.assertGreater(len(self.calls), 1)
        self.assertEqual(report['requests'], len(self.calls))
        self.assertLessEqual(report['requests'], 64)
        self.assertEqual(report['mutations'], 0)
        self.assertEqual(report['result'], 'INVENTORY_REQUIRED')
        self.assertEqual(report['setupCapabilities'], 'UNKNOWN')
        self.assertEqual(report['effectivePermissions'], 'UNKNOWN')
        self.assertEqual(report['managedProof'], 'NOT_EXECUTED')
        self.assertIn(PRIVATE, (self.folder / 'identity.json').read_text())
        self.assertIn(PRIVATE, (self.folder / 'primary-runtime.json').read_text())
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertNotIn(arn, json.dumps(report))
        for args, options in self.calls:
            self.assertRegex(args[2], r'^(get-|describe-|list-)')
            self.assertNotIn('get-secret-value', args)
            self.assertNotIn('list-users', args)
            self.assertIn('--no-paginate', args)
            self.assertEqual(options['env']['AWS_MAX_ATTEMPTS'], '1')
            self.assertLessEqual(options['timeout'], 10)
        self.assertTrue(all(p.stat().st_mode & 0o077 == 0 for p in self.folder.glob('*.json')))

    def test_existing_user_and_assumed_role_continue_account_only_metadata_collection(self):
        for arn in (f'arn:aws:iam::{module.ACCOUNT}:user/OwnSetupUser',
                    f'arn:aws:sts::{module.ACCOUNT}:assumed-role/OwnSetupRole/private-session'):
            with self.subTest(arn=arn), tempfile.TemporaryDirectory() as folder:
                self.calls.clear()
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-caller-identity': {'Account': module.ACCOUNT, 'Arn': arn, 'UserId': PRIVATE}})).collect()
                self.assertEqual(report['identity'], 'VERIFIED_ACCOUNT_ONLY')
                self.assertGreater(len(self.calls), 1)
                self.assertEqual(report['mutations'], 0)
                self.assertEqual(report['effectivePermissions'], 'UNKNOWN')
                self.assertNotIn(PRIVATE, json.dumps(report))
                self.assertNotIn(arn, json.dumps(report))

    def test_root_requires_exact_account_and_arn_before_resource_reads(self):
        own = f'arn:aws:iam::{module.ACCOUNT}:root'
        bad = [{'Account': '000000000000', 'Arn': own}]
        bad.extend({'Account': module.ACCOUNT, 'Arn': arn} for arn in (
            'arn:aws:iam::000000000000:root', own + '/', own + '/user', own + ' ',
            ' ' + own, own.replace('arn:aws:', 'arn:aws-cn:'),
            own.replace('iam::', 'sts::'), own.replace('iam::', 'iam:us-east-1:'), None, 1))
        for identity in bad:
            with self.subTest(identity=identity), tempfile.TemporaryDirectory() as folder:
                self.calls.clear()
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-caller-identity': identity})).collect()
                self.assertEqual(report['identity'], 'REJECTED')
                self.assertEqual(len(self.calls), 1)
                self.assertEqual(report['mutations'], 0)
                self.assertEqual(report['configuration'], {})

    def test_root_metadata_denials_remain_unknown_skip_dependents_and_publish_no_private_details(self):
        error = (1, 'An error occurred (AccessDenied): ' + PRIVATE)
        patch = {name: error for name in ('describe-stacks', 'get-role', 'describe-table', 'get-bucket-versioning')}
        patch['get-caller-identity'] = {'Account': module.ACCOUNT,
                                     'Arn': f'arn:aws:iam::{module.ACCOUNT}:root', 'UserId': PRIVATE}
        report = module.Inventory(self.folder, 'a' * 40, self.executor(patch)).collect()
        self.assertEqual(report['identity'], 'VERIFIED_ACCOUNT_ONLY')
        denied = [row for row in report['reads'] if row['code'] == 'AccessDenied']
        self.assertGreater(len(denied), 0)
        self.assertTrue(all(row['status'] == 'UNKNOWN' for row in denied))
        self.assertFalse(any(args[2] in ('get-template', 'list-role-policies', 'describe-continuous-backups')
                             for args, _ in self.calls))
        self.assertEqual(report['mutations'], 0)
        self.assertEqual(report['setupCapabilities'], 'UNKNOWN')
        self.assertEqual(report['effectivePermissions'], 'UNKNOWN')
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_denied_parents_skip_dependents_and_are_unknown_not_absent(self):
        error = (1, 'An error occurred (AccessDenied): ' + PRIVATE)
        report = module.Inventory(self.folder, 'a' * 40, self.executor(
            {name: error for name in ('describe-stacks', 'get-role', 'describe-table', 'get-bucket-versioning')})).collect()
        for row in report['reads']:
            if row['code'] == 'AccessDenied':
                self.assertEqual(row['status'], 'UNKNOWN')
        self.assertFalse(any(args[2] in ('get-template', 'list-role-policies', 'describe-continuous-backups') for args, _ in self.calls))
        self.assertNotIn(PRIVATE, json.dumps(report))

    def test_missing_resources_separate_from_ambiguous_cloudformation_validation(self):
        inv = module.Inventory(self.folder, 'a' * 40, self.executor({
            'get-role': (1, 'An error occurred (NoSuchEntity): ' + PRIVATE),
            'describe-table': (1, 'An error occurred (ResourceNotFoundException): ' + PRIVATE),
            'get-bucket-versioning': (1, 'An error occurred (NoSuchBucket): ' + PRIVATE),
            'describe-stacks': (1, 'An error occurred (ValidationError): permission or malformed target ' + PRIVATE)}))
        r = inv.collect()
        self.assertTrue(any(row['status'] == 'ABSENT' for row in r['reads']))
        self.assertTrue(all(row['status'] == 'UNKNOWN' for row in r['reads'] if row['code'] == 'ValidationError'))
        self.assertEqual(sum(args[1] == 's3api' for args, _ in self.calls), 1)
        self.calls.clear()
        inv = module.Inventory(self.folder, 'a' * 40, self.executor({'describe-stacks':
            (1, 'An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id KnownEnoughOperationsRecovery does not exist\n')}))
        inv.read('missing', ['cloudformation', 'describe-stacks'], missing_stack='KnownEnoughOperationsRecovery')
        self.assertEqual(inv.report['reads'][0]['status'], 'ABSENT')

    def test_malformed_oidc_audience_never_matches_or_aborts_inventory(self):
        values = [None, 1, True, 'prefix-sts.amazonaws.com-suffix',
                  {'sts.amazonaws.com': PRIVATE}, ['sts.amazonaws.com', None],
                  [PRIVATE, 1], [True]]
        providers = [{'Url': 'token.actions.githubusercontent.com', 'ClientIDList': value}
                     for value in values]
        providers.append({'Url': 'token.actions.githubusercontent.com'})
        for provider in providers:
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as folder:
                self.calls.clear()
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-open-id-connect-provider': provider})).collect()
                row = next(row for row in report['reads'] if row['id'] == 'oidc')
                self.assertEqual(report['configuration']['oidcAudience'], 'UNKNOWN')
                self.assertEqual((row['status'], row['code']), ('UNKNOWN', 'AWS_RESPONSE_REJECTED'))
                self.assertNotIn('metadataHash', row)
                self.assertFalse((Path(folder) / 'oidc.json').exists())
                self.assertTrue((Path(folder) / 'primary-runtime.json').exists())
                self.assertEqual(report['mutations'], 0)
                self.assertEqual(report['effectivePermissions'], 'UNKNOWN')
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_malformed_oidc_url_is_unknown_not_a_configuration_comparison(self):
        for url in (None, 1, True, [], {'private': PRIVATE}):
            with self.subTest(url=url), tempfile.TemporaryDirectory() as folder:
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-open-id-connect-provider': {'Url': url, 'ClientIDList': ['sts.amazonaws.com']}})).collect()
                row = next(row for row in report['reads'] if row['id'] == 'oidc')
                self.assertEqual(report['configuration']['oidcAudience'], 'UNKNOWN')
                self.assertEqual((row['status'], row['code']), ('UNKNOWN', 'AWS_RESPONSE_REJECTED'))
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_malformed_role_or_trust_document_skips_dependents_and_keeps_summary(self):
        roles = [None, [], PRIVATE, 1, True, {}]
        roles.extend({'AssumeRolePolicyDocument': value} for value in (None, [], PRIVATE, 1, True))
        responses = [{'Role': role} for role in roles] + [{'private': PRIVATE}]
        for response in responses:
            with self.subTest(response=response), tempfile.TemporaryDirectory() as folder:
                self.calls.clear()
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({'get-role': response})).collect()
                rows = [row for row in report['reads'] if row['id'] in module.ROLES]
                self.assertEqual(len(rows), len(module.ROLES))
                self.assertTrue(all((row['status'], row['code']) == ('UNKNOWN', 'AWS_RESPONSE_REJECTED')
                                    for row in rows))
                self.assertTrue(all('metadataHash' not in row for row in rows))
                self.assertEqual(report['configuration']['recoveryTrust'], 'UNKNOWN')
                self.assertFalse(any(args[2] in ('list-role-policies', 'list-attached-role-policies', 'get-role-policy')
                                     for args, _ in self.calls))
                self.assertTrue((Path(folder) / 'primary-runtime.json').exists())
                self.assertEqual(report['mutations'], 0)
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_valid_provider_metadata_keeps_exact_match_mismatch_and_private_readback(self):
        cases = [('token.actions.githubusercontent.com', ['other', 'sts.amazonaws.com'], 'MATCH'),
                 ('token.actions.githubusercontent.com', [], 'MISMATCH'),
                 ('other-provider.example', ['sts.amazonaws.com'], 'MISMATCH')]
        for url, audiences, expected in cases:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as folder:
                report = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-open-id-connect-provider': {'Url': url, 'ClientIDList': audiences, 'private': PRIVATE},
                    'get-role': {'Role': {'AssumeRolePolicyDocument': {}, 'private': PRIVATE}}})).collect()
                row = next(row for row in report['reads'] if row['id'] == 'oidc')
                self.assertEqual((row['status'], row['code']), ('READ', None))
                self.assertEqual(report['configuration']['oidcAudience'], expected)
                self.assertEqual(report['configuration']['recoveryTrust'], 'MISMATCH')
                self.assertIn(PRIVATE, (Path(folder) / 'oidc.json').read_text())
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_custom_subject_and_audience_comparison_keeps_other_trust_conditions_exact(self):
        trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
            'Principal': {'Federated': module.PROVIDER}, 'Action': 'sts:AssumeRoleWithWebIdentity',
            'Condition': {'StringEquals': {'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                                         'token.actions.githubusercontent.com:sub': module.SUBJECT}}}]}
        for condition, expected in ((trust, 'MATCH'), ({}, 'MISMATCH')):
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as folder:
                result = module.Inventory(Path(folder), 'a' * 40, self.executor({
                    'get-role': {'Role': {'AssumeRolePolicyDocument': condition}},
                    'get-open-id-connect-provider': {'Url': 'token.actions.githubusercontent.com', 'ClientIDList': ['sts.amazonaws.com']}})).collect()
                self.assertEqual(result['configuration']['recoveryTrust'], expected)
                self.assertEqual(result['configuration']['oidcAudience'], 'MATCH')

    def test_incomplete_malformed_oversized_and_unavailable_reads_fail_closed(self):
        for value, code in (({'NextToken': PRIVATE}, 'AWS_INCOMPLETE_RESPONSE'),
                            ({'IsTruncated': True}, 'AWS_INCOMPLETE_RESPONSE'),
                            (b'[]', 'AWS_RESPONSE_REJECTED'), (b'not JSON ' + PRIVATE.encode(), 'AWS_RESPONSE_REJECTED'),
                            (b'x' * 131073, 'AWS_RESPONSE_LIMIT'),
                            (FileNotFoundError(PRIVATE), 'AWS_CLI_UNAVAILABLE'),
                            (subprocess.TimeoutExpired(PRIVATE, 10), 'AWS_READ_TIMEOUT'),
                            ((1, PRIVATE), 'AWS_READ_FAILED')):
            with self.subTest(code=code):
                inv = module.Inventory(self.folder, 'a' * 40, self.executor({'get-role': value}))
                self.assertIsNone(inv.read('failed', ['iam', 'get-role']))
                self.assertEqual(inv.report['reads'][0]['status'], 'UNKNOWN')
                self.assertEqual(inv.report['reads'][0]['code'], code)
                self.assertNotIn(PRIVATE, json.dumps(inv.report))

    def test_budget_stops_before_another_transport_call(self):
        inv = module.Inventory(self.folder, 'a' * 40, self.executor())
        inv.report['requests'] = 64
        self.assertIsNone(inv.read('bounded', ['iam', 'get-role']))
        self.assertEqual(self.calls, [])
        inv = module.Inventory(self.folder, 'a' * 40, self.executor(), clock=iter((0, 181)).__next__)
        self.assertIsNone(inv.read('expired', ['iam', 'get-role']))
        self.assertEqual(self.calls, [])

    def test_persistent_home_rejects_outside_symlink_or_loose_state_and_never_overwrites(self):
        home = self.folder / 'home'; home.mkdir(mode=0o700)
        state = module.persistent_dir(home / '.known-enough' / 'ops00', home)
        self.assertEqual(module.persistent_dir(state, home), state)
        module.private_write(state / 'saved.json', {'existing': PRIVATE})
        with self.assertRaises(FileExistsError):
            module.private_write(state / 'saved.json', {})
        self.assertIn(PRIVATE, (state / 'saved.json').read_text())
        outside = self.folder / 'outside'; outside.mkdir()
        (home / 'alias').symlink_to(outside, target_is_directory=True)
        for rejected in (outside / 'state', home / 'alias' / 'state', home / '..' / 'outside', home):
            with self.subTest(path=rejected), self.assertRaises(ValueError):
                module.persistent_dir(rejected, home)
        (home / 'loose').mkdir(mode=0o755)
        with self.assertRaises(ValueError):
            module.persistent_dir(home / 'loose' / 'state', home)


if __name__ == '__main__':
    unittest.main()
