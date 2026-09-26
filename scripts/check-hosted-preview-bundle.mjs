import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist-hosted-preview');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(filename));
    else files.push(filename);
  }
  return files;
}

const files = await filesUnder(root);
assert.ok(files.some(file => path.relative(root, file) === path.join('hosted-preview', 'index.html')), 'hosted build must have the hosted-preview entry page');
assert.ok(files.some(file => file.endsWith('.js')), 'hosted build must contain its app bundle');
assert.ok(files.every(file => !/owner-screen|local-api-client|owner-mock-adapter/i.test(path.basename(file))), 'hosted build must not emit owner or local API chunks');

const output = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
for (const forbidden of [
  'NON_PRODUCTION',
  'X-Deal-Table-Test-Identity',
  'http://127.0.0.1:8787',
  'OwnerScreen',
  'Open private owner demo',
]) {
  assert.ok(!output.includes(forbidden), `hosted build must not contain ${forbidden}`);
}
assert.ok(output.includes('Hosted mock preview — simulated data, no shared state'), 'hosted build must clearly identify the static mock and lack of shared state');
console.log(`Hosted preview bundle boundary passed (${files.length} output files).`);
