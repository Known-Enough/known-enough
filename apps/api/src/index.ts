import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  CommandEnvelope, ERROR_HTTP_STATUS, Id, type CommandResult, type OwnerSnapshot, type PublicRoomSnapshot,
} from '@deal-table/contracts';
import {
  ApplicationError, DealTableApplication, type TrustedPrincipal,
} from '@deal-table/application';
import type { ApiIdentityResolver, ApiPrincipal } from './cognito-identity.ts';

const IDENTITY_HEADER = 'x-deal-table-test-identity';
const REQUEST_ID_HEADER = 'x-request-id';
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const LOCAL_IDENTITY_LABEL = /^NON_PRODUCTION [A-Za-z0-9_-]{1,80}$/;

type HttpIdentity = ApiPrincipal;
type ErrorResult = Extract<CommandResult, { ok: false }>;

export interface LocalApiOptions {
  readonly application: DealTableApplication;
  /**
   * A fixed server-side allowlist for this local-only adapter. The wire value is
   * the map key, for example `NON_PRODUCTION maya`; it never contains a role or
   * a client-selected room scope.
   */
  readonly identities?: ReadonlyMap<string, HttpIdentity>;
  readonly maxBodyBytes?: number;
  /** Emit safe local-flow diagnostics without private input values. */
  readonly debug?: boolean;
}

export interface LocalApiServerOptions extends LocalApiOptions {
  readonly host?: string;
  readonly port?: number;
}

/** Server handler options for an authenticated composition such as Cognito. */
export interface ApiHandlerOptions {
  readonly application: DealTableApplication;
  readonly identityResolver: ApiIdentityResolver;
  readonly maxBodyBytes?: number;
  readonly debug?: boolean;
}

export function createNonProductionIdentities(roomId: string): ReadonlyMap<string, HttpIdentity> {
  const checkedRoomId = Id.parse(roomId);
  return new Map([
    ['NON_PRODUCTION maya', { kind: 'participant', subject: 'maya' }],
    ['NON_PRODUCTION leo', { kind: 'participant', subject: 'leo' }],
    ['NON_PRODUCTION nina', { kind: 'participant', subject: 'nina' }],
    ['NON_PRODUCTION organizer', { kind: 'participant', subject: 'organizer' }],
    ['NON_PRODUCTION display', { kind: 'display', subject: 'local-display', roomId: checkedRoomId }],
  ]);
}

function validateMaxBodyBytes(maxBodyBytes: number | undefined): number {
  const checkedMaxBodyBytes = maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(checkedMaxBodyBytes) || checkedMaxBodyBytes < 1 || checkedMaxBodyBytes > 1024 * 1024) {
    throw new Error('maxBodyBytes must be an integer between 1 and 1048576');
  }
  return checkedMaxBodyBytes;
}

function validateOptions(options: LocalApiOptions): { identities: ReadonlyMap<string, HttpIdentity>; maxBodyBytes: number } {
  const identities = options.identities ?? createNonProductionIdentities('room-synthetic');
  const cleanIdentities = new Map<string, HttpIdentity>();
  const maxBodyBytes = validateMaxBodyBytes(options.maxBodyBytes);
  for (const [label, principal] of identities) {
    if (!LOCAL_IDENTITY_LABEL.test(label) || !principal.subject
      || (principal.kind !== 'participant' && principal.kind !== 'display')) {
      throw new Error('Local API identities must be fixed NON_PRODUCTION participant or display identities');
    }
    const subject = Id.parse(principal.subject);
    if (principal.kind === 'participant') {
      cleanIdentities.set(label, { kind: 'participant', subject });
    } else {
      cleanIdentities.set(label, { kind: 'display', subject, roomId: Id.parse(principal.roomId) });
    }
  }
  return { identities: cleanIdentities, maxBodyBytes };
}

function requestId(request: IncomingMessage): string {
  const value = request.headers[REQUEST_ID_HEADER];
  return typeof value === 'string' && Id.safeParse(value).success ? value : 'invalid-request';
}

function bodyRequestId(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).requestId;
    if (typeof value === 'string' && Id.safeParse(value).success) return value;
  }
  return fallback;
}

function errorBody(code: ApplicationError['code'], id: string): ErrorResult {
  return { ok: false, requestId: id, error: { code, httpStatus: ERROR_HTTP_STATUS[code] } };
}

type DebugValue = string | number | boolean;

