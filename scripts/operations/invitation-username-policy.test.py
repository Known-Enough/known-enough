import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).with_name('invitation-username-policy.py')
spec = importlib.util.spec_from_file_location('invitation_username_policy', PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    read = {'Sid': 'ScopedPartitionRead', 'Effect': 'Allow',
            'Action': ['dynamodb:GetItem', 'dynamodb:BatchGetItem'], 'Resource': module.TABLE,
            'Condition': {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': list(module.EXPECTED_KEYS)},
                          'Null': {'dynamodb:LeadingKeys': 'false'}}}
    write = {'Sid': 'ScopedPartitionCommit', 'Effect': 'Allow',
             'Action': ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem'], 'Resource': module.TABLE,
             'Condition': {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': list(module.EXPECTED_KEYS)},
                           'ForAnyValue:StringEquals': {'dynamodb:EnclosingOperation': ['TransactWriteItems']},
                           'Null': {'dynamodb:LeadingKeys': 'false'},
                           'StringEqualsIfExists': {'dynamodb:ReturnValues': 'NONE'}}}
    return {'Version': '2012-10-17', 'Statement': [read, write, {'Sid': 'Unrelated', 'Effect': 'Deny'}]}


class UsernamePolicyRepairTests(unittest.TestCase):
    def test_changes_only_the_two_existing_scoped_key_lists(self):
        prior = fixture()
        updated = module.candidate(prior)
        self.assertNotIn('USERNAME#*', prior['Statement'][0]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'])
        self.assertEqual(updated['Statement'][0]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'][-1], 'USERNAME#*')
        self.assertEqual(updated['Statement'][1]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'][-1], 'USERNAME#*')
        updated['Statement'][0]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'].pop()
        updated['Statement'][1]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'].pop()
        self.assertEqual(updated, prior)

    def test_refuses_policy_drift_and_missing_transaction_fence(self):
        policy = fixture(); policy['Statement'][0]['Resource'] = '*'
        with self.assertRaisesRegex(ValueError, 'PARTICIPANT_POLICY_TARGET_DRIFT'):
            module.candidate(policy)
        policy = fixture(); policy['Statement'][1]['Condition']['ForAnyValue:StringEquals']['dynamodb:EnclosingOperation'] = ['PutItem']
        with self.assertRaisesRegex(ValueError, 'PARTICIPANT_POLICY_TRANSACTION_FENCE_INVALID'):
            module.candidate(policy)


if __name__ == '__main__':
    unittest.main()
