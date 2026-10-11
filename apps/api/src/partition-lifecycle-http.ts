import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TrustedPrincipal } from '@deal-table/application';
import * as LifecycleOwner from '@deal-table/contracts/lifecycle';

export interface LifecycleOwnerPort {
  exportOwn(principal: TrustedPrincipal): Promise<unknown>;
  loadOwnPlan(opId: string, principal: TrustedPrincipal): Promise<{ bytes: Buffer; expected: { opId: string; planHash: string } }>;
  consent(bytes: Buffer, expected: { opId: string; planHash: string }, principal: TrustedPrincipal, expiresAt: string, revoked: boolean): Promise<{ opId: string; granted: boolean; expiresAt: string }>;
  status(bytes: Buffer, expected: { opId: string; planHash: string }, principal: TrustedPrincipal): Promise<{ state: string; nextStep: number; totalSteps: number }>;
}
const consentRequest = LifecycleOwner.ConsentRequest;
const errorStatus: Record<string, number> = { LIFECYCLE_AUTHORITY_DENIED: 403, LIFECYCLE_INVALID: 422, LIFECYCLE_POLICY_DENIED: 403,
  LIFECYCLE_EXPIRED: 410, LIFECYCLE_SOURCE_CHANGED: 409, LIFECYCLE_CONFLICT: 409, LIFECYCLE_CAPACITY: 507,
  LIFECYCLE_STORAGE_UNAVAILABLE: 503, LIFECYCLE_COMMIT_UNKNOWN: 503, LIFECYCLE_TIMEOUT: 503, LIFECYCLE_REQUEST_LIMIT: 503 };
