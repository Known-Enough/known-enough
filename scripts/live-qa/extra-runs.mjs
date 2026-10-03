// Administrator approval is separate from the unchanged daily and cumulative grant.
export const EXTRA_DAY = '2026-10-03';
export const EXTRA_ACTORS = new Set(['Battosai1806', 'martelaxe']);
export async function githubRun(runId, fetcher = globalThis.fetch) {
    const match = /^gh-(\d+)-(\d+)$/.exec(runId);
    if (!match) throw new Error('EXTRA_RUN_ACTOR_UNVERIFIED');
    try {
        const response = await fetcher(`https://api.github.com/repos/Known-Enough/known-enough/actions/runs/${match[1]}`, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'KnownEnough-QA-ExtraRuns' },
            signal: globalThis.AbortSignal.timeout(10000), redirect: 'error'
        });
        if (!response.ok) throw new Error();
        return await response.json();
    } catch { throw new Error('EXTRA_RUN_ACTOR_UNVERIFIED'); }
}
export function reserveExtra(approval, authorization, authorizationVersion, dailyRuns, runId, run, now) {
    const match = /^gh-(\d+)-(\d+)$/.exec(runId);
    const day = new Date(now).toISOString().slice(0, 10);
    const keys = ['schemaVersion', 'day', 'actor', 'additionalRuns', 'usedRuns', 'baseRuns', 'authorizationVersion', 'authorizationExpiresAt', 'expiresAt'].sort().join();
    if (!approval || Object.keys(approval).sort().join() !== keys || approval.schemaVersion !== 1
        || day !== EXTRA_DAY || approval.day !== day || !EXTRA_ACTORS.has(approval.actor)
        || approval.additionalRuns !== 2 || approval.baseRuns !== 4 || authorization.maxRunsPerDay !== 4
        || approval.authorizationVersion !== authorizationVersion || approval.authorizationExpiresAt !== authorization.expiresAt
        || !authorization.approved || Date.parse(authorization.expiresAt) <= now
        || approval.expiresAt !== '2026-10-04T00:00:00Z' || Date.parse(approval.expiresAt) <= now
        || !Number.isSafeInteger(approval.usedRuns) || approval.usedRuns < 0 || approval.usedRuns >= 2
        || dailyRuns !== approval.baseRuns + approval.usedRuns)
        throw new Error('EXTRA_RUN_ALLOWANCE_BLOCKED');
    if (!match || String(run?.id) !== match[1] || String(run?.run_attempt) !== match[2]
        || run?.actor?.login !== approval.actor || run?.triggering_actor?.login !== approval.actor
        || run?.repository?.id !== 1377587215 || run?.head_repository?.id !== 1377587215
        || run?.head_branch !== 'main' || run?.event !== 'workflow_run' || run?.status !== 'in_progress'
        || run?.path !== '.github/workflows/live-qa-release-and-check.yml'
        || !/^[a-f0-9]{40}$/.test(run?.head_sha ?? ''))
        throw new Error('EXTRA_RUN_ACTOR_UNVERIFIED');
    return { ...approval, usedRuns: approval.usedRuns + 1 };
}
