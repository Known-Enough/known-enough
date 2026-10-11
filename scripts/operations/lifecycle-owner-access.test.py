import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('owner_repair', Path(__file__).with_name('lifecycle-owner-access.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
DESIRED = json.loads((r.ROOT / 'infra/operations/access-setup.json').read_text())
ORIGINAL = copy.deepcopy(DESIRED)
ORIGINAL['Resources'][r.RESOURCE]['Properties']['PolicyDocument']['Statement'] = [row for row in ORIGINAL['Resources'][r.RESOURCE]['Properties']['PolicyDocument']['Statement'] if row.get('Sid') != r.SID]
SOURCE = 'a' * 40


class RepairTests(unittest.TestCase):
    def setUp(self):
        self.package = tempfile.TemporaryDirectory()
        self.addCleanup(self.package.cleanup)
        root = Path(self.package.name)
        (root / 'infra/operations').mkdir(parents=True)
        (root / 'infra/operations/access-setup.json').write_text(json.dumps(DESIRED))
        context = patch.object(r, 'ROOT', root)
        context.start()
        self.addCleanup(context.stop)

    def test_exact_patch_adds_only_plan_and_progress_reads_to_owner_runtime(self):
        updated = r.patched_template(ORIGINAL)
        self.assertEqual(updated, DESIRED)
        changed = [name for name in ORIGINAL['Resources'] if ORIGINAL['Resources'][name] != updated['Resources'][name]]
        self.assertEqual(changed, [r.RESOURCE])
        added = next(row for row in updated['Resources'][r.RESOURCE]['Properties']['PolicyDocument']['Statement'] if row.get('Sid') == r.SID)
        self.assertEqual(added['Action'], ['dynamodb:GetItem'])
        self.assertEqual(added['Resource'], r.TABLE)
        self.assertEqual(added['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['LIFECYCLE#*'])

    def test_unrelated_role_or_policy_drift_stops_before_patch(self):
        for resource in ['MigrationRole', r.RESOURCE, 'ArchiveBoundary']:
            changed = copy.deepcopy(ORIGINAL)
            changed['Resources'][resource]['DeletionPolicy'] = 'Delete'
            with self.assertRaises(r.RepairError):
                r.patched_template(changed)

    def scenario(self, home, lost=None, wrong_preview=False):
        state = {'executed': False, 'created': False, 'calls': [], 'lossUsed': False}
        path = home / '.known-enough' / ('ops02-owner-access-' + SOURCE) / 'state-private.json'
        def git(args, **kwargs):
            return SOURCE + '\n' if args[1] == 'rev-parse' else ('https://github.com/Known-Enough/known-enough.git\n' if args[1] == 'remote' else '')
        def aws(service, operation, *args):
            state['calls'].append((service, operation))
            if operation == 'get-caller-identity':
                return {'Account': '092954139775', 'Arn': 'arn:aws:iam::092954139775:root'}
            if operation == 'describe-stacks':
                return {'Stacks': [{'StackId': 'arn:aws:cloudformation:us-east-1:092954139775:stack/' + r.STACK + '/owned',
                                    'StackStatus': 'UPDATE_COMPLETE' if state['executed'] else 'CREATE_COMPLETE'}]}
            if operation == 'get-role':
                return {'Role': {'Arn': 'arn:aws:iam::092954139775:role/' + r.ROLE, 'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': []}}}
            if operation == 'get-template':
                return {'TemplateBody': DESIRED if '--change-set-name' in args or state['executed'] else ORIGINAL}
            if operation == 'create-change-set':
                self.assertEqual(json.loads(path.read_text())['phase'], 'PREVIEW_INTENT')
                state['created'] = True
            elif operation == 'describe-change-set':
                self.assertTrue(state['created'])
                return {'Status': 'CREATE_COMPLETE', 'Changes': [{'ResourceChange': {'LogicalResourceId': 'ArchiveBoundary' if wrong_preview else r.RESOURCE, 'Action': 'Modify', 'Replacement': 'False'}}]}
            elif operation == 'execute-change-set':
                self.assertEqual(json.loads(path.read_text())['phase'], 'EXECUTE_INTENT')
                state['executed'] = True
            elif operation == 'get-role-policy':
                return {'PolicyDocument': (DESIRED if state['executed'] else ORIGINAL)['Resources'][r.RESOURCE]['Properties']['PolicyDocument']}
            else:
                self.fail(operation)
            if operation == lost and not state['lossUsed']:
                state['lossUsed'] = True
                raise r.RepairError('LOST_ACKNOWLEDGEMENT')
            return {}
        return state, git, aws

    def test_normal_update_and_repeat_readback_never_duplicate_submission(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            state, git, aws = self.scenario(home)
            with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r, 'aws', side_effect=aws):
                self.assertEqual(r.run(SOURCE, True)['result'], 'LIFECYCLE_OWNER_READ_POLICY_PASS')
                self.assertEqual(r.run(SOURCE, True)['result'], 'LIFECYCLE_OWNER_READ_POLICY_PASS')
            self.assertEqual(state['calls'].count(('cloudformation', 'create-change-set')), 1)
            self.assertEqual(state['calls'].count(('cloudformation', 'execute-change-set')), 1)

    def test_lost_create_and_execute_ack_resume_by_readback_without_repeated_write(self):
        for lost in ['create-change-set', 'execute-change-set']:
            with self.subTest(lost=lost), tempfile.TemporaryDirectory() as folder:
                home = Path(folder)
                state, git, aws = self.scenario(home, lost=lost)
                with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r, 'aws', side_effect=aws):
                    with self.assertRaises(r.RepairError):
                        r.run(SOURCE, True)
                    self.assertEqual(r.run(SOURCE, True)['result'], 'LIFECYCLE_OWNER_READ_POLICY_PASS')
                self.assertEqual(state['calls'].count(('cloudformation', 'create-change-set')), 1)
                self.assertEqual(state['calls'].count(('cloudformation', 'execute-change-set')), 1)

    def test_unexpected_cloudformation_change_does_not_execute(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            state, git, aws = self.scenario(home, wrong_preview=True)
            with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r, 'aws', side_effect=aws):
                with self.assertRaisesRegex(r.RepairError, 'PREVIEW_SCOPE_CHANGED'):
                    r.run(SOURCE, True)
            self.assertFalse(state['executed'])

    def test_manual_effective_policy_drift_prevents_any_preview_write(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            state, git, actual = self.scenario(home)
            def drift(service, operation, *args):
                result = actual(service, operation, *args)
                if operation == 'get-role-policy':
                    result = copy.deepcopy(result)
                    result['PolicyDocument']['Statement'].append({'Effect': 'Allow', 'Action': ['iam:*'], 'Resource': '*'})
                return result
            with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r, 'aws', side_effect=drift):
                with self.assertRaisesRegex(r.RepairError, 'INSTALLED_POLICY_CHANGED'):
                    r.run(SOURCE, True)
            self.assertFalse(state['created'])

    def test_foreign_or_non_setup_login_stops_before_any_stack_or_iam_action(self):
        for identity in [{'Account': '999999999999', 'Arn': 'arn:aws:iam::999999999999:root'},
                         {'Account': '092954139775', 'Arn': 'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubLifecycleExecutor/session'}]:
            with tempfile.TemporaryDirectory() as folder:
                home = Path(folder)
                state, git, actual = self.scenario(home)
                calls = []
                def wrong(service, operation, *args):
                    calls.append(operation)
                    return identity
                with patch.object(Path, 'home', return_value=home), patch.object(r.subprocess, 'check_output', side_effect=git), patch.object(r, 'aws', side_effect=wrong):
                    with self.assertRaisesRegex(r.RepairError, 'OWN_SETUP_IDENTITY_REQUIRED'):
                        r.run(SOURCE, True)
                self.assertEqual(calls, ['get-caller-identity'])


if __name__ == '__main__':
    unittest.main()
