import type { CognitoBrowserConfig } from './cognito-session';

/** Public Cognito registration only; authentication still uses hosted PKCE. */
async function registrationRequest(config: CognitoBrowserConfig, action: 'SignUp' | 'ConfirmSignUp',
  value: Record<string, unknown>, fetcher: typeof fetch) {
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.region)) throw new Error('Registration is unavailable.');
  const response = await fetcher(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: config.participantClientId, ...value }),
  });
  if (!response.ok) throw new Error('Registration could not be completed. Check your details and try again.');
  return response;
}
function validUsername(username: string) { return /^[A-Za-z0-9_.@+-]{1,128}$/.test(username); }
export async function requestEmailRegistration(config: CognitoBrowserConfig,
  details: { username: string; email: string; password: string }, fetcher: typeof fetch = fetch): Promise<void> {
  if (!validUsername(details.username) || details.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)
    || details.password.length < 16 || details.password.length > 256) throw new Error('Check your registration details.');
  const response = await registrationRequest(config, 'SignUp', { Username: details.username, Password: details.password,
    UserAttributes: [{ Name: 'email', Value: details.email }] }, fetcher);
  const result = await response.json() as { UserConfirmed?: boolean; CodeDeliveryDetails?: { DeliveryMedium?: string } };
  if (result.UserConfirmed !== false || result.CodeDeliveryDetails?.DeliveryMedium !== 'EMAIL')
    throw new Error('Email verification is unavailable. Contact the app operator.');
}
export async function confirmEmailRegistration(config: CognitoBrowserConfig, username: string, code: string,
  fetcher: typeof fetch = fetch): Promise<void> {
  if (!validUsername(username) || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit verification code.');
  await registrationRequest(config, 'ConfirmSignUp', { Username: username, ConfirmationCode: code }, fetcher);
}
