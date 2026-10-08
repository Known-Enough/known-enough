const table = 'KnownEnoughOperationsJournal';
const arn = `arn:aws:dynamodb:us-east-1:092954139775:table/${table}`;
function key(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('OPS_JOURNAL_KEY_REJECTED');
  return { PK: { S: `PLAN#${hash}` }, SK: { S: 'JOURNAL' } };
}
function encode(hash, record) {
  if (!Number.isSafeInteger(record?.revision) || record.revision < 0 || !record.journal
    || record.journal.planHash !== hash) throw new Error('OPS_JOURNAL_RECORD_REJECTED');
  const payload = JSON.stringify(record.journal);
  if (Buffer.byteLength(payload) > 4096) throw new Error('OPS_JOURNAL_RECORD_REJECTED');
  return { ...key(hash), revision: { N: String(record.revision) }, journal: { S: payload } };
}
export function dynamoJournal(transport, resourceArn) {
  if (resourceArn !== arn || typeof transport !== 'function') throw new Error('OPS_JOURNAL_TARGET_REJECTED');
  async function put(hash, record, condition, values) {
    try {
      await transport('PutItem', { TableName: table, Item: encode(hash, record), ConditionExpression: condition,
        ...(values ? { ExpressionAttributeValues: values } : {}) });
      return true;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false;
      throw new Error('OPS_JOURNAL_STORAGE_FAILED', { cause: error });
    }
  }
  return {
    async read(hash) {
      let response;
      try { response = await transport('GetItem', { TableName: table, Key: key(hash), ConsistentRead: true }); }
      catch { throw new Error('OPS_JOURNAL_STORAGE_FAILED'); }
      try {
        if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error();
        if (response.Item === undefined) return null;
        const item = response.Item;
        if (Object.keys(item).sort().join(',') !== 'PK,SK,journal,revision' || item.PK.S !== `PLAN#${hash}` || item.SK.S !== 'JOURNAL'
          || typeof item.revision.N !== 'string' || !/^(0|[1-9][0-9]*)$/.test(item.revision.N)
          || typeof item.journal.S !== 'string' || Buffer.byteLength(item.journal.S) > 4096) throw new Error();
        const record = { revision: Number(item.revision.N), journal: JSON.parse(item.journal.S) };
        encode(hash, record); return record;
      } catch { throw new Error('OPS_JOURNAL_RECORD_REJECTED'); }
    },
    createIfAbsent(hash, record) { return put(hash, record, 'attribute_not_exists(PK)'); },
    compareAndSwap(hash, expected, record) {
      if (!Number.isSafeInteger(expected) || expected < 0 || expected === Number.MAX_SAFE_INTEGER || record?.revision !== expected + 1) throw new Error('OPS_JOURNAL_REVISION_REJECTED');
      return put(hash, record, 'revision = :expected', { ':expected': { N: String(expected) } });
    }
  };
}
