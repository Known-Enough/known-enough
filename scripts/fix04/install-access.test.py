import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('repair',pathlib.Path(__file__).with_name('install-access.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROOT=pathlib.Path(__file__).parents[2]
INLINE=json.loads((ROOT/'infra/operations/access-profiles.json').read_text())['migration'];BOUNDARY=json.loads((ROOT/'infra/operations/access-setup.json').read_text())['Resources']['MigrationBoundary']['Properties']['PolicyDocument']
INLINE['Statement']=[item for item in INLINE['Statement'] if not item.get('Sid','').startswith('FIX04')]
BOUNDARY['Statement']=[item for item in BOUNDARY['Statement'] if not item.get('Sid','').startswith('FIX04')]
class RepairTests(unittest.TestCase):
 def fixture(self,wrong=False,shared=False):
  state={'inline':None,'boundary':BOUNDARY,'version':'v1','writes':[]}
  def invoke(service,operation,*args):
   values={args[index]:args[index+1] for index in range(0,len(args)-1,2)}
   if operation=='get-caller-identity':return {'Account':'other' if wrong else module.ACCOUNT}
   if operation=='get-role':return {'Role':{'Arn':f'arn:aws:iam::{module.ACCOUNT}:role/{module.ROLE}','PermissionsBoundary':{'PermissionsBoundaryArn':module.BOUNDARY}}}
   if operation=='get-role-policy':
    if values['--policy-name']=='ScopedOperations':return {'PolicyDocument':INLINE}
    if state['inline'] is None:raise module.RepairError('iam:get-role-policy/NoSuchEntity')
    return {'PolicyDocument':state['inline']}
   if operation=='get-policy':return {'Policy':{'DefaultVersionId':state['version']}}
   if operation=='get-policy-version':return {'PolicyVersion':{'Document':state['boundary']}}
   if operation=='list-entities-for-policy':return {'PolicyRoles':[{'RoleName':module.ROLE}]+([{'RoleName':'other'}] if shared else [])}
   if operation=='list-policy-versions':return {'Versions':[{'VersionId':state['version'],'IsDefaultVersion':True}]}
   if operation=='create-policy-version':state['boundary']=json.loads(values['--policy-document']);state['version']='v2';state['writes'].append(operation);return {}
   if operation=='put-role-policy':state['inline']=json.loads(values['--policy-document']);state['writes'].append(operation);return {}
   raise AssertionError(operation)
  return state,invoke
 def test_preview_zero_writes_and_bounded_read_actions(self):
  state,invoke=self.fixture();report=module.repair(invoke);self.assertEqual(report['iamWrites'],0);self.assertEqual(state['writes'],[]);self.assertEqual(module.READS['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes'],['PK','SK']);self.assertNotIn('bedrock',json.dumps(module.READS));self.assertNotIn('AdminUpdateUser',json.dumps(module.READS))
 def test_additive_both_layers_preserve_original_and_second_apply_is_noop(self):
  state,invoke=self.fixture();report=module.repair(invoke,True);self.assertEqual(report['iamWrites'],2);self.assertEqual(state['boundary']['Statement'][:len(BOUNDARY['Statement'])],BOUNDARY['Statement']);self.assertEqual(module.repair(invoke,True)['iamWrites'],0)
 def test_wrong_target_and_shared_boundary_zero_writes(self):
  for wrong,shared in [(True,False),(False,True)]:
   state,invoke=self.fixture(wrong,shared)
   with self.assertRaises(module.RepairError):module.repair(invoke,True)
   self.assertEqual(state['writes'],[])
 def test_changed_boundary_or_existing_amendment_rejected(self):
  changed=json.loads(json.dumps(BOUNDARY));changed['Statement'][0]['Resource']='*'
  with self.assertRaisesRegex(module.RepairError,'BOUNDARY_SOURCE_CHANGED'):module.desired_boundary(changed)
  changed=module.desired_boundary(BOUNDARY);changed['Statement'][-1]['Resource']='*'
  with self.assertRaisesRegex(module.RepairError,'FIX04_BOUNDARY_STATEMENTS_CHANGED'):module.desired_boundary(changed)
 def test_full_version_inventory_requires_backup_and_preserves_default_before_one_slot_delete(self):
  state,base=self.fixture();deleted=[]
  def invoke(service,operation,*args):
   if operation=='list-policy-versions':return {'Versions':[{'VersionId':'v1','IsDefaultVersion':True,'CreateDate':'2026-01-05'}]+[{'VersionId':'v'+str(i),'IsDefaultVersion':False,'CreateDate':'2026-01-0'+str(i)} for i in range(2,6)]}
   if operation=='delete-policy-version':
    self.assertNotEqual(args[-1],'v1');deleted.append(args[-1]);return {}
   return base(service,operation,*args)
  with self.assertRaisesRegex(module.RepairError,'PRIVATE_BACKUP_REQUIRED_FOR_VERSION_SLOT'):module.repair(invoke,True)
  self.assertEqual(deleted,[]);self.assertEqual(state['writes'],[])
  with tempfile.TemporaryDirectory() as path:
   report=module.repair(invoke,True,pathlib.Path(path));self.assertEqual(report['iamWrites'],3);self.assertEqual(len(deleted),1);self.assertTrue((pathlib.Path(path)/'boundary-v2.json').exists());self.assertTrue((pathlib.Path(path)/'execution.json').exists())
 def test_unknown_write_ack_is_recorded_and_not_automatically_retried(self):
  state,base=self.fixture();attempts=[]
  def invoke(service,operation,*args):
   if operation=='create-policy-version':attempts.append(operation);raise module.RepairError('iam:create-policy-version/AWS_OPERATION_UNAVAILABLE')
   return base(service,operation,*args)
  with tempfile.TemporaryDirectory() as path:
   with self.assertRaises(module.RepairError):module.repair(invoke,True,pathlib.Path(path))
   record=json.loads((pathlib.Path(path)/'execution.json').read_text());self.assertEqual(record['iamWritesConfirmed'],0);self.assertEqual(record['attempts'],[{'operation':'iam:create-policy-version','result':'ACK_UNKNOWN'}]);self.assertEqual(attempts,['create-policy-version'])
if __name__=='__main__':unittest.main()
