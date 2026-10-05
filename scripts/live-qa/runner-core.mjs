import { safeKernelCodes, safeRuleFailureKinds } from './kernel-codes.mjs';
import { safeModelFailures } from './model-failure-diagnostics.mjs';
import { publicTarget, requireRunId } from './config.mjs';
export const REQUIRED_TESTS = [
    'QA01 signup and managed login', 'QA02 admission and invitations', 'QA03 fresh decision and owner confirmations', 'QA04 private negotiation and exact agreement', 'QA05 denial privacy and recovery', 'QA06 refusal revocation revision and disclosure', 'QA07 rendered clarification and accessibility'
];
export function validateTarget(raw) {
    const t = publicTarget(raw);
    if (t.Account !== '092954139775' || t.Region !== 'us-east-1' || t.PoolId === 'us-east-1_V9OMjd0zx' || !/^us-east-1_[A-Za-z0-9]+$/.test(t.PoolId) || !/^https:\/\/[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com$/.test(t.ApiUrl) || t.ApiUrl.includes('u94iyvt6p9') || !/^https:\/\/main\.[a-z0-9]+\.amplifyapp\.com\/$/.test(t.FrontendUrl) || t.CognitoDomain !== 'https://known-enough-qa-092954139775.auth.us-east-1.amazoncognito.com' || t.ApiFunction !== 'known-enough-qa-api' || t.BrokerFunction !== 'known-enough-qa-fixtures' || t.GroupTable !== 'KnownEnoughQaGroups' || t.DecisionTable !== 'KnownEnoughQaDecisions' || t.ControlTable !== 'KnownEnoughQaControl' || !t.LoginSecret.startsWith('arn:aws:secretsmanager:us-east-1:092954139775:secret:known-enough/qa/run-login-'))
        throw new Error('QA_TARGET_NOT_INSTALLED_OR_UNSAFE');
    return t;
}
export function validateReceipt(t, r, current) {
    if (!r || r.schemaVersion !== 1 || r.sourceCommit !== current || !/^[a-f0-9]{40}$/.test(current) || r.targetApi !== t.ApiUrl || r.targetFrontend !== t.FrontendUrl || !/^\d+$/.test(String(r.jobId)) || !/^\d+$/.test(String(r.workflowRunId)) || !r.artifacts || ['api', 'broker', 'web'].some(k => !/^[a-f0-9]{64}$/.test(r.artifacts[k]?.sha256 ?? '')))
        throw new Error('TRUSTED_RELEASE_RECEIPT_REQUIRED');
    return r;
}
export function validateWorkload(identity, profile) {
    if (profile || identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaTest/'))
        throw new Error('QA_GITHUB_WORKLOAD_IDENTITY_REQUIRED');
}
export const SAFE_PHASES = ['QA01_ENTRY', 'QA01_SIGNUP', 'QA01_EMAIL', 'QA01_EMAIL_READ', 'QA01_EMAIL_CONFIRM', 'QA01_LOGIN', 'QA01_ACTORS', 'QA02_REGISTER', 'QA02_DENIAL', 'QA02_GROUP_CREATE', 'QA02_GROUP_READ', 'QA02_INVITATION_REPLACE', 'QA02_INVITATION_UI', 'QA02_INVITATION_EXPIRED', 'QA03_DRAFT', 'QA03_EDIT', 'QA03_CREATE', 'QA03_CREATE_DRAFT', 'QA03_CREATE_CLICK', 'QA03_CREATE_ID', 'QA03_CREATE_READ', 'QA03_CREATE_FRAME', 'QA03_FRAME', 'QA03_FRAME_LOAD', 'QA03_FRAME_REVIEW', 'QA03_FRAME_CONFIRM', 'QA03_FRAME_READ', 'QA03_FRAME_VERIFY', 'QA03_FRAME_FINITE', 'QA03_OWNER', 'QA03_OWNER_LOAD', 'QA03_OWNER_INPUT', 'QA03_OWNER_INTERPRET', 'QA03_OWNER_REVIEW', 'QA03_OWNER_SEMANTICS', 'QA03_OWNER_SELECT', 'QA03_OWNER_CONFIRM', 'QA03_OWNER_READ', 'QA04_LOAD', 'QA04_EXPLORE', 'QA04_QUESTION', 'QA04_QUESTION_SERVER', 'QA04_QUESTION_PRIVACY', 'QA04_ALLOW', 'QA04_REEXPLORE', 'QA04_PROPOSAL_READ', 'QA04_DISCLOSURE_SETUP', 'QA04_DISCLOSURE_REVIEW', 'QA04_DISCLOSURE_DECLINE', 'QA04_DISCLOSURE_READ', 'QA04_APPROVAL_LOAD', 'QA04_APPROVAL_REVIEW', 'QA04_APPROVAL_CONFIRM', 'QA04_AGREEMENT_READ', 'QA04_AGREEMENT_RENDER'];
export const SAFE_MAIL_STATUSES = ['MAIL_PENDING', 'MAIL_EMPTY', 'MAIL_OWNER_MISMATCH', 'MAIL_SENDER_MISMATCH', 'MAIL_RECIPIENT_MISMATCH', 'MAIL_OLD_MESSAGE', 'MAIL_CODE_READY', 'MAIL_CODE_AMBIGUOUS', 'MAIL_CODE_UNRECOGNIZED', 'MAIL_PROVIDER_UNAVAILABLE', 'MAIL_SCHEMA_UNEXPECTED', 'MAIL_BROKER_UNAVAILABLE'];
export const SAFE_FRAME_STATUSES = ['FRAME_COUNT_EXACT', 'FRAME_COUNT_MISSING', 'FRAME_COUNT_EXCESS'];
export const SAFE_REASONING_OUTCOMES = ['APPLIED', 'STALE', 'NEEDS_CLARIFICATION', 'NEEDS_PERMISSION', 'INVALID'];
export const SAFE_OPERATION_STATUSES = ['HTTP_PENDING', 'HTTP_OK', 'HTTP_BAD_REQUEST', 'HTTP_UNAUTHENTICATED', 'HTTP_FORBIDDEN', 'HTTP_NOT_FOUND', 'HTTP_CONFLICT', 'HTTP_UNPROCESSABLE', 'HTTP_SERVER_ERROR', 'HTTP_BAD_GATEWAY', 'HTTP_CAPACITY', 'HTTP_UNAVAILABLE', 'HTTP_GATEWAY_TIMEOUT', 'HTTP_OTHER_FAILURE', 'HTTP_TRANSPORT_FAILED', 'HTTP_REQUEST_ABORTED', 'HTTP_REQUEST_TIMEOUT', 'HTTP_CONNECTION_FAILED', 'HTTP_DNS_FAILED', 'HTTP_NETWORK_UNAVAILABLE', 'HTTP_PROTOCOL_FAILED', 'HTTP_EMPTY_RESPONSE', 'HTTP_TLS_FAILED'].concat(Array.from({length:500},(_,index)=>`HTTP_STATUS_${100+index}`));
const SAFE_TRANSPORT_FAILURES = new Map([
    ['net::ERR_ABORTED', 'HTTP_REQUEST_ABORTED'],
    ['net::ERR_TIMED_OUT', 'HTTP_REQUEST_TIMEOUT'], ['net::ERR_CONNECTION_TIMED_OUT', 'HTTP_REQUEST_TIMEOUT'],
    ['net::ERR_CONNECTION_RESET', 'HTTP_CONNECTION_FAILED'], ['net::ERR_CONNECTION_CLOSED', 'HTTP_CONNECTION_FAILED'], ['net::ERR_CONNECTION_REFUSED', 'HTTP_CONNECTION_FAILED'],
    ['net::ERR_NAME_NOT_RESOLVED', 'HTTP_DNS_FAILED'],
    ['net::ERR_INTERNET_DISCONNECTED', 'HTTP_NETWORK_UNAVAILABLE'], ['net::ERR_NETWORK_CHANGED', 'HTTP_NETWORK_UNAVAILABLE'],
    ['net::ERR_HTTP2_PROTOCOL_ERROR', 'HTTP_PROTOCOL_FAILED'],
    ['net::ERR_EMPTY_RESPONSE', 'HTTP_EMPTY_RESPONSE'],
    ['net::ERR_CERT_AUTHORITY_INVALID', 'HTTP_TLS_FAILED'], ['net::ERR_CERT_COMMON_NAME_INVALID', 'HTTP_TLS_FAILED'], ['net::ERR_CERT_DATE_INVALID', 'HTTP_TLS_FAILED']
]);
/** Expose only a fixed browser-network category; never report the raw error text. */
export function transportFailureStatus(errorText) {
    return SAFE_TRANSPORT_FAILURES.get(errorText) ?? 'HTTP_TRANSPORT_FAILED';
}
export function operationStatus(status) {
    if (!Number.isInteger(status) || status < 100 || status > 599) return 'HTTP_OTHER_FAILURE';
    if (status >= 200 && status < 300) return 'HTTP_OK';
    return ({400:'HTTP_BAD_REQUEST',401:'HTTP_UNAUTHENTICATED',403:'HTTP_FORBIDDEN',404:'HTTP_NOT_FOUND',409:'HTTP_CONFLICT',422:'HTTP_UNPROCESSABLE',500:'HTTP_SERVER_ERROR',502:'HTTP_BAD_GATEWAY',507:'HTTP_CAPACITY',503:'HTTP_UNAVAILABLE',504:'HTTP_GATEWAY_TIMEOUT'})[status] ?? `HTTP_STATUS_${status}`;
}
export function safeResults(tests) {
    tests = Array.isArray(tests) ? tests.filter(t => t && typeof t === 'object') : [];
    return REQUIRED_TESTS.map(title => {
        const found = tests.filter(t => t.title === title);
        return {
            title, ...(found.length === 1 && Array.isArray(found[0].ruleFailureKinds) ? {ruleFailureKinds: safeRuleFailureKinds(found[0].ruleFailureKinds)} : {}), ...(found.length === 1 && Array.isArray(found[0].kernelCodes) ? {kernelCodes: safeKernelCodes(found[0].kernelCodes)} : {}), ...(found.length === 1 && SAFE_FRAME_STATUSES.includes(found[0].frameStatus) ? { frameStatus: found[0].frameStatus } : {}), ...(found.length === 1 && SAFE_REASONING_OUTCOMES.includes(found[0].reasoningOutcome) ? { reasoningOutcome: found[0].reasoningOutcome } : {}), ...(found.length === 1 && SAFE_OPERATION_STATUSES.includes(found[0].operationStatus) ? { operationStatus: found[0].operationStatus } : {}), ...(found.length === 1 && SAFE_MAIL_STATUSES.includes(found[0].mailStatus) ? { mailStatus: found[0].mailStatus } : {}), ...(found.length === 1 && SAFE_PHASES.includes(found[0].phase) ? { phase: found[0].phase } : {}), status: found.length === 1 && found[0].status === 'passed' ? 'PASS' : found.some(t => ['failed', 'timedOut', 'interrupted'].includes(t.status)) ? 'FAIL' : 'BLOCKED'
        };
    });
}
export function qualificationReport(input) {
    requireRunId(input.runId);
    const results = safeResults(input.tests ?? []);
    const lanes = {
        execution: input.processExitCode === 0 && input.processSignal === null && input.reportStatus === 'passed' && input.globalErrors === 0 && input.failedTests === 0 ? 'PASS' : 'BLOCKED', preflight: input.preflight === 'PASS' ? 'PASS' : 'BLOCKED', fixtures: input.fixtures === 'PASS' ? 'PASS' : 'BLOCKED', journeys: results.every(t => t.status === 'PASS') ? 'PASS' : results.some(t => t.status === 'FAIL') ? 'FAIL' : 'BLOCKED', model: input.attempts > 0 ? 'PASS' : 'BLOCKED', privacy: input.privacy === 'PASS' ? 'PASS' : 'BLOCKED', signup: input.signupMessages > 0 && results[0].status === 'PASS' ? 'PASS' : 'BLOCKED', cleanup: input.cleanup === 'CLEAN' ? 'PASS' : 'BLOCKED'
    };
    return {
        schemaVersion: 1, modelFailures: Array.isArray(input.modelFailures) ? safeModelFailures(input.modelFailures) : null, runId: input.runId, sourceCommit: /^[a-f0-9]{40}$/.test(input.sourceCommit ?? '') ? input.sourceCommit : null, status: Object.values(lanes).every(s => s === 'PASS') ? 'PASS' : 'BLOCKED_OR_FAILED', lanes, tests: results, counts: {
            passed: results.filter(t => t.status === 'PASS').length, failed: results.filter(t => t.status === 'FAIL').length, blocked: results.filter(t => t.status === 'BLOCKED').length, modelAttempts: Number.isSafeInteger(input.attempts) && input.attempts >= 0 ? input.attempts : null, signupMessages: Number.isSafeInteger(input.signupMessages) && input.signupMessages >= 0 ? input.signupMessages : null
        }
    };
}
