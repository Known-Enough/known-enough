/** Exact runtime permissions; provisioning actions belong only to the operator profile. */
export function ke13bRuntimePolicy(tableArn: string, logGroupArn: string) {
  if (!/^arn:aws:dynamodb:[a-z]{2}-[a-z]+-\d:\d{12}:table\/[A-Za-z0-9_.-]{3,255}$/.test(tableArn)
    || !/^arn:aws:logs:[a-z]{2}-[a-z]+-\d:\d{12}:log-group:\/aws\/lambda\/[A-Za-z0-9_-]+$/.test(logGroupArn)
    || tableArn.split(':')[3] !== logGroupArn.split(':')[3]
    || tableArn.split(':')[4] !== logGroupArn.split(':')[4])
    throw new Error('Exact same-account, same-region staging table and log-group ARNs are required');
  return {
    Version: '2012-10-17', Statement: [
      { Sid: 'RoomTransactionsOnly', Effect: 'Allow',
        Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'], Resource: tableArn,
        Condition: {
          'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': ['TransactGetItems', 'TransactWriteItems'] },
          'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['ROOM#*'] },
          Null: { 'dynamodb:EnclosingOperation': 'false', 'dynamodb:LeadingKeys': 'false' },
        } },
      { Sid: 'ExactApiLogStreams', Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: `${logGroupArn}:*` },
    ],
  } as const;
}
