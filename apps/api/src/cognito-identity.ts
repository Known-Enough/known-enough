import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { JwksCache } from 'aws-jwt-verify/jwk';
import { Id } from '@deal-table/contracts';
import type { TrustedPrincipal } from '@deal-table/application';

export interface CognitoIdentityOptions {
  readonly userPoolId: string;
  readonly participantClientId: string;
  readonly displayClientId: string;
}

type HttpIdentity = Exclude<TrustedPrincipal, { kind: 'service' }>;
type Claims = {
  readonly sub?: unknown;
  readonly client_id?: unknown;
  readonly token_use?: unknown;
  readonly 'cognito:groups'?: unknown;
};

const DISPLAY_GROUP_PREFIX = 'deal-table-display-';
const MAX_BEARER_HEADER_LENGTH = 8192;

function checkedOptions(options: CognitoIdentityOptions): CognitoIdentityOptions {
  if (!options.userPoolId.trim() || !options.participantClientId.trim() || !options.displayClientId.trim()
    || options.participantClientId === options.displayClientId) {
    throw new Error('Cognito pool and distinct participant/display app clients are required');
  }
  return Object.freeze({ ...options });
}

/** Map only claims from an already verified Cognito access token. */
export function mapVerifiedCognitoClaims(payload: unknown, options: CognitoIdentityOptions): HttpIdentity | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const claims = payload as Claims;
  if (claims.token_use !== 'access' || typeof claims.sub !== 'string' || !Id.safeParse(claims.sub).success) return null;
  const rawGroups = claims['cognito:groups'];
  if (rawGroups !== undefined && (!Array.isArray(rawGroups) || rawGroups.some(group => typeof group !== 'string'))) return null;
  if (claims.client_id === options.participantClientId) return { kind: 'participant', subject: claims.sub };
  if (claims.client_id !== options.displayClientId || !Array.isArray(rawGroups)) return null;
  const scopedRooms = (rawGroups as string[])
    .filter(group => group.startsWith(DISPLAY_GROUP_PREFIX))
    .map(group => group.slice(DISPLAY_GROUP_PREFIX.length));
  if (scopedRooms.length !== 1 || !Id.safeParse(scopedRooms[0]).success) return null;
  return { kind: 'display', subject: claims.sub, roomId: scopedRooms[0]! };
}

function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length > MAX_BEARER_HEADER_LENGTH) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value);
  return match?.[1] ?? null;
}

/**
 * Verify Cognito access tokens before mapping them to application principals.
 * Participant identity uses the signed `sub`; display scope requires a
 * separate client and exactly one admin-managed deal-table-display-<roomId> group.
 */
export function createCognitoIdentityResolver(
  rawOptions: CognitoIdentityOptions,
  jwksCache?: JwksCache,
): (authorization: string | string[] | undefined) => Promise<HttpIdentity | null> {
  const options = checkedOptions(rawOptions);
  const tokenVerifier = CognitoJwtVerifier.create({
    userPoolId: options.userPoolId,
    tokenUse: 'access',
    clientId: [options.participantClientId, options.displayClientId],
    graceSeconds: 0,
  }, jwksCache ? { jwksCache } : undefined);
  return async authorization => {
    const token = bearerToken(authorization);
    if (!token) return null;
    try {
      return mapVerifiedCognitoClaims(await tokenVerifier.verify(token), options);
    } catch {
      // Authentication errors intentionally carry no token, claim, or verifier detail.
      return null;
    }
  };
}

/** Build the production verifier from non-secret deployment configuration. */
export function createCognitoIdentityResolverFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  jwksCache?: JwksCache,
): (authorization: string | string[] | undefined) => Promise<HttpIdentity | null> {
  const userPoolId = env.COGNITO_USER_POOL_ID;
  const participantClientId = env.COGNITO_PARTICIPANT_CLIENT_ID;
  const displayClientId = env.COGNITO_DISPLAY_CLIENT_ID;
  if (!userPoolId || !participantClientId || !displayClientId) {
    throw new Error('COGNITO_USER_POOL_ID, COGNITO_PARTICIPANT_CLIENT_ID and COGNITO_DISPLAY_CLIENT_ID must be configured');
  }
  return createCognitoIdentityResolver({ userPoolId, participantClientId, displayClientId }, jwksCache);
}
