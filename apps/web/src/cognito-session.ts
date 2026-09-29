/** Browser-only Cognito authorization-code/PKCE client. API authorization remains server-side. */
export interface CognitoBrowserConfig {
  region: string;
  userPoolId: string;
  domain: string;
  participantClientId: string;
  displayClientId: string;
  apiBaseUrl: string;
}
export interface CognitoSession {
  accessToken: string;
  expiresAt: number;
  kind: 'participant' | 'display';
}
type Pending = { state: string; verifier: string; kind: CognitoSession['kind']; createdAt: number };
const PENDING_KEY = 'known-enough-cognito-pending';
const SESSION_KEY = 'known-enough-cognito-session';
const INVITE_KEY = 'known-enough-cognito-invite';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HOST = /^[a-z0-9.-]+$/i;

export function parseCognitoConfig(env: Record<string, unknown>): CognitoBrowserConfig | null {
  const required = [
    'VITE_COGNITO_REGION', 'VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_DOMAIN',
    'VITE_COGNITO_PARTICIPANT_CLIENT_ID', 'VITE_COGNITO_DISPLAY_CLIENT_ID', 'VITE_API_BASE_URL',
  ] as const;
  if (required.some(key => typeof env[key] !== 'string' || !(env[key] as string).trim())) return null;
  const [region, userPoolId, domainValue, participantClientId, displayClientId, apiValue] = required.map(key => (env[key] as string).trim());
  const domain = URL.parse(domainValue!);
  const api = URL.parse(apiValue!);
  if (!domain || !api || !/^[a-z]{2}-[a-z]+-\d$/.test(region!) || !userPoolId!.startsWith(`${region}_`)
    || !HOST.test(domain.hostname) || !domain.hostname.endsWith(`.auth.${region}.amazoncognito.com`)
    || domain.protocol !== 'https:' || domain.username || domain.password || domain.port
    || domain.pathname !== '/' || domain.search || domain.hash || api.protocol !== 'https:' || api.username || api.password
    || api.search || api.hash || participantClientId === displayClientId) throw new Error('Invalid Cognito browser configuration');
  return { region: region!, userPoolId: userPoolId!, domain: domain.origin,
    participantClientId: participantClientId!, displayClientId: displayClientId!, apiBaseUrl: api.href.replace(/\/$/, '') };
}
function clientId(config: CognitoBrowserConfig, kind: CognitoSession['kind']): string {
  return kind === 'participant' ? config.participantClientId : config.displayClientId;
}
function randomUrlSafe(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64Url(value);
}
function toBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function challenge(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
function callbackUrl(location: Location): string { return `${location.origin}${location.pathname}`; }
function clearQuery(location: Location, history: History): void {
  history.replaceState(history.state, '', `${location.pathname}${location.hash}`);
}
export async function beginCognitoSignIn(config: CognitoBrowserConfig, kind: CognitoSession['kind'],
  storage: Storage = sessionStorage, location: Location = window.location): Promise<string> {
  const pending: Pending = { state: randomUrlSafe(), verifier: randomUrlSafe(), kind, createdAt: Date.now() };
  storage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = URL.parse('/oauth2/authorize', config.domain)!;
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId(config, kind),
    redirect_uri: callbackUrl(location), scope: 'openid', state: pending.state,
    code_challenge_method: 'S256', code_challenge: await challenge(pending.verifier) }).toString();
  return url.href;
}
export async function finishCognitoSignIn(config: CognitoBrowserConfig,
  storage: Storage = sessionStorage, location: Location = window.location, history: History = window.history,
  fetcher: typeof fetch = fetch): Promise<CognitoSession | null> {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error') && !query.has('state')) return null;
  const code = query.get('code');
  const state = query.get('state');
  clearQuery(location, history);
  const pendingRaw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  if (!code || !state || query.has('error') || !pendingRaw) throw new Error('Sign-in could not be completed. Start again.');
  let pending: Pending;
  try { pending = JSON.parse(pendingRaw) as Pending; } catch { throw new Error('Sign-in could not be completed. Start again.'); }
  if (!BASE64URL.test(code) || !BASE64URL.test(state) || !BASE64URL.test(pending.state)
    || !BASE64URL.test(pending.verifier) || state !== pending.state
    || (pending.kind !== 'participant' && pending.kind !== 'display')
    || !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > 5 * 60_000
    || pending.createdAt > Date.now() + 30_000) throw new Error('Sign-in expired or did not match this browser tab. Start again.');
  const response = await fetcher(URL.parse('/oauth2/token', config.domain)!, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId(config, pending.kind),
      code, redirect_uri: callbackUrl(location), code_verifier: pending.verifier }).toString() });
  if (!response.ok) throw new Error('Sign-in could not be completed. Start again.');
  const value: unknown = await response.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sign-in response.');
  const raw = value as Record<string, unknown>;
  if (raw.token_type !== 'Bearer' || typeof raw.access_token !== 'string'
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.access_token)
    || typeof raw.expires_in !== 'number' || !Number.isFinite(raw.expires_in)
    || raw.expires_in < 1 || raw.expires_in > 86_400) throw new Error('Invalid sign-in response.');
  const session: CognitoSession = { accessToken: raw.access_token,
    expiresAt: Date.now() + raw.expires_in * 1000, kind: pending.kind };
  storage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}
