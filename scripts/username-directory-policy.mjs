const TABLE = 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions';
const stringList = value => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

/** Report only whether installed IAM statements preserve the source-bound USERNAME partition fence. */
export function usernameDirectoryPermissions(documents) {
  const statements = documents.flatMap(document => {
    const policy = typeof document === 'string' ? JSON.parse(document) : document;
    return Array.isArray(policy?.Statement) ? policy.Statement : [policy?.Statement];
  }).filter(Boolean);
  const matches = (action, transactional) => statements.some(statement => {
    if (statement.Effect !== 'Allow' || !stringList(statement.Action).some(item => item.toLowerCase() === `dynamodb:${action}`.toLowerCase())
      || !stringList(statement.Resource).includes(TABLE)) return false;
    const keys = statement.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys'];
    if (!stringList(keys).includes('USERNAME#*')) return false;
    if (!transactional) return true;
    return stringList(statement.Condition?.['ForAnyValue:StringEquals']?.['dynamodb:EnclosingOperation'])
      .includes('TransactWriteItems');
  });
  return { read: matches('GetItem', false), transactionalWrite: matches('PutItem', true) };
}
