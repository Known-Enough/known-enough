import { writeFileSync } from 'node:fs';
import { REQUIRED_TESTS, SAFE_PHASES, SAFE_MAIL_STATUSES, SAFE_OPERATION_STATUSES } from './runner-core.mjs';
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
export default class Reporter {
    tests = [];
    globalErrors = 0;
    failedTests = 0;
    phases = new Map();
    onStepEnd(test, _result, step) {
        if (step.error && REQUIRED_TESTS.includes(test.title) && SAFE_PHASES.includes(step.title))
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
        if (REQUIRED_TESTS.includes(test.title))
            this.tests.push({ title: test.title, status, ...(operationStatus && (phase === 'QA03_DRAFT' || phase?.startsWith('QA03_CREATE_')) ? { operationStatus } : {}), ...(mailStatus ? { mailStatus } : {}), ...(phase ? { phase } : {}) });
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
