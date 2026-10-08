import type { IncomingMessage } from 'node:http';
import type { Clock, IdSource } from '@deal-table/application';
import { createPartitionManagedDriver, type PartitionManagedOptions, type PartitionDraftArchitect } from '@deal-table/adapters/partition-request';
import { createCognitoIdentityResolver, type CognitoIdentityOptions } from './cognito-identity.ts';
import { createPartitionParticipantApiHandler } from './partition-http.ts';

export interface PartitionRuntimeOptions {
  mode: 'PARTITION_V2';
  managed: PartitionManagedOptions;
  identity: CognitoIdentityOptions;
  cognitoDomain: string;
  allowedOrigin: string;
  emailKey: string;
  clock: Clock;
  ids: IdSource;
  /** Trusted server model port; its output never supplies participant authority. */
  draftArchitect?: PartitionDraftArchitect;
}
const invalid = (): never => { throw new Error('PARTITION_RUNTIME_INVALID'); };
const MAX_PROFILE_BYTES = 65_536;
async function profileBytes(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PROFILE_BYTES)) throw new Error('PROFILE_UNAVAILABLE');
  if (!response.body) throw new Error('PROFILE_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('PROFILE_UNAVAILABLE');
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_PROFILE_BYTES) throw new Error('PROFILE_UNAVAILABLE');
      chunks.push(value);
    }
    if (signal.aborted) throw new Error('PROFILE_UNAVAILABLE');
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Inactive composition entry. Nothing imports it from the installed Lambda or auto-selects it from environment flags.
 * Final-cloud selection must independently verify installed identity/configuration and the versioned private manifest.
 * The returned listener exposes no raw application, migration, archive, operator or recovery interface.
 */
export function createPartitionRuntime(options: PartitionRuntimeOptions) {
  if (!options || options.mode !== 'PARTITION_V2') return invalid();
  const identity = { ...options.identity };
  const origin = URL.parse(options.allowedOrigin); const domain = URL.parse(options.cognitoDomain);
  if (!/^us-east-1_[A-Za-z0-9]+$/.test(identity.userPoolId)
    || ![identity.participantClientId, identity.displayClientId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))
    || identity.participantClientId === identity.displayClientId
    || !origin || origin.protocol !== 'https:' || origin.origin !== options.allowedOrigin || origin.username || origin.password
    || !domain || domain.protocol !== 'https:' || domain.origin !== options.cognitoDomain || domain.username || domain.password || domain.port
    || !/^[a-z0-9-]+\.auth\.us-east-1\.amazoncognito\.com$/.test(domain.hostname)
    || typeof options.emailKey !== 'string' || options.emailKey.length < 32 || options.emailKey.length > 1024
    || typeof options.clock?.now !== 'function' || typeof options.ids?.next !== 'function'
    || (options.draftArchitect !== undefined && typeof options.draftArchitect !== 'function')) return invalid();
  const originValue = origin.origin; const profileUrl = `${domain.origin}/oauth2/userInfo`; const emailKey = options.emailKey;
  const clock = { now: options.clock.now.bind(options.clock) }; const ids = { next: options.ids.next.bind(options.ids) };
  const draftArchitect = options.draftArchitect;
  const resolve = createCognitoIdentityResolver(identity);
  const driver = createPartitionManagedDriver(options.managed);
  const authenticate = async (request: IncomingMessage, signal: AbortSignal) => {
    if (signal.aborted) return null;
    const principal = await resolve(request.headers.authorization);
    return signal.aborted ? null : principal;
  };
  return createPartitionParticipantApiHandler({ groups: driver.groups, decisions: driver.decisions,
    decisionArn: driver.decisionArn, partitionArn: driver.partitionArn,
    membershipDiscovery: driver.membershipDiscovery, authenticate, emailKey, clock, ids, allowedOrigins: [originValue],
    ...(draftArchitect ? { draftArchitect } : {}),
    registrationProfile: async (request, signal) => {
      let response: Response | undefined;
      try {
        const principal = await authenticate(request, signal);
        const authorization = request.headers.authorization;
        if (principal?.kind !== 'participant' || typeof authorization !== 'string') return null;
        const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
        response = await fetch(profileUrl, { headers: { authorization }, redirect: 'error', credentials: 'omit', signal: boundedSignal });
        if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return null;
        const value: unknown = JSON.parse(await profileBytes(response, boundedSignal));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const profile = value as Record<string, unknown>;
        if (profile.sub !== principal.subject || typeof profile.email !== 'string' || profile.email.length > 320
          || !(profile.email_verified === true || profile.email_verified === 'true')) return null;
        return { subject: principal.subject, email: profile.email, verified: true };
      } catch { return null; }
      finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
    },
  });
}
