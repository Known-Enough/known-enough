/** Only fixed native metadata and trusted identity reads; no provider/account mutation. */
export function operatorReadPolicy(){const account='092954139775',region='us-east-1';return {Version:'2012-10-17',Statement:[
 {Sid:'FIX04KeyOnlyAccountCatalog',Effect:'Allow',Action:['dynamodb:Scan'],Resource:`arn:aws:dynamodb:${region}:${account}:table/KnownEnoughPartitions`,Condition:{StringEquals:{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'},'ForAllValues:StringEquals':{'dynamodb:Attributes':['PK','SK']},Null:{'dynamodb:Attributes':'false'}}},
 {Sid:'FIX04TrustedProviderIdentity',Effect:'Allow',Action:['cognito-idp:AdminGetUser','cognito-idp:ListUsers'],Resource:`arn:aws:cognito-idp:${region}:${account}:userpool/us-east-1_V9OMjd0zx`},
 {Sid:'FIX04PinnedSourceRead',Effect:'Allow',Action:['lambda:GetFunction'],Resource:`arn:aws:lambda:${region}:${account}:function:known-enough-stage-api`}
]};}
