import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryPublicationMode } from './primary-publication-mode.mjs';
test('both inactive and active native migration prevent legacy QA publication', () => {
  assert.equal(primaryPublicationMode(undefined), 'LEGACY');
  const c = { schemaVersion: 1, account: '092954139775', region: 'us-east-1', table: 'KnownEnoughPartitions', revision: 1, active: true, planHash: 'a'.repeat(64) };
  const wire = value => ({ PK: { S: 'MIGRATION#CONTROL' }, SK: { S: 'STATE' }, revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } });
  assert.equal(primaryPublicationMode(wire(c)), 'OPERATIONS');
  assert.equal(primaryPublicationMode(wire({ ...c, active: false })), 'OPERATIONS');
  for (const value of [null, {}, { ...wire(c), revision: { N: '2' } }, wire({ ...c, account: 'OTHER' }), wire({ ...c, extra: true })]) assert.throws(() => primaryPublicationMode(value));
});
