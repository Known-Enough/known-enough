import { writeFileSync } from 'node:fs';
import { REQUIRED_TESTS } from './runner-core.mjs';
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
export default class Reporter {
  tests = [];
  globalErrors = 0;
  failedTests = 0;
  onError() { this.globalErrors++; }
  onTestEnd(test, result) {
    const status = statuses.has(result.status) ? result.status : 'interrupted';
    if (!['passed', 'skipped'].includes(status)) this.failedTests++;
    if (REQUIRED_TESTS.includes(test.title)) this.tests.push({ title: test.title, status });
  }
  onEnd(result) {
    const status = ['passed', 'failed', 'timedout', 'interrupted'].includes(result?.status) ? result.status : 'interrupted';
    if (process.env.QA_RESULTS_FILE) writeFileSync(process.env.QA_RESULTS_FILE,
      JSON.stringify({ tests: this.tests, status, globalErrors: this.globalErrors, failedTests: this.failedTests }), { mode: 0o600 });
  }
  printsToStdio() { return false; }
}
