/** Cognito includes version="1". HTTP API events are version="2.0" with requestContext. */
export function isSignupIntakeEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const value = event as Record<string, unknown>;
  return value.version === '1' && !('requestContext' in value)
    && (value.triggerSource === 'PostConfirmation_ConfirmSignUp' || value.triggerSource === 'PostConfirmation_ConfirmForgotPassword');
}
import type { createPartitionGroupSession } from '@deal-table/adapters/partition-request';
import { PartitionRegistrationConflict } from '@deal-table/adapters/partition-request';
/** Server trigger only: deploy with Cognito service permission bound to this pool/account, never behind public HTTP. */
export function createSignupIntake(options: { userPoolId: string; participantClientId: string;
  session: Pick<ReturnType<typeof createPartitionGroupSession>, 'register'> }) {
  const pool = options.userPoolId, client = options.participantClientId, register = options.session.register.bind(options.session);
  return async (event: unknown) => {
    if (!isSignupIntakeEvent(event)) throw new Error('SIGNUP_EVENT_INVALID');
    const value = event as Record<string, unknown>;
    const context = value.callerContext as Record<string, unknown> | undefined;
    if (value.userPoolId !== pool || value.region !== 'us-east-1' || context?.clientId !== client) throw new Error('SIGNUP_EVENT_INVALID');
    if (value.triggerSource === 'PostConfirmation_ConfirmForgotPassword') return event;
    const attrs = (value.request as { userAttributes?: Record<string, unknown> } | undefined)?.userAttributes;
    if (value.triggerSource !== 'PostConfirmation_ConfirmSignUp' || typeof value.userName !== 'string'
      || value.userName.length < 1 || value.userName.length > 128 || !attrs || attrs.email_verified !== 'true'
      || typeof attrs.sub !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(attrs.sub)
      || typeof attrs.email !== 'string') throw new Error('SIGNUP_EVENT_INVALID');
    try {
      await register({ kind: 'participant', subject: attrs.sub },
        { subject: attrs.sub, email: attrs.email, verified: true, username: value.userName }, { displayName: 'New member' });
    } catch (error) {
      // Verification and application admission are separate. Never steal the original
      // account or report a failed email verification because its email is already linked.
      // Authenticated registration recovery returns the conflict to the signed-in owner.
      if (!(error instanceof PartitionRegistrationConflict)) throw error;
      console.warn(JSON.stringify({ event: 'signup-intake', result: 'EMAIL_ALREADY_LINKED' }));
    }
    return event;
  };
}
