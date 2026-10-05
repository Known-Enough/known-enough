import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const read = path => {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
};
export function completeReport(inputs, context) {
    const jobs = ['provenance', 'release', 'primary-release', 'public', 'metadata', 'journey'];
    const lanes = {
        jobs: jobs.every(name => context.jobResults?.[name] === 'success') ? 'PASS' : 'BLOCKED', primaryPublication: inputs.primaryRelease?.status === 'PASS' && inputs.primaryRelease.sourceCommit === context.sourceCommit ? 'PASS' : 'BLOCKED', currentSource: context.latestMain === context.sourceCommit ? 'PASS' : 'BLOCKED', release: inputs.receipt && inputs.receipt.sourceCommit === context.sourceCommit ? 'PASS' : 'BLOCKED', public: inputs.public?.sourceCommit === context.sourceCommit && inputs.public?.status === 'PASS' ? 'PASS' : 'BLOCKED', primaryConfiguration: inputs.metadata?.status === 'PASS' && inputs.metadata?.sourceCommit === context.sourceCommit ? 'PASS' : 'BLOCKED', qaJourney: inputs.qa?.status === 'PASS' && inputs.qa?.sourceCommit === context.sourceCommit ? 'PASS' : 'BLOCKED'
    };
    const actor = /^[A-Za-z0-9-]{1,39}$/.test(context.actor ?? '') ? context.actor : 'unavailable';
    return {
        schemaVersion: 1, status: Object.values(lanes).every(s => s === 'PASS') ? 'PASS' : 'BLOCKED_OR_FAILED', sourceCommit: /^[a-f0-9]{40}$/.test(context.sourceCommit ?? '') ? context.sourceCommit : null, initiatingAccount: actor, lanes, jobResults: Object.fromEntries(jobs.map(name => [name, ['success', 'failure', 'skipped', 'cancelled'].includes(context.jobResults?.[name]) ? context.jobResults[name] : 'unavailable'])), targets: {
            primary: 'https://main.d143q5ravxp5av.amplifyapp.com/', qa: /^https:\/\/main\.[a-z0-9]+\.amplifyapp\.com\/$/.test(inputs.receipt?.targetFrontend ?? '') ? inputs.receipt.targetFrontend : null, staticPreview: 'https://d23eowhnwtqts3.cloudfront.net/'
        }, targetDifferences: [
            'Primary models remain disabled under NP00; real AI journeys run in isolated budgeted QA.', 'QA uses separate pools, clients, API and data tables; primary writable AI was not tested.'
        ], qaCounts: Object.fromEntries(['passed', 'failed', 'blocked', 'modelAttempts', 'signupMessages'].map(key => [key, Number.isSafeInteger(inputs.qa?.counts?.[key]) && inputs.qa.counts[key] >= 0 ? inputs.qa.counts[key] : null])), requiredCloudAcceptance: 'LIVE04 requires actual B dispatch and separate authorized automatic deployment run'
    };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const directory = resolve(process.argv[2]);
    const report = completeReport({
        receipt: read(directory + '/receipt.json'), primaryRelease: read(directory + '/primary-release.json'), public: read(directory + '/public.json'), metadata: read(directory + '/metadata.json'), qa: read(directory + '/qa-report.json')
    }, {
        sourceCommit: process.env.TESTED_SOURCE, actor: process.env.INITIATING_ACCOUNT, latestMain: process.env.LATEST_MAIN_SHA, jobResults: Object.fromEntries(Object.entries(JSON.parse(process.env.PIPELINE_JOBS ?? '{}')).map(([name, value]) => [name, value.result]))
    });
    writeFileSync(directory + '/complete-report.json', JSON.stringify(report, null, 2) + '\n');
    const md = `# Known Enough live qualification\n\nStatus: **${report.status}**. Source: ${report.sourceCommit ?? 'unavailable'}. Initiating GitHub account: ${report.initiatingAccount}.\n\n| Lane | Status |\n| --- | --- |\n${Object.entries(report.lanes).map(([name, status]) => `| ${name} | ${status} |`).join('\n')}\n\nPrimary models remain disabled under NP00; real AI journeys run in isolated budgeted QA with separate pools, API and data tables. Primary writable AI was not tested. Any missing required lane blocks complete acceptance.\n`;
    writeFileSync(directory + '/complete-report.md', md);
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    console.log(JSON.stringify({ status: report.status, lanes: report.lanes }));
    if (report.status !== 'PASS')
        process.exitCode = 1;
}
