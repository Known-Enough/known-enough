import { describe, expect, test, vi } from 'vitest';
import type { CognitoBrowserConfig } from './cognito-session';
import { confirmEmailRegistration, requestEmailRegistration } from './email-registration';
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
    await expect(requestEmailRegistration(config, { ...details, password: 'short' }, fetcher)).rejects.toThrow();
    await expect(confirmEmailRegistration(config, details.username, 'bad', fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
  test('never treats missing email delivery or a raw service error as verified signup', async () => {
    await expect(requestEmailRegistration(config, details, async () => new Response('{}'))).rejects.toThrow('Email verification is unavailable');
    await expect(requestEmailRegistration(config, details, async () => new Response('PRIVATE_EMAIL_PASSWORD', { status: 400 }))).rejects.toThrow('Registration could not be completed');
  });
});
