import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifestPath = 'docs/reference/import-checksums.json';
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const { path, sha256 } of manifest) {
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) throw new Error(`Reference changed: ${path}`);
  }
  console.log(`${manifest.length} imported reference checksums match.`);
} else {
  console.log('SKIPPED imported-document checksums: documentation is maintained on the development branch.');
}
