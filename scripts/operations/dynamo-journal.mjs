const table = 'KnownEnoughOperationsJournal';
const arn = `arn:aws:dynamodb:us-east-1:092954139775:table/${table}`;
function key(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('OPS_JOURNAL_KEY_REJECTED');
  return { PK: { S: `PLAN#${hash}` }, SK: { S: 'JOURNAL' } };
}
function encode(hash, record) {
  const itemKey = key(hash);
  try {
    // Capture getters once and discard inherited serializers before checking the
    // revision and payload. Enumerable callable fields are not journal data.
    record = structuredClone(record);
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !Number.isSafeInteger(record.revision) || record.revision < 0
      || !record.journal || typeof record.journal !== 'object' || Array.isArray(record.journal)
      || record.journal.planHash !== hash) throw new Error();
    const payload = JSON.stringify(record.journal);
    if (Buffer.byteLength(payload) > 4096) throw new Error();
    return { ...itemKey, revision: { N: String(record.revision) }, journal: { S: payload } };
  } catch { throw new Error('OPS_JOURNAL_RECORD_REJECTED'); }
}
export function dynamoJournal(transport, resourceArn) {
  if (resourceArn !== arn || typeof transport !== 'function') throw new Error('OPS_JOURNAL_TARGET_REJECTED');
  async function put(item, condition, values) {
    try {
      await transport('PutItem', { TableName: table, Item: item, ConditionExpression: condition,
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
    async createIfAbsent(hash, record) { return put(encode(hash, record), 'attribute_not_exists(PK)'); },
    compareAndSwap(hash, expected, record) {
      if (!Number.isSafeInteger(expected) || expected < 0 || expected === Number.MAX_SAFE_INTEGER) throw new Error('OPS_JOURNAL_REVISION_REJECTED');
      const item = encode(hash, record);
      if (item.revision.N !== String(expected + 1)) throw new Error('OPS_JOURNAL_REVISION_REJECTED');
      return put(item, 'revision = :expected', { ':expected': { N: String(expected) } });
    }
  };
}
