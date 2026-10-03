import { reserveTotal } from './cumulative.mjs';
import { URLSearchParams } from 'node:url';

export const APPROVAL_WORKFLOW = '.github/workflows/approve-live-qa-runs.yml';
export const APPROVER = { login: 'martelaxe', id: 44531296 };
const repositoryId = 1377587215;
const actors = new Set(['martelaxe', 'Battosai1806']);
const requestPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = code => { throw new Error(code); };
const utcDay = now => new Date(now).toISOString().slice(0, 10);

export function approvalInputs(inputs, now = Date.now()) {
    if (!inputs || Object.keys(inputs).sort().join() !== 'day,for_user,request_id,runs'
        || !/^(?:[1-9]|10)$/.test(inputs.runs) || !actors.has(inputs.for_user)
        || inputs.day !== utcDay(now) || !requestPattern.test(inputs.request_id ?? ''))
        fail('INVALID_RUN_APPROVAL');
    return { day: inputs.day, actor: inputs.for_user, runs: Number(inputs.runs), requestId: inputs.request_id };
}

export function approvalContext(context) {
    if (context.repository !== 'Known-Enough/known-enough' || String(context.repositoryId) !== String(repositoryId)
        || context.ref !== 'refs/heads/main' || context.event !== 'workflow_dispatch'
        || context.actor !== APPROVER.login || String(context.actorId) !== String(APPROVER.id)
        || context.triggeringActor !== APPROVER.login)
        fail('A_GITHUB_APPROVAL_REQUIRED');
}

export function approvalReceipt(run, now = Date.now()) {
    const match = /^QA allowance: ([1-9]|10) runs for (martelaxe|Battosai1806) on (\d{4}-\d{2}-\d{2}) \[([a-f0-9-]{36})\]$/.exec(run?.display_title ?? '');
    if (!match || run.actor?.login !== APPROVER.login || run.actor?.id !== APPROVER.id
        || run.triggering_actor?.login !== APPROVER.login || run.triggering_actor?.id !== APPROVER.id
        || run.repository?.id !== repositoryId || run.head_repository?.id !== repositoryId
        || run.head_branch !== 'main' || run.event !== 'workflow_dispatch'
        || run.path !== APPROVAL_WORKFLOW || run.status !== 'completed' || run.conclusion !== 'success'
        || !Number.isSafeInteger(run.id) || run.id <= 0 || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')
        || !Number.isFinite(Date.parse(run.created_at)) || Date.parse(run.created_at) > now
        || utcDay(Date.parse(run.created_at)) !== utcDay(now))
        fail('UNVERIFIED_GITHUB_APPROVAL');
    return approvalInputs({ runs: match[1], for_user: match[2], day: match[3], request_id: match[4] }, now);
}

export async function githubApprovals(now = Date.now(), fetcher = globalThis.fetch) {
    const query = new URLSearchParams({ event: 'workflow_dispatch', status: 'completed', branch: 'main', actor: APPROVER.login,
        created: utcDay(now), per_page: '100' });
    try {
        const response = await fetcher(`https://api.github.com/repos/Known-Enough/known-enough/actions/workflows/approve-live-qa-runs.yml/runs?${query}`, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'KnownEnough-QA-Allowance' },
            signal: globalThis.AbortSignal.timeout(10000), redirect: 'error'
        });
        if (!response.ok) fail('GITHUB_APPROVALS_UNAVAILABLE');
        const data = await response.json();
        if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 100
            || !Array.isArray(data.workflow_runs) || data.workflow_runs.length !== data.total_count)
            fail('GITHUB_APPROVAL_HISTORY_INCOMPLETE');
        return data.workflow_runs;
    } catch { fail('GITHUB_APPROVALS_UNAVAILABLE'); }
}

export async function githubAllowance(runs, authorization, authorizationVersion, daily, total, runId, testRun, now, read) {
    const match = /^gh-(\d+)-(\d+)$/.exec(runId);
    if (!match || String(testRun?.id) !== match[1] || String(testRun?.run_attempt) !== match[2]
        || !actors.has(testRun?.actor?.login) || testRun.triggering_actor?.login !== testRun.actor.login
        || testRun.repository?.id !== repositoryId || testRun.head_repository?.id !== repositoryId
        || testRun.head_branch !== 'main' || testRun.event !== 'workflow_run' || testRun.status !== 'in_progress'
        || testRun.path !== '.github/workflows/live-qa-release-and-check.yml'
        || !/^[a-f0-9]{40}$/.test(testRun.head_sha ?? '')) fail('EXTRA_RUN_ACTOR_UNVERIFIED');
    if (!authorization.approved || Date.parse(authorization.expiresAt) <= now
        || !Number.isSafeInteger(authorizationVersion) || authorizationVersion <= 0
        || !Number.isSafeInteger(daily.runs) || daily.runs < authorization.maxRunsPerDay
        || !Number.isSafeInteger(daily.messages) || daily.messages < 0
        || daily.messages + authorization.maxSignupMessagesPerRun > authorization.maxSignupMessagesPerDay)
        fail('EXTRA_RUN_BUDGET_BLOCKED');
    // Check full-run headroom; actual model/email reservations still occur at their existing boundaries.
    reserveTotal(total, authorization, { runs: 1, reservedTokens: authorization.maxTokensPerRun,
        reservedCostMicros: authorization.maxCostMicrosPerRun, messages: authorization.maxSignupMessagesPerRun });
    const receipts = new Map();
    for (const run of runs) {
        let receipt;
        try { receipt = approvalReceipt(run, now); } catch { continue; }
        const prior = receipts.get(receipt.requestId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(receipt)) fail('GITHUB_APPROVAL_REQUEST_DRIFT');
        receipts.set(receipt.requestId, receipt);
    }
    for (const receipt of receipts.values()) {
        if (receipt.actor !== testRun.actor.login) continue;
        const id = 'GITHUB-EXTRA#' + receipt.requestId;
        const prior = await read(id);
        const baseline = { schemaVersion: 1, ...receipt, authorizationVersion, authorizationExpiresAt: authorization.expiresAt };
        if (prior.value && (Object.keys(prior.value).sort().join() !== [...Object.keys(baseline), 'usedRuns'].sort().join()
            || Object.entries(baseline).some(([key, value]) => prior.value[key] !== value)
            || !Number.isSafeInteger(prior.value.usedRuns) || prior.value.usedRuns < 0 || prior.value.usedRuns > receipt.runs))
            fail('GITHUB_APPROVAL_USAGE_DRIFT');
        if ((!prior.value && prior.version !== 0) || (prior.value && (!Number.isSafeInteger(prior.version) || prior.version <= 0)))
            fail('GITHUB_APPROVAL_USAGE_DRIFT');
        const usedRuns = prior.value?.usedRuns ?? 0;
        if (usedRuns < receipt.runs) return { id, prior, next: { ...baseline, usedRuns: usedRuns + 1 } };
    }
    fail('NO_APPROVED_EXTRA_RUNS');
}
