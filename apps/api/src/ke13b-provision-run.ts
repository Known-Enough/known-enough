import { readFile } from 'node:fs/promises';
import { createAwsDynamoDBRoomRepository } from '@deal-table/adapters';
import { KnownEnoughApplication } from '@deal-table/application';
import { readKe13bConfig } from './ke13b-lambda.ts';
import { provisionStageDecision } from './ke13b-provision.ts';

const config = readKe13bConfig();
const path = process.env.KE13B_BOOTSTRAP_FILE;
if (!path || !path.startsWith('/') || path.includes('\0')) throw new Error('KE13B_BOOTSTRAP_FILE must be an absolute path');
const subjects: unknown = JSON.parse(await readFile(path, 'utf8'));
const application = new KnownEnoughApplication({
  repository: createAwsDynamoDBRoomRepository(config.tableName, config.region),
  clock: { now: () => new Date().toISOString() }, ids: { next: () => crypto.randomUUID() },
});
await provisionStageDecision(application, subjects);
console.log('Synthetic staging decision created with five trusted subject bindings.');
