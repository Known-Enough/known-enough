import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Id } from '@deal-table/contracts';
import type { TrustedPrincipal } from '@deal-table/application';

export type LocalTestIdentity = Exclude<TrustedPrincipal, { kind: 'service' }>;
export interface LocalTestAccount {
  readonly id: string;
  readonly displayName: string;
  readonly participantId?: string;
  readonly identity: LocalTestIdentity;
}
export interface LocalTestSession {
  readonly accountId: string;
  readonly displayName: string;
  readonly participantId: string | null;
  readonly kind: 'participant' | 'display';
  readonly token: string;
  readonly expiresAt: string;
}
export interface LocalTestSessionManager {
  issue(accountId: string): LocalTestSession | null;
  resolve(authorization: string | string[] | undefined): Promise<LocalTestIdentity | null>;
}

const ISSUER = 'known-enough-local-test';
const AUDIENCE = 'known-enough-loopback-api';
const DEFAULT_TTL_MS = 15 * 60_000;
const jwtHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

type Claims = { iss: string; aud: string; accountId: string; sub: string; kind: 'participant' | 'display'; roomId?: string; exp: number };

export function createLocalTestSessionManager(
  rawAccounts: readonly LocalTestAccount[],
  options: { key?: Buffer; ttlMs?: number; now?: () => number } = {},
): LocalTestSessionManager {
  const accounts = new Map<string, LocalTestAccount>();
  for (const account of rawAccounts) {
    if (!Id.safeParse(account.id).success || !account.displayName.trim() || account.displayName.length > 80
      || accounts.has(account.id) || !Id.safeParse(account.identity.subject).success
      || (account.participantId !== undefined && !Id.safeParse(account.participantId).success)
      || (account.identity.kind === 'display' && !Id.safeParse(account.identity.roomId).success))
      throw new Error('Invalid local test account allowlist');
    accounts.set(account.id, Object.freeze({ ...account }));
  }
  const key = options.key ?? randomBytes(32);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  if (key.length < 32 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60_000)
    throw new Error('Local test session signing key or lifetime is invalid');

  return {
    issue(accountId) {
      const account = accounts.get(accountId);
      if (!account) return null;
      const issuedAt = now();
      const exp = Math.floor((issuedAt + ttlMs) / 1000);
      const claims: Claims = {
        iss: ISSUER, aud: AUDIENCE, accountId, sub: account.identity.subject,
        kind: account.identity.kind, ...(account.identity.kind === 'display' ? { roomId: account.identity.roomId } : {}), exp,
      };
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const unsigned = `${jwtHeader}.${payload}`;
      const signature = createHmac('sha256', key).update(unsigned).digest('base64url');
      return Object.freeze({
        accountId, displayName: account.displayName, participantId: account.participantId ?? null,
        kind: account.identity.kind, token: `${unsigned}.${signature}`, expiresAt: new Date(exp * 1000).toISOString(),
      });
    },
    async resolve(authorization) {
      if (typeof authorization !== 'string' || authorization.length > 4096) return null;
      const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match?.[1] || !match[2] || !match[3]) return null;
      const unsigned = `${match[1]}.${match[2]}`;
      const expected = createHmac('sha256', key).update(unsigned).digest();
      const supplied = Buffer.from(match[3], 'base64url');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
      try {
        const header: unknown = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (header === null || typeof header !== 'object' || (header as Record<string, unknown>).alg !== 'HS256'
          || (header as Record<string, unknown>).typ !== 'JWT') return null;
        const raw: unknown = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'));
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const claims = raw as Partial<Claims>;
        const account = typeof claims.accountId === 'string' ? accounts.get(claims.accountId) : undefined;
        if (!account || claims.iss !== ISSUER || claims.aud !== AUDIENCE || claims.sub !== account.identity.subject
          || claims.kind !== account.identity.kind || !Number.isSafeInteger(claims.exp) || claims.exp! * 1000 <= now()
          || (account.identity.kind === 'display' ? claims.roomId !== account.identity.roomId : claims.roomId !== undefined)) return null;
        return account.identity;
      } catch {
        return null;
      }
    },
  };
}
