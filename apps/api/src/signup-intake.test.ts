import { expect, it, vi } from 'vitest';
import { createSignupIntake } from './signup-intake.ts';
const event = () => ({ region: 'us-east-1', userPoolId: 'us-east-1_fixture', userName: 'synthetic-login',
  callerContext: { clientId: 'participant' }, triggerSource: 'PostConfirmation_ConfirmSignUp',
  request: { userAttributes: { sub: 'subject-one', email: 'synthetic@example.invalid', email_verified: 'true' } }, response: {} });
it('confirmed signup uses authoritative event identity, defaults a non-identifying name, returns the event and never approves', async () => {
  const register = vi.fn(async () => ({ status: 'PENDING' as const, displayName: 'New member', version: 1 }));
  const intake = createSignupIntake({ userPoolId: 'us-east-1_fixture', participantClientId: 'participant', session: { register } });
  const value = event(); expect(await intake(value)).toBe(value);
  expect(register).toHaveBeenCalledWith({ kind: 'participant', subject: 'subject-one' },
    { subject: 'subject-one', email: 'synthetic@example.invalid', verified: true, username: 'synthetic-login' }, { displayName: 'New member' });
});
it('unverified, wrong pool/client and browser event shapes cannot request approval or queue identity', async () => {
  const register = vi.fn(); const intake = createSignupIntake({ userPoolId: 'us-east-1_fixture', participantClientId: 'participant', session: { register } });
  for (const bad of [{ ...event(), userPoolId: 'foreign' }, { ...event(), callerContext: { clientId: 'display' } },
    { ...event(), request: { userAttributes: { ...event().request.userAttributes, email_verified: 'false' } } }, { subject: 'subject-one', email_verified: true }]) {
    await expect(intake(bad)).rejects.toThrow('SIGNUP_EVENT_INVALID');
  }
  const forgotten = { ...event(), triggerSource: 'PostConfirmation_ConfirmForgotPassword' }; expect(await intake(forgotten)).toBe(forgotten);
  expect(register).not.toHaveBeenCalled();
});
