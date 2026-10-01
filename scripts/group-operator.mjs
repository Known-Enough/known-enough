// Run only on A's configured host; never load credentials into chat or the participant API.
import { createDynamoGroupRepository } from '../packages/adapters/src/group-repository.ts';
import { operateAccount } from '../apps/api/src/group-operator.ts';
const [action, subject, version, confirmation] = process.argv.slice(2);
if (!['list', 'approve', 'reject', 'disable'].includes(action)
  || (action !== 'list' && (!subject || !Number.isSafeInteger(Number(version)) || confirmation !== '--confirm')))
  throw new Error('Usage: node --experimental-transform-types scripts/group-operator.mjs list | approve|reject|disable SUBJECT VERSION --confirm');
const table = process.env.NP_GROUP_TABLE_NAME;
const region = process.env.AWS_REGION;
if (!table || !region) throw new Error('NP_GROUP_TABLE_NAME and AWS_REGION required; use A-only scoped operator credentials');
try { console.log(JSON.stringify(await operateAccount(createDynamoGroupRepository(table, region), action, subject, Number(version)))); }
catch { console.error('Operation failed. Inspect account state and scoped operator credentials before retrying.'); process.exitCode = 1; }
