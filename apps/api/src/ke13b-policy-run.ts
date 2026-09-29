import { ke13bRuntimePolicy } from './ke13b-policy.ts';
const tableArn = process.env.KE13B_TABLE_ARN ?? '';
const logGroupArn = process.env.KE13B_LOG_GROUP_ARN ?? '';
process.stdout.write(`${JSON.stringify(ke13bRuntimePolicy(tableArn, logGroupArn), null, 2)}\n`);
