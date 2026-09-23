import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { JwksCache } from 'aws-jwt-verify/jwk';
import { Id } from '@deal-table/contracts';
import type { TrustedPrincipal } from '@deal-table/application';

export type ApiPrincipal = Exclude<TrustedPrincipal, { kind: 'service' }>;
export type ApiIdentityResolver = (authorizationHeader: string | undefined) => Promise<ApiPrincipal | null>;

/** A narrow seam so identity-claim mapping can be exercised without live Cognito. */
export interface CognitoAccessTokenVerifier {
  verify(token: string): Promise<unknown>;
}

const DISPLAY_GROUP_PREFIX = 'deal-table:display:';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

/**
 * Verify Cognito access tokens, then derive only a subject or a single
 * room-scoped, read-only display principal from signed claims. Membership and
 * command authorization remain application responsibilities.
 */
export function createCognitoIdentityResolver(options: {
  userPoolId: string;
  clientId: string;
  verifier?: CognitoAccessTokenVerifier;
  /** Trusted server-side cache override, useful for offline tests and managed key caches. */
  jwksCache?: JwksCache;
}): ApiIdentityResolver {
  if (!options.userPoolId.trim() || !options.clientId.trim()) {
    throw new Error('Cognito user pool ID and app client ID are required');
  }

  const verifier = options.verifier ?? (options.jwksCache
    ? CognitoJwtVerifier.create({
      userPoolId: options.userPoolId,
      clientId: options.clientId,
      tokenUse: 'access',
    }, { jwksCache: options.jwksCache })
    : CognitoJwtVerifier.create({
      userPoolId: options.userPoolId,
      clientId: options.clientId,
      tokenUse: 'access',
    }));

  return async authorizationHeader => {
    const token = bearerToken(authorizationHeader);
    if (!token) return null;

    let claims: unknown;
    try {
      claims = await verifier.verify(token);
    } catch {
      // Do not expose verifier, token, or key-fetch errors to callers or logs.
      return null;
    }
    if (!isRecord(claims) || typeof claims.sub !== 'string' || !Id.safeParse(claims.sub).success) return null;

    const rawGroups = claims['cognito:groups'];
    if (rawGroups !== undefined && (!Array.isArray(rawGroups) || rawGroups.some(group => typeof group !== 'string'))) {
      return null;
    }
    const displayGroups = (rawGroups ?? []).filter((group: string) => group.startsWith(DISPLAY_GROUP_PREFIX));
    if (displayGroups.length > 1) return null;

    if (displayGroups.length === 0) return { kind: 'participant', subject: claims.sub };

    const roomId = Id.safeParse(displayGroups[0]!.slice(DISPLAY_GROUP_PREFIX.length));
    return roomId.success ? { kind: 'display', subject: claims.sub, roomId: roomId.data } : null;
  };
}

/** Build a production verifier from non-secret deployment configuration. */
export function createCognitoIdentityResolverFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  jwksCache?: JwksCache,
): ApiIdentityResolver {
  const userPoolId = env.COGNITO_USER_POOL_ID;
  const clientId = env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error('COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be configured');
  }
  return createCognitoIdentityResolver({ userPoolId, clientId, ...(jwksCache ? { jwksCache } : {}) });
}
