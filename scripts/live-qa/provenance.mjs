import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function trustedSource(event, name, context) {
    if (context.repository !== 'Known-Enough/known-enough' || context.ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(context.sha))
        throw new Error('TRUSTED_MAIN_REQUIRED');
    if (name === 'workflow_dispatch')
        return context.sha;
    const run = event.workflow_run;
    if (name !== 'workflow_run' || run?.name !== 'Deploy Known Enough staging to AWS Amplify' || run.conclusion !== 'success' || run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) || run.repository?.id !== 1377587215 || run.head_repository?.id !== 1377587215 || run.repository?.full_name !== context.repository || run.head_repository?.full_name !== context.repository || run.head_sha !== context.sha || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.workflow_id))
        throw new Error('UPSTREAM_UNTRUSTED_OR_SUPERSEDED');
    return run.head_sha;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        const sha = trustedSource(event, process.env.GITHUB_EVENT_NAME, { repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA });
        const latest = spawnSync('gh', ['api', 'repos/Known-Enough/known-enough/git/ref/heads/main', '--jq', '.object.sha'], { encoding: 'utf8', timeout: 15000 });
        if (latest.status || latest.stdout.trim() !== sha)
            throw new Error('MAIN_SOURCE_SUPERSEDED');
        if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
            const r = spawnSync('gh', ['api', `repos/Known-Enough/known-enough/actions/workflows/${event.workflow_run.workflow_id}`], { encoding: 'utf8', timeout: 15000 });
            if (r.status || JSON.parse(r.stdout).path !== '.github/workflows/deploy-amplify-staging.yml')
                throw new Error('UPSTREAM_WORKFLOW_ID_MISMATCH');
        }
        appendFileSync(process.env.GITHUB_OUTPUT, `source=${sha}\n`);
    }
    catch {
        console.error('LIVE_PROVENANCE_BLOCKED');
        process.exitCode = 1;
    }
}
