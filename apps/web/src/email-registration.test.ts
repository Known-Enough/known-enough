import { describe, expect, test, vi } from 'vitest';
import type { CognitoBrowserConfig } from './cognito-session';
import { confirmEmailRegistration, requestEmailRegistration, RegistrationFailure } from './email-registration';
const config: CognitoBrowserConfig = { region: 'us-east-1', userPoolId: 'us-east-1_test',
  domain: 'https://test.auth.us-east-1.amazoncognito.com', participantClientId: 'participant', displayClientId: 'display', apiBaseUrl: 'https://api.example.invalid' };
const details = { username: 'fictional-user', email: 'synthetic@example.invalid', password: 'Qa7!FictionalPassword' };
describe('email registration with real service request contract, no AWS calls', () => {
  test('includes email on public participant signup, without credentials or session tokens', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ UserConfirmed: false, CodeDeliveryDetails: { DeliveryMedium: 'EMAIL' } })));
    await requestEmailRegistration(config, details, fetcher);
    expect(fetcher.mock.calls).toHaveLength(1);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');expect(request.credentials).toBe('omit');
    expect(request.headers).toEqual({ 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.SignUp' });
    expect(JSON.parse(request.body as string)).toEqual({ ClientId: 'participant', Username: details.username, Password: details.password, UserAttributes: [{ Name: 'email', Value: details.email }] });
  });
  test('confirmation requires the email code and keeps hosted authentication separate', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    await confirmEmailRegistration(config, details.username, '123456', fetcher);
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toEqual({ ClientId: 'participant', Username: details.username, ConfirmationCode: '123456' });
    expect(request.headers).toMatchObject({ 'x-amz-target': 'AWSCognitoIdentityProviderService.ConfirmSignUp' });
  });
  test('rejects invalid form input before any service request', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    await expect(requestEmailRegistration(config, { ...details, email: 'invalid' }, fetcher)).rejects.toThrow();
    await expect(requestEmailRegistration(config, { ...details, password: 'abcde' }, fetcher)).rejects.toThrow();
    await expect(confirmEmailRegistration(config, details.username, 'bad', fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
  test('rejects each missing installed password requirement before requesting signup', async () => {
    const fetcher = vi.fn(async () => Response.json({ UserConfirmed: false, CodeDeliveryDetails: { DeliveryMedium: 'EMAIL' } }));
    for (const password of ['Ab1!xyz', 'abcdefg1!', 'ABCDEFG1!', 'Abcdefgh!', 'Abcdefgh1']) {
      await expect(requestEmailRegistration(config, { ...details, password }, fetcher)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    await requestEmailRegistration(config, { ...details, password: 'Abcdef1!' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('does not treat missing email delivery or a raw service error as verified signup', async () => {
    await expect(requestEmailRegistration(config, details, async () => new Response('{}'))).rejects.toMatchObject({
      diagnostic: { step: 'signup', code: 'DELIVERY_UNCONFIRMED' },
    });
    const response = new Response('PRIVATE_EMAIL_PASSWORD', { status: 400 });
    await expect(requestEmailRegistration(config, details, async () => response)).rejects.toMatchObject({
      diagnostic: { step: 'signup', code: 'PROVIDER_REJECTED', httpStatus: 400 },
    });
  });
  test('maps only allowlisted service codes and request IDs, never provider messages', async () => {
    const response = Response.json({ __type: 'com.amazonaws.cognito#InvalidPasswordException',
      message: 'PRIVATE_EMAIL_PASSWORD' }, { status: 400, headers: { 'x-amzn-requestid': 'safe-id-123' } });
    let error: unknown;
    try { await requestEmailRegistration(config, details, async () => response); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RegistrationFailure);
    expect((error as RegistrationFailure).diagnostic).toMatchObject({
      step: 'signup', code: 'PASSWORD_REJECTED', httpStatus: 400, requestId: 'safe-id-123',
    });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_EMAIL_PASSWORD');
    const headerOnly = new Response('PRIVATE_EMAIL_PASSWORD', { status: 400,
      headers: { 'x-amzn-errortype': 'UsernameExistsException:https://private.example.invalid',
        'x-amzn-requestid': 'PRIVATE_EMAIL@bad' } });
    let headerError: unknown;
    try { await requestEmailRegistration(config, details, async () => headerOnly); } catch (caught) { headerError = caught; }
    expect(headerError).toMatchObject({ diagnostic: { code: 'ACCOUNT_EXISTS_OR_PENDING', httpStatus: 400 } });
    expect((headerError as RegistrationFailure).diagnostic).not.toHaveProperty('requestId');
  });
  test('marks a network failure as unknown because signup may have succeeded', async () => {
    await expect(requestEmailRegistration(config, details, async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); }))
      .rejects.toMatchObject({ diagnostic: { code: 'NETWORK_RESULT_UNKNOWN', step: 'signup' } });
  });
});