function debugLog(enabled: boolean, event: string, details: Record<string, DebugValue>): void {
  if (!enabled) return;
  const suffix = Object.entries(details).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
  console.log(`[deal-table] ${event}${suffix ? ` ${suffix}` : ''}`);
}

function actor(principal: HttpIdentity): string {
  return principal.kind === 'display' ? 'display' : principal.subject;
}

function logPublicSnapshot(enabled: boolean, principal: HttpIdentity, snapshot: PublicRoomSnapshot): void {
  debugLog(enabled, 'public-snapshot', {
    actor: actor(principal), room: snapshot.roomId, status: snapshot.status,
    decisionRevision: snapshot.decisionRevision, controlVersion: snapshot.controlVersion,
    setup: snapshot.roster.map(member => `${member.id}:${member.submitted ? 'confirmed' : 'pending'}`).join(','),
  });
}

function logOwnerSnapshot(enabled: boolean, principal: HttpIdentity, snapshot: OwnerSnapshot): void {
  debugLog(enabled, 'owner-snapshot', {
    actor: actor(principal), room: snapshot.roomId, ownerRevision: snapshot.ownerRevision,
    input: snapshot.confirmedInputs ? 'confirmed' : snapshot.draft ? 'draft' : 'missing',
    reviewedIntervals: snapshot.availabilityReview?.intervals.length ?? 0,
    exceptionOffers: snapshot.pendingOffers.length, disclosurePreviews: snapshot.disclosurePreviews.length,
    finalApproval: snapshot.ownApproval !== null,
  });
}

function applicationError(error: unknown, id: string): ErrorResult {
  return error instanceof ApplicationError
    ? errorBody(error.code, id)
    : errorBody('INVALID_COMMAND', id);
}

function setCors(response: ServerResponse, request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
  }
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Authorization, Content-Type, X-Deal-Table-Test-Identity, X-Request-Id');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

function identity(request: IncomingMessage, identities: ReadonlyMap<string, HttpIdentity>): HttpIdentity | null {
  const label = request.headers[IDENTITY_HEADER];
  return typeof label === 'string' ? identities.get(label) ?? null : null;
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentType = request.headers['content-type'];
  const mediaType = typeof contentType === 'string' ? contentType.split(';', 1)[0]?.trim().toLowerCase() : undefined;
  if (mediaType !== 'application/json') {
    throw new ApplicationError('INVALID_COMMAND');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maxBodyBytes) throw new ApplicationError('INVALID_COMMAND');
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApplicationError('INVALID_COMMAND');
  }
}

function roomPath(url: URL): { roomId: string; view: 'public' | 'me' | 'commands' } | null {
  const match = /^\/rooms\/([^/]+)\/(public|me|commands)$/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  try {
    return { roomId: decodeURIComponent(match[1]), view: match[2] as 'public' | 'me' | 'commands' };
  } catch {
    return null;
  }
}

async function authorizeRoute(
  application: DealTableApplication, principal: HttpIdentity, roomId: string,
): Promise<void> {
  // This read intentionally happens before command parsing and replay lookup.
  // It uses the application's membership/scope checks and reveals no snapshot.
  await application.getPublicSnapshot(principal, roomId);
}

async function runQueuedWork(application: DealTableApplication, roomId: string, debug: boolean): Promise<void> {
  const worker: TrustedPrincipal = {
    kind: 'service', subject: 'local-non-production-worker', roomIds: [roomId],
  };
  const job = await application.pendingSolveJob(worker, roomId);
  if (!job) {
    debugLog(debug, 'solve-job-skipped', { room: roomId, reason: 'NO_PENDING_JOB' });
    return;
  }
  const result = await application.runSolveJob(worker, roomId, job.id);
  debugLog(debug, 'solve-job-result', { room: roomId, result });
}

/**
 * Local-only HTTP adapter. It accepts a fixed synthetic identity label and is
 * deliberately unsuitable for production authentication.
 */
