import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:5175' });
const endpoint = 'https://cognito-idp.us-east-1.amazonaws.com/';
const password = 'Abcdef1!';
test('configured signup UI sends email, confirms code and retains real hosted PKCE sign-in (mock service)', async ({ page }) => {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  await page.route(endpoint, async route => {
    const action = route.request().headers()['x-amz-target']!;requests.push({ action, body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ contentType: 'application/x-amz-json-1.1', body: JSON.stringify(action.endsWith('.SignUp') ? { UserConfirmed: false, CodeDeliveryDetails: { DeliveryMedium: 'EMAIL' } } : {}) });
  });
  await page.goto('/');const signIn = page.getByRole('button', { name: 'Sign in', exact: true });await expect(signIn).toBeVisible();await expect(page.getByRole('button', { name: 'Sign in or register', exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');await expect(signIn).toBeFocused();
  await page.getByRole('button', { name: 'Register with email', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('fictional-user');await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(password);await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();expect(requests[0]!.body.UserAttributes).toEqual([{ Name: 'email', Value: 'synthetic@example.invalid' }]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(password);
  await page.getByLabel('Verification code').fill('123456');await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByText('Email verified. Sign in to continue and request access.', { exact: true })).toBeVisible();
  expect(requests[1]!.body).toEqual({ ClientId: 'localparticipant', Username: 'fictional-user', ConfirmationCode: '123456' });
  expect(await page.evaluate(() => sessionStorage.getItem('known-enough-cognito-session'))).toBeNull();
  let challenge = '';await page.route('https://localtest.auth.us-east-1.amazoncognito.com/**', async route => {
    challenge = new URL(route.request().url()).searchParams.get('code_challenge_method') ?? '';await route.fulfill({ body: '<h1>Hosted sign in</h1>', contentType: 'text/html' });
  });await signIn.click();await expect.poll(() => challenge).toBe('S256');
});
test('signup service failure stays on the form and never exposes private diagnostics (mock service)', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', message => consoleMessages.push(message.text()));
  await page.route(endpoint, route => route.fulfill({ status: 400, body: 'PRIVATE_SERVICE_EMAIL_PASSWORD' }));
  await page.goto('/');await page.getByRole('button', { name: 'Register with email', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('fictional-user');await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(password);await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Registration failed.');await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByText('Reference: PROVIDER_REJECTED', { exact: false })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_SERVICE_EMAIL_PASSWORD');await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  expect(consoleMessages.join(' ')).not.toMatch(/PRIVATE_SERVICE_EMAIL_PASSWORD|synthetic@example\.invalid|abcdef/);
});
test('five characters stop before the service; an uncertain signup offers code recovery (mock service)', async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, route => { requests++; return route.abort(); });
  await page.goto('/');await page.getByRole('button', { name: 'Register with email', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('fictional-user');
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('abcde');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect(requests).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('result is uncertain');
  await expect(page.getByRole('button', { name: 'I have a verification code' })).toBeVisible();
  await page.getByRole('button', { name: 'I have a verification code' }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
});
