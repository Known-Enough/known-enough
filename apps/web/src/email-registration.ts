import type { CognitoBrowserConfig } from './cognito-session';

export const MIN_REGISTRATION_PASSWORD_LENGTH = 6;
export type RegistrationStep = 'signup' | 'confirmation';
export type RegistrationCode =
  | 'INVALID_DETAILS' | 'INVALID_CODE' | 'PASSWORD_REJECTED' | 'ACCOUNT_EXISTS_OR_PENDING'
  | 'SIGNUP_UNAVAILABLE' | 'ATTRIBUTES_REJECTED' | 'CODE_REJECTED' | 'CODE_EXPIRED'
  | 'RATE_LIMITED' | 'NETWORK_RESULT_UNKNOWN' | 'DELIVERY_UNCONFIRMED'
  | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'UNEXPECTED_RESPONSE';
export interface RegistrationDiagnostic {
  step: RegistrationStep;
  code: RegistrationCode;
  observedAt: string;
  httpStatus?: number;
  requestId?: string;
}

/** Only these fixed fields may leave a provider response for the UI or console. */
export class RegistrationFailure extends Error {
  constructor(readonly diagnostic: RegistrationDiagnostic) {
    super(diagnostic.step === 'signup' ? 'Registration could not be completed.' : 'Email verification could not be completed.');
    this.name = 'RegistrationFailure';
  }
}
function failure(step: RegistrationStep, code: RegistrationCode, response?: Response): RegistrationFailure {
  const rawId = response?.headers.get('x-amzn-requestid') ?? response?.headers.get('x-amz-request-id');
  const requestId = rawId && /^[A-Za-z0-9-]{1,80}$/.test(rawId) ? rawId : undefined;
  return new RegistrationFailure({ step, code, observedAt: new Date().toISOString(),
    ...(response ? { httpStatus: response.status } : {}), ...(requestId ? { requestId } : {}) });
}
export function asRegistrationFailure(error: unknown, step: RegistrationStep): RegistrationFailure {
  return error instanceof RegistrationFailure ? error : failure(step, 'UNEXPECTED_RESPONSE');
}
function providerCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 160) return null;
  const code = /(?:^|#)([A-Za-z]+Exception)(?::|$)/.exec(raw)?.[1];
  return code ?? null;
}
async function rejectedCode(response: Response, step: RegistrationStep): Promise<RegistrationCode> {
  let raw: unknown = response.headers.get('x-amzn-errortype');
  if (!raw) {
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const value = body as Record<string, unknown>;
        raw = value.__type ?? value.code ?? value.Code;
      }
    } catch { /* Never include a raw provider body or parsing error in diagnostics. */ }
  }
  switch (providerCode(raw)) {
    case 'UsernameExistsException': return 'ACCOUNT_EXISTS_OR_PENDING';
    case 'InvalidPasswordException': return 'PASSWORD_REJECTED';
    case 'InvalidParameterException': return 'ATTRIBUTES_REJECTED';
    case 'NotAuthorizedException': return step === 'signup' ? 'SIGNUP_UNAVAILABLE' : 'CODE_REJECTED';
    case 'CodeMismatchException': return 'CODE_REJECTED';
    case 'ExpiredCodeException': return 'CODE_EXPIRED';
    case 'LimitExceededException':
    case 'TooManyRequestsException': return 'RATE_LIMITED';
  }
  return response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED';
}

/** Public Cognito registration only; authentication still uses hosted PKCE. */
async function registrationRequest(config: CognitoBrowserConfig, action: 'SignUp' | 'ConfirmSignUp',
  value: Record<string, unknown>, fetcher: typeof fetch): Promise<Response> {
  const step: RegistrationStep = action === 'SignUp' ? 'signup' : 'confirmation';
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.region)) throw failure(step, 'SIGNUP_UNAVAILABLE');
  let response: Response;
  try {
    response = await fetcher(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ ClientId: config.participantClientId, ...value }),
    });
  } catch {
    // A timed-out response might still have created an account. Do not invite blind retry.
    throw failure(step, 'NETWORK_RESULT_UNKNOWN');
  }
  if (!response.ok) throw failure(step, await rejectedCode(response, step), response);
  return response;
}
function validUsername(username: string): boolean { return /^[A-Za-z0-9_.@+-]{1,128}$/.test(username); }
export async function requestEmailRegistration(config: CognitoBrowserConfig,
  details: { username: string; email: string; password: string }, fetcher: typeof fetch = fetch): Promise<void> {
  if (!validUsername(details.username) || details.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)
    || details.password.length < MIN_REGISTRATION_PASSWORD_LENGTH || details.password.length > 256)
    throw failure('signup', 'INVALID_DETAILS');
  const response = await registrationRequest(config, 'SignUp', { Username: details.username, Password: details.password,
    UserAttributes: [{ Name: 'email', Value: details.email }] }, fetcher);
  let result: unknown;
  try { result = await response.json(); } catch { throw failure('signup', 'DELIVERY_UNCONFIRMED', response); }
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || (result as { UserConfirmed?: unknown }).UserConfirmed !== false
    || (result as { CodeDeliveryDetails?: { DeliveryMedium?: unknown } }).CodeDeliveryDetails?.DeliveryMedium !== 'EMAIL')
    throw failure('signup', 'DELIVERY_UNCONFIRMED', response);
}
export async function confirmEmailRegistration(config: CognitoBrowserConfig, username: string, code: string,
  fetcher: typeof fetch = fetch): Promise<void> {
  if (!validUsername(username) || !/^\d{6}$/.test(code)) throw failure('confirmation', 'INVALID_CODE');
  await registrationRequest(config, 'ConfirmSignUp', { Username: username, ConfirmationCode: code }, fetcher);
}