function createRequestHandler(
  application: DealTableApplication,
  maxBodyBytes: number,
  debug: boolean,
  resolveIdentity: (request: IncomingMessage) => Promise<HttpIdentity | null>,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      setCors(response, request);
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }

      const id = requestId(request);
      let principal: HttpIdentity | null = null;
      try {
        principal = await resolveIdentity(request);
      } catch {
        // Identity infrastructure failures fail closed without exposing details.
      }
      if (!principal) {
        sendJson(response, 401, errorBody('UNAUTHENTICATED', id));
        return;
      }

      const url = URL.parse(request.url ?? '/', 'http://local.invalid');
      if (!url) {
        sendJson(response, 404, errorBody('NOT_FOUND', id));
        return;
      }
      const route = roomPath(url);
      if (!route || !['GET', 'POST'].includes(request.method ?? '')) {
        sendJson(response, 404, errorBody('NOT_FOUND', id));
        return;
      }

      try {
        if (request.method === 'GET' && route.view === 'public') {
          const snapshot = await application.getPublicSnapshot(principal, route.roomId);
          logPublicSnapshot(debug, principal, snapshot);
          sendJson(response, 200, snapshot);
          return;
        }
        if (request.method === 'GET' && route.view === 'me') {
          // authorizeRoute makes display/organizer and nonmember failures happen
          // before any private owner projection is considered.
          await authorizeRoute(application, principal, route.roomId);
          const snapshot = await application.getOwnerSnapshot(principal, route.roomId);
          logOwnerSnapshot(debug, principal, snapshot);
          sendJson(response, 200, snapshot);
          return;
        }
        if (request.method !== 'POST' || route.view !== 'commands') {
          sendJson(response, 404, errorBody('NOT_FOUND', id));
          return;
        }

        await authorizeRoute(application, principal, route.roomId);
        if (principal.kind === 'display') {
          request.resume();
          sendJson(response, 403, errorBody('FORBIDDEN', id));
          return;
        }
        const body = await readJson(request, maxBodyBytes);
        const commandRequestId = bodyRequestId(body, id);
        if (body === null || typeof body !== 'object' || Array.isArray(body)
          || (body as Record<string, unknown>).roomId !== route.roomId) {
          debugLog(debug, 'command-rejected', { actor: actor(principal), room: route.roomId, error: 'INVALID_COMMAND' });
          sendJson(response, 422, errorBody('INVALID_COMMAND', commandRequestId));
          return;
        }
        const parsedCommand = CommandEnvelope.safeParse(body);
        const commandType = parsedCommand.success ? parsedCommand.data.type : 'INVALID_COMMAND';
        debugLog(debug, 'command-received', { actor: actor(principal), room: route.roomId, type: commandType });
        const result = await application.execute(principal, body);
        if (result.ok && result.status === 'QUEUED') await runQueuedWork(application, route.roomId, debug);
        debugLog(debug, result.ok ? 'command-result' : 'command-rejected', result.ok
          ? { actor: actor(principal), room: route.roomId, type: commandType, status: result.status, controlVersion: result.version.controlVersion }
          : { actor: actor(principal), room: route.roomId, type: commandType, error: result.error.code });
        sendJson(response, result.ok ? 200 : result.error.httpStatus, result);
      } catch (error) {
        const result = applicationError(error, id);
        debugLog(debug, 'request-error', { actor: actor(principal), room: route.roomId, error: result.error.code });
        sendJson(response, result.error.httpStatus, result);
      }
    })();
  };
}

/** Build an API handler around a verified server-side identity resolver. */
export function createApiHandler(options: ApiHandlerOptions): (request: IncomingMessage, response: ServerResponse) => void {
  const maxBodyBytes = validateMaxBodyBytes(options.maxBodyBytes);
  return createRequestHandler(
    options.application,
    maxBodyBytes,
    options.debug ?? false,
    request => options.identityResolver(request.headers.authorization),
  );
}

/** Local-only HTTP adapter for fixed synthetic identities. */
export function createLocalApiHandler(options: LocalApiOptions): (request: IncomingMessage, response: ServerResponse) => void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The local non-production API cannot run with NODE_ENV=production');
  }
  const { identities, maxBodyBytes } = validateOptions(options);
  return createRequestHandler(
    options.application,
    maxBodyBytes,
    options.debug ?? false,
    request => Promise.resolve(identity(request, identities)),
  );
}

export function createLocalApiServer(options: LocalApiOptions): Server {
  return createServer(createLocalApiHandler(options));
}

export async function listenLocalApi(options: LocalApiServerOptions): Promise<Server> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('The local non-production API may listen only on a loopback address');
  }
  const server = createLocalApiServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export { createCognitoIdentityResolver, createCognitoIdentityResolverFromEnv } from './cognito-identity.ts';