export function readCognitoSession(storage: Storage = sessionStorage): CognitoSession | null {
  let value: unknown;
  try { value = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null') as unknown; } catch { value = null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) { storage.removeItem(SESSION_KEY); return null; }
  const raw = value as Record<string, unknown>;
  if (typeof raw.accessToken !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.accessToken)
    || typeof raw.expiresAt !== 'number' || raw.expiresAt <= Date.now() + 5000
    || (raw.kind !== 'participant' && raw.kind !== 'display')) { storage.removeItem(SESSION_KEY); return null; }
  return raw as unknown as CognitoSession;
}
export function clearCognitoSession(storage: Storage = sessionStorage): void {
  storage.removeItem(SESSION_KEY); storage.removeItem(PENDING_KEY);
}
/** Keep a one-time invitation in this tab while Cognito redirects away. */
export function readPendingCognitoInvitation(storage: Storage = sessionStorage,
  location: Location = window.location, history: History = window.history): string | null {
  const fragment = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const incoming = fragment.get('invite');
  if (fragment.has('invite')) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    if (incoming && /^[A-Za-z0-9_-]{1,80}$/.test(incoming))
      storage.setItem(INVITE_KEY, JSON.stringify({ token: incoming, createdAt: Date.now() }));
    else storage.removeItem(INVITE_KEY);
  }
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(INVITE_KEY) ?? 'null') as unknown; } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { storage.removeItem(INVITE_KEY); return null; }
  const value = raw as Record<string, unknown>;
  if (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.token)
    || typeof value.createdAt !== 'number' || value.createdAt > Date.now() + 30_000
    || Date.now() - value.createdAt > 24 * 60 * 60_000) { storage.removeItem(INVITE_KEY); return null; }
  return value.token;
}
export function clearPendingCognitoInvitation(storage: Storage = sessionStorage): void {
  storage.removeItem(INVITE_KEY);
}
export function cognitoLogoutUrl(config: CognitoBrowserConfig, session: CognitoSession,
  location: Location = window.location): string {
  const url = URL.parse('/logout', config.domain)!;
  url.search = new URLSearchParams({ client_id: clientId(config, session.kind), logout_uri: callbackUrl(location) }).toString();
  return url.href;
}
export async function cognitoApiFetch(config: CognitoBrowserConfig, session: CognitoSession, path: string,
  onUnauthorized: () => void, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')
    || (path !== '/decisions' && !path.startsWith('/decisions/'))) throw new Error('Invalid API path');
  if (session.expiresAt <= Date.now() + 5000) { onUnauthorized(); throw new Error('Session expired'); }
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${session.accessToken}`);
  const response = await fetcher(`${config.apiBaseUrl}${path}`, { ...init, headers, credentials: 'omit', redirect: 'error' });
  if (response.status === 401) onUnauthorized();
  return response;
}
