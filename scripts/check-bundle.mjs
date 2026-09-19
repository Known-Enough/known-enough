import { readFileSync, readdirSync } from 'node:fs';
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
const forbidden = ['SERVER_ONLY_SYNTHETIC_7f693b', 'condition-synthetic', 'offer-synthetic', 'preview-synthetic', 'grant-synthetic', 'owner-private-review.json', 'test-support/fixtures'];
for (const file of files('apps/web/dist')) {
  const text = readFileSync(file, 'utf8');
  for (const marker of forbidden) if (text.includes(marker)) throw new Error(`Server fixture marker in ${file}: ${marker}`);
}
console.log('Built browser assets contain no seeded server-private fixture markers. This is not a proof of privacy.');
