import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySource } from './verify.mjs';
const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: sha, EXPECTED_SOURCE: sha, CHECKOUT_SOURCE: sha };
test('both standing-authorized operator IDs pass the same fixed source gates', () => {
  for (const GITHUB_ACTOR_ID of ['44531296', '143764700']) assert.equal(verifySource({ ...env, GITHUB_ACTOR_ID }), sha);
});
test('foreign or mistyped actors and source/repo/ref/event drift remain rejected for either operator', () => {
  for (const id of ['44531296', '143764700']) {
    for (const patch of [{ GITHUB_ACTOR_ID: '999999999' }, { GITHUB_ACTOR_ID: Number(id) },
      { GITHUB_ACTOR_ID: undefined }, { GITHUB_ACTOR_ID: `${id} ` }, { GITHUB_REPOSITORY: 'other/repo' },
      { GITHUB_REF: 'refs/heads/other' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_SHA: 'b'.repeat(40) },
      { EXPECTED_SOURCE: 'b'.repeat(40) }, { CHECKOUT_SOURCE: 'b'.repeat(40) }]) {
      assert.throws(() => verifySource({ ...env, GITHUB_ACTOR_ID: id, ...patch }), /^Error: OPS_SOURCE_REJECTED$/);
    }
  }
});
test('every operations dispatch keeps both operator IDs and fixed repository/main gates', () => {
  for (const name of ['verify', 'partition-readback', 'intake', 'scope', 'recovery']) {
    const source = readFileSync(`.github/workflows/operations-${name}.yml`, 'utf8');
    assert.ok(source.includes("(github.actor_id == '143764700' || github.actor_id == '44531296')"));
    assert.ok(source.includes("github.repository == 'Known-Enough/known-enough'"));
    assert.ok(source.includes("github.ref == 'refs/heads/main'"));
    assert.ok(source.includes('workflow_dispatch:'));
  }
});
