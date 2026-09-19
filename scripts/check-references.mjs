import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync('docs/reference/import-checksums.json', 'utf8'));
for (const { path, sha256 } of manifest) {
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) throw new Error(`Reference changed: ${path}`);
}
console.log(`${manifest.length} imported reference checksums match.`);
