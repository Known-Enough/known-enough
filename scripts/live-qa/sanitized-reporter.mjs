import { writeFileSync } from 'node:fs';
import { REQUIRED_TESTS, SAFE_PHASES, SAFE_MAIL_STATUSES, SAFE_OPERATION_STATUSES, SAFE_REASONING_OUTCOMES, SAFE_FRAME_STATUSES } from './runner-core.mjs';
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
export default class Reporter {
    tests = [];
    globalErrors = 0;
    failedTests = 0;
    phases = new Map();
    onStepEnd(test, _result, step) {
        if (step.error && REQUIRED_TESTS.includes(test.title) && SAFE_PHASES.includes(step.title) && !this.phases.has(test.title))
            this.phases.set(test.title, step.title);
    }
    onError() {
        this.globalErrors++;
    }
    onTestEnd(test, result) {
        const status = statuses.has(result.status) ? result.status : 'interrupted';
        if (!['passed', 'skipped'].includes(status))
            this.failedTests++;
        const mailStatus = (test.annotations ?? []).filter(item => item.type === 'qa-mail-status' && SAFE_MAIL_STATUSES.includes(item.description)).at(-1)?.description;
        const operationStatus = (test.annotations ?? []).filter(item => item.type === 'qa-operation-status' && SAFE_OPERATION_STATUSES.includes(item.description)).at(-1)?.description;
        const phase = this.phases.get(test.title);
        const frameStatus=(test.annotations ?? []).filter(item=>item.type==='qa-frame-status' && SAFE_FRAME_STATUSES.includes(item.description)).at(-1)?.description;
        const reasoningOutcome = (test.annotations ?? []).filter(item => item.type === 'qa-reasoning-outcome' && SAFE_REASONING_OUTCOMES.includes(item.description)).at(-1)?.description;
        if (REQUIRED_TESTS.includes(test.title))
            this.tests.push({ title: test.title, status, ...(frameStatus && phase === 'QA03_FRAME_READ' ? { frameStatus } : {}), ...(reasoningOutcome && phase?.startsWith('QA04_') ? { reasoningOutcome } : {}), ...(operationStatus && (phase === 'QA03_DRAFT' || phase?.startsWith('QA03_CREATE_') || phase === 'QA03_FRAME_CONFIRM' || phase === 'QA03_OWNER_INTERPRET' || phase === 'QA03_OWNER_CONFIRM' || phase === 'QA04_EXPLORE' || phase === 'QA04_REEXPLORE' || phase === 'QA04_QUESTION') ? { operationStatus } : {}), ...(mailStatus ? { mailStatus } : {}), ...(phase ? { phase } : {}) });
    }
    onEnd(result) {
        const status = ['passed', 'failed', 'timedout', 'interrupted'].includes(result?.status) ? result.status : 'interrupted';
        if (process.env.QA_RESULTS_FILE)
            writeFileSync(process.env.QA_RESULTS_FILE, JSON.stringify({ tests: this.tests, status, globalErrors: this.globalErrors, failedTests: this.failedTests }), { mode: 0o600 });
    }
    printsToStdio() {
        return false;
    }
}
