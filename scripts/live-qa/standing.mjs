/** Standing authority still requires the actual authorized project workflow and operator. */
export function assertStandingRun(runId, run) {
    const match = /^gh-(\d+)-(\d+)$/.exec(runId);
    const actors = { martelaxe: 44531296, Battosai1806: 143764700 };
    if (!match || String(run?.id) !== match[1] || String(run?.run_attempt) !== match[2]
        || !Object.hasOwn(actors, run?.actor?.login ?? '') || run.actor.id !== actors[run.actor.login]
        || run.triggering_actor?.login !== run.actor.login || run.triggering_actor?.id !== run.actor.id
        || run.repository?.id !== 1377587215 || run.head_repository?.id !== 1377587215
        || run.head_branch !== 'main' || !['workflow_run', 'workflow_dispatch'].includes(run.event)
        || run.status !== 'in_progress' || run.path !== '.github/workflows/live-qa-release-and-check.yml'
        || !/^[a-f0-9]{40}$/.test(run.head_sha ?? ''))
        throw new Error('STANDING_RUN_PROVENANCE_UNVERIFIED');
    return true;
}
