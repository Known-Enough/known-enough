import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('journal', Path(__file__).with_name('jobs-journal-access.py'))
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class JournalTests(unittest.TestCase):
    def identity(self, role=m.ROLE):
        return {'Account':m.ACCOUNT,'Arn':f'arn:aws:sts::{m.ACCOUNT}:assumed-role/{role}/test'}
    def test_condition_is_logically_impossible_on_every_record(self):
        a=m.impossible_delete();b=m.impossible_delete()
        self.assertEqual(len(a),1);self.assertEqual(a[0]['Delete']['TableName'],m.TABLE)
        self.assertEqual(a[0]['Delete']['ConditionExpression'],'attribute_exists(PK) AND attribute_not_exists(PK)')
        self.assertTrue(a[0]['Delete']['Key']['PK']['S'].startswith('MODELJOB#'))
        self.assertNotEqual(a[0]['Delete']['Key'],b[0]['Delete']['Key'])
    def test_denied_delete_keeps_exact_action_without_raw_aws_details(self):
        calls=[]
        def aws(*args):
            calls.append(args[:2])
            if args[:2]==('sts','get-caller-identity'):return self.identity()
            raise RuntimeError('AccessDeniedException')
        result=m.execute(aws,'probe')
        self.assertEqual(result['operation'],'dynamodb:DeleteItem');self.assertEqual(result['code'],'AccessDeniedException')
        self.assertEqual(result['mutations'],0);self.assertEqual(len(calls),2)
    def test_condition_specific_cancellation_is_required_for_an_allowed_probe(self):
        for conditional in [False,True]:
            def aws(*args):
                if args[:2]==('sts','get-caller-identity'):return self.identity()
                error=RuntimeError('TransactionCanceledException');error.conditional_only=conditional;raise error
            result=m.execute(aws,'probe')
            self.assertEqual(result['result'],'JOURNAL_DELETE_ALLOWED_CONDITION_REJECTED' if conditional else 'JOURNAL_ACCESS_UNVERIFIED')
    def test_matching_policy_without_delete_cannot_be_configuration_pass_for_cleanup(self):
        doc={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':m.TABLE_ARN}]}
        result=m.summary_policies(doc,doc,{'inline':doc,'boundary':doc})
        self.assertTrue(result['inlineMatchesCheckedSource']);self.assertFalse(result['inlineScopedDeleteDeclared'])
        self.assertFalse(result['boundaryScopedDeleteDeclared'])
    def test_matching_source_hash_is_not_effective_delete_proof(self):
        doc={'Statement':[{'Effect':'Allow','Action':['dynamodb:DeleteItem'],'Resource':m.TABLE_ARN,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['MODELJOB#*']}}}]}
        result=m.summary_policies(doc,doc,{'inline':doc,'boundary':doc})
        self.assertTrue(result['inlineScopedDeleteDeclared']);self.assertTrue(result['boundaryScopedDeleteDeclared'])
    def test_wrong_role_stops_before_probe(self):
        calls=[]
        def aws(*args):calls.append(args);return self.identity('WrongRole')
        result=m.execute(aws,'probe');self.assertEqual(result['code'],'JOURNAL_ROLE_INVALID');self.assertEqual(len(calls),1)
    def test_impossible_condition_success_or_unclassified_failure_never_passes(self):
        for error in [None,RuntimeError('private error body')]:
            def aws(*args):
                if args[:2]==('sts','get-caller-identity'):return self.identity()
                if error:raise error
                return {}
            result=m.execute(aws,'probe');self.assertEqual(result['result'],'JOURNAL_ACCESS_UNVERIFIED')
            self.assertNotIn('private error',str(result))
if __name__=='__main__':unittest.main()
