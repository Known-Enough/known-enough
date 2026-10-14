import { expect, it, vi } from 'vitest';
import { createSignupIntake, isSignupIntakeEvent } from './signup-intake.ts';
import { PartitionRegistrationConflict } from '@deal-table/adapters/partition-request';
const event = () => ({ version: '1', region: 'us-east-1', userPoolId: 'us-east-1_fixture', userName: 'synthetic-login',
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

it('versioned Cognito confirmation selects intake while HTTP envelopes and browser bodies cannot', () => {
  expect(isSignupIntakeEvent(event())).toBe(true);
  expect(isSignupIntakeEvent({ ...event(), version: '2.0', requestContext: {} })).toBe(false);
  expect(isSignupIntakeEvent({ version: '2.0', body: JSON.stringify(event()) })).toBe(false);
  expect(isSignupIntakeEvent({ ...event(), version: undefined })).toBe(false);
});

it('returns successful email confirmation for an admission email conflict without linking or approving another account', async () => {
  const register = vi.fn().mockRejectedValue(new PartitionRegistrationConflict());
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const intake = createSignupIntake({ userPoolId: 'us-east-1_fixture', participantClientId: 'participant', session: { register } });
    const value = event(); expect(await intake(value)).toBe(value);
    expect(register).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'signup-intake', result: 'EMAIL_ALREADY_LINKED' }));
    register.mockRejectedValue(new Error('PRIVATE_STORAGE_ERROR'));
    await expect(intake(value)).rejects.toThrow('PRIVATE_STORAGE_ERROR');
  } finally { warn.mockRestore(); }
});
