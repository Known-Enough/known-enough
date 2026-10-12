import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('jobs-consent-permission-probe.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ProbeTests(unittest.TestCase):
    def test_both_transactions_are_impossible_on_exact_own_room(self):
        probe = '11111111-1111-4111-9111-111111111111'
        for corrected in [False, True]:
            items = m.transaction(probe, corrected)
            self.assertEqual(len(items), 2)
            for item in items:
                write = next(iter(item.values()))
                self.assertEqual(write['TableName'], m.TABLE)
                self.assertEqual(write['ConditionExpression'], 'attribute_exists(#pk) AND attribute_not_exists(#pk)')
                self.assertEqual(write['ExpressionAttributeNames']['#pk'], 'PK')
                self.assertEqual(write.get('Item', write.get('Key'))['PK']['S'], 'ROOM#' + probe)
            self.assertIn('Put' if corrected else 'Update', items[1])
    def test_arbitrary_selector_cannot_be_used(self):
        with self.assertRaises(ValueError): m.transaction('private-selector', True)
    def test_only_exact_denied_action_and_finite_codes_are_retained(self):
        value = m.outcome('An error occurred (AccessDeniedException): private-marker not authorized to perform: dynamodb:UpdateItem on private-resource')
        self.assertEqual(value['deniedAction'], 'dynamodb:UpdateItem')
        self.assertNotIn('private', str(value))
        self.assertEqual(m.outcome('raw secret')['code'], 'AWS_PROBE_FAILED')
    def test_accepted_iam_but_cancelled_conditions_are_distinct_from_success(self):
        value = m.outcome('An error occurred (TransactionCanceledException): [ConditionalCheckFailed, ConditionalCheckFailed]')
        self.assertEqual(value['conditionalFailures'], 2)
        self.assertEqual(value['code'], 'TransactionCanceledException')

if __name__ == '__main__': unittest.main()
