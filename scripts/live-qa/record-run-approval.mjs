import { readFileSync, appendFileSync } from 'node:fs';
import { approvalInputs, approvalContext } from './github-allowance.mjs';

try {
    approvalContext({ repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID,
        ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, actor: process.env.GITHUB_ACTOR,
        actorId: process.env.GITHUB_ACTOR_ID, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR });
    const receipt = approvalInputs(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Approved ${receipt.runs} extra runs for ${receipt.actor} on UTC ${receipt.day}.\n\nRequest: ${receipt.requestId}. Reuse this ID for retries.\n\nExpires at UTC midnight. Existing authorization, cost, model, email and cleanup limits still apply. This workflow does not deploy or start a test.\n`);
    console.log(JSON.stringify({ status: 'GITHUB_RUN_ALLOWANCE_RECORDED', ...receipt, cloudWrites: false }));
} catch {
    console.error(JSON.stringify({ status: 'BLOCKED', code: 'A_GITHUB_RUN_APPROVAL_REQUIRED' }));
    process.exitCode = 1;
}