class OwnerRequestError extends Error { constructor(readonly code: string) { super(code); } }
const deny = (code: string): never => { throw new OwnerRequestError(code); };
function payload(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return Promise.reject(new OwnerRequestError('LIFECYCLE_INVALID'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const finish = (error?: Error, value?: unknown) => { request.off('data', data); request.off('end', end); request.off('error', reject); signal.removeEventListener('abort', abort); if (error) { request.resume(); reject(error); } else resolve(value); };
    const abort = () => finish(new OwnerRequestError('LIFECYCLE_TIMEOUT'));
    const data = (part: Buffer) => { bytes += part.length; if (bytes > 2048) finish(new OwnerRequestError('LIFECYCLE_INVALID')); else chunks.push(Buffer.from(part)); };
    const end = () => { try { finish(undefined, JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { finish(new OwnerRequestError('LIFECYCLE_INVALID')); } };
    request.on('data', data); request.once('end', end); request.once('error', reject); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Public owner routes never receive the operator prepare/publish/runner capability or a body-selected identity. */
export function createLifecycleOwnerHandler(options: {
  authenticate(request: IncomingMessage, signal: AbortSignal): Promise<TrustedPrincipal | null>;
  owner: LifecycleOwnerPort; allowedOrigin: string; fallback(request: IncomingMessage, response: ServerResponse): void;
  timeoutMs?: number; maxConcurrent?: number;
}) {
  const origin = URL.parse(options.allowedOrigin); const timeout = options.timeoutMs ?? 20000; const maximum = options.maxConcurrent ?? 6;
  if (!origin || origin.origin !== options.allowedOrigin || !['https:', 'http:'].includes(origin.protocol)
    || origin.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)
    || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 20000 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 6) throw new Error('LIFECYCLE_HTTP_INVALID');
  const owner = { exportOwn: options.owner.exportOwn.bind(options.owner), loadOwnPlan: options.owner.loadOwnPlan.bind(options.owner),
    consent: options.owner.consent.bind(options.owner), status: options.owner.status.bind(options.owner) };
  const authenticate = options.authenticate; const fallback = options.fallback; const allowedOrigin = origin.origin; let active = 0;
  return (request: IncomingMessage, response: ServerResponse) => {
    const url = URL.parse(request.url ?? '/', 'http://local.invalid');
    if (!url || !/^\/account\/(?:export|erasure)(?:\/|$)/.test(url.pathname)) { fallback(request, response); return; }
    response.setHeader('cache-control', 'no-store'); response.setHeader('vary', 'Origin'); response.setHeader('x-content-type-options', 'nosniff');
    const send = (status: number, value: unknown) => { if (response.writableEnded || response.destroyed) return;
      let body = JSON.stringify(value); if (Buffer.byteLength(body) > 1048576) { status = 507; body = JSON.stringify({ ok: false, error: { code: 'LIFECYCLE_CAPACITY' } }); }
      response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(body); };
    if (request.headers.origin !== undefined && request.headers.origin !== allowedOrigin) { request.resume(); send(403, { ok: false, error: { code: 'LIFECYCLE_AUTHORITY_DENIED' } }); return; }
    if (request.headers.origin === allowedOrigin) response.setHeader('access-control-allow-origin', allowedOrigin);
    if (request.method === 'OPTIONS') { request.resume(); response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); response.setHeader('access-control-allow-headers', 'Authorization, Content-Type'); response.statusCode = 204; response.end(); return; }
    if (active >= maximum) { request.resume(); send(503, { ok: false, error: { code: 'LIFECYCLE_STORAGE_UNAVAILABLE' } }); return; }
    active++; const controller = new AbortController();
    const closed = () => { if (!response.writableEnded) controller.abort(); };
    request.once('aborted', closed); response.once('close', closed);
    const timer = setTimeout(() => { controller.abort(); send(503, { ok: false, error: { code: 'LIFECYCLE_COMMIT_UNKNOWN' } }); }, timeout);
    void (async () => {
      try {
        if (url.search || url.hash) return deny('LIFECYCLE_INVALID');
        const principal = await authenticate(request, controller.signal);
        if (!principal || principal.kind !== 'participant') return deny('LIFECYCLE_AUTHORITY_DENIED');
        if (controller.signal.aborted) return deny('LIFECYCLE_TIMEOUT');
        if (request.method === 'GET' && url.pathname === '/account/export') {
          const result = await owner.exportOwn(principal);
          if (controller.signal.aborted) return deny('LIFECYCLE_COMMIT_UNKNOWN');
          response.setHeader('content-disposition', 'attachment; filename="known-enough-owner-export.json"'); send(200, result); return;
        }
        const operation = /^\/account\/erasure\/([A-Za-z0-9_-]{1,80})(\/consent)?$/.exec(url.pathname);
        if (!operation || !(request.method === 'GET' && !operation[2] || request.method === 'POST' && operation[2] === '/consent')) { request.resume(); send(404, { ok: false, error: { code: 'NOT_FOUND' } }); return; }
        const submitted = request.method === 'POST' ? consentRequest.safeParse(await payload(request, controller.signal)) : null;
        if (submitted && !submitted.success) return deny('LIFECYCLE_INVALID');
        const raw = submitted?.success ? submitted.data : null;
        if (controller.signal.aborted) return deny('LIFECYCLE_TIMEOUT');
        const plan = await owner.loadOwnPlan(operation[1]!, principal);
        if (controller.signal.aborted) return deny('LIFECYCLE_TIMEOUT');
        if (plan.expected.opId !== operation[1]) return deny('LIFECYCLE_SOURCE_CHANGED');
        if (raw && raw.planHash !== plan.expected.planHash) return deny('LIFECYCLE_SOURCE_CHANGED');
        const value = raw ? await owner.consent(plan.bytes, plan.expected, principal, raw.expiresAt, raw.revoked)
          : await owner.status(plan.bytes, plan.expected, principal);
        if (controller.signal.aborted) return deny('LIFECYCLE_COMMIT_UNKNOWN');
        if (raw) {
          const grant = LifecycleOwner.ConsentReceipt.parse(value);
          if (grant.opId !== plan.expected.opId || grant.granted !== !raw.revoked || grant.expiresAt !== raw.expiresAt) return deny('LIFECYCLE_STORAGE_UNAVAILABLE');
          send(200, { opId: grant.opId, granted: grant.granted, expiresAt: grant.expiresAt });
        } else {
          const progress = LifecycleOwner.Progress.parse(value);
          if (progress.nextStep > progress.totalSteps) return deny('LIFECYCLE_STORAGE_UNAVAILABLE');
          send(200, { state: progress.state, nextStep: progress.nextStep, totalSteps: progress.totalSteps });
        }
      } catch (error) {
        const observed = error instanceof OwnerRequestError || error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : 'LIFECYCLE_STORAGE_UNAVAILABLE';
        const code = typeof observed === 'string' && Object.hasOwn(errorStatus, observed) ? observed : 'LIFECYCLE_STORAGE_UNAVAILABLE';
        request.resume(); send(errorStatus[code]!, { ok: false, error: { code } });
      } finally {
        // A pending auth/storage call still occupies the slot even if the client deadline already elapsed.
        active--; clearTimeout(timer); request.off('aborted', closed); response.off('close', closed);
      }
    })();
  };
}
