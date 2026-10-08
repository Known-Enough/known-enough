import { operationStatus, transportFailureStatus } from './runner-core.mjs';

const endpoint = 'https://cognito-idp.us-east-1.amazonaws.com/';
const errors = ['UsernameExistsException', 'InvalidPasswordException', 'InvalidParameterException',
    'NotAuthorizedException', 'CodeMismatchException', 'ExpiredCodeException', 'LimitExceededException',
    'TooManyRequestsException', 'InvalidLambdaResponseException', 'UnexpectedLambdaException',
    'UserLambdaValidationException', 'CodeDeliveryFailureException', 'InternalErrorException',
    'ForbiddenException', 'ResourceNotFoundException'];
export const SAFE_SIGNUP_PROVIDER_CODES = ['COGNITO_ACCEPTED', 'COGNITO_UNKNOWN_ERROR', 'COGNITO_NO_RESPONSE', ...errors];

/** Only a known provider enum can leave an existing registration response. */
export function signupProviderCode(status, header, bytes) {
    if (Number.isInteger(status) && status >= 200 && status < 300) return 'COGNITO_ACCEPTED';
    let raw = header;
    if (!raw && bytes instanceof Uint8Array && bytes.byteLength <= 16384) {
        try {
            const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
            if (value && typeof value === 'object' && !Array.isArray(value)) raw = value.__type ?? value.code ?? value.Code;
        } catch { /* No provider body or parsing error leaves this boundary. */ }
    }
    if (typeof raw !== 'string' || raw.length > 160) return 'COGNITO_UNKNOWN_ERROR';
    const code = /(?:^|#)([A-Za-z]+Exception)(?::|$)/.exec(raw)?.[1];
    return errors.includes(code) ? code : 'COGNITO_UNKNOWN_ERROR';
}

/** Observe one existing exact Cognito request. Never read its request body or retry it. */
export async function trackSignupRequest(page, action, run, record) {
    if (!['SignUp', 'ConfirmSignUp'].includes(action)) throw new Error('SIGNUP_DIAGNOSTIC_ACTION_INVALID');
    record('HTTP_PENDING', 'COGNITO_NO_RESPONSE');
    const matches = request => request.method() === 'POST' && request.url() === endpoint
        && request.headers()['x-amz-target'] === 'AWSCognitoIdentityProviderService.' + action;
    let observed = false;
    let pending = Promise.resolve();
    const response = value => {
        if (observed || !matches(value.request())) return;
        observed = true;
        pending = (async () => {
            const status = value.status();
            let header, bytes;
            try {
                header = value.headers()['x-amzn-errortype'];
                if (!header && (status < 200 || status >= 300)) bytes = await value.body();
            } catch { /* Status survives an unavailable provider body. */ }
            record(operationStatus(status), signupProviderCode(status, header, bytes));
        })();
    };
    const failed = value => {
        if (observed || !matches(value)) return;
        observed = true;
        record(transportFailureStatus(value.failure()?.errorText), 'COGNITO_NO_RESPONSE');
    };
    page.on('response', response); page.on('requestfailed', failed);
    try { await run(); }
    finally { page.off('response', response); page.off('requestfailed', failed); await pending; }
}


/** Shared live/offline entry contract; a stale label fails before any signup request. */
export async function openSignupForm(page) {
    await page.getByRole('button', { name: 'Create account', exact: true }).click({ timeout: 15000 });
    await page.getByLabel('Username', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
}
