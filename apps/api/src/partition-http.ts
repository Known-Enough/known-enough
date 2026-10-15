import { PartitionOwnerFailure, type OwnerInterpretation } from './partition-owner-runtime.ts';
import type { DraftRecoveryRequest } from './partition-draft-recovery.ts';
import { randomUUID } from 'node:crypto';
import { RequestNegotiation, NegotiationReceipt, BACKGROUND_NEGOTIATION_PROFILE } from '@deal-table/contracts/durable-command';
import type { DurableEnqueueRequest } from './durable-enqueue.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Id, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, KnownEnoughApplicationError, RepositoryCapacityError,
  type Clock, type IdSource, type TrustedPrincipal } from '@deal-table/application';
import { createPartitionGroupSession, createPartitionDecisionRepository, PartitionSessionError, PartitionDraftFailure, PartitionRegistrationConflict, partitionIO,
  type PartitionTransport, type PartitionDecisionTransport, type PartitionGroupDiscovery, type PartitionDraftArchitect } from '@deal-table/adapters/partition-request';

type ErrorCode = Extract<KE.DecisionCommandResult, { ok: false }>['error']['code'];
export interface PartitionParticipantApiOptions {
  ownerInterpretation?: OwnerInterpretation;
  /** Trusted server resolver: verify access tokens; never map caller-selected identity headers. */
  draftRequest?: (request: DraftRecoveryRequest) => Promise<unknown>;
  authenticate: (request: IncomingMessage, signal: AbortSignal) => Promise<TrustedPrincipal | null>;
  /** Trusted server lookup from authenticated credentials; never a caller-provided profile. */
  registrationProfile?: (request: IncomingMessage, signal: AbortSignal) => Promise<{ subject: string; email: string; verified: boolean; username?: string } | null>;
  emailKey?: string;
  sharedTestEmailHashes?: readonly string[];
  invitationToken?: () => string;
  /** Server-configured, source-bound private membership discovery; candidates still require fresh admission. */
  membershipDiscovery?: PartitionGroupDiscovery;
  /** Trusted bounded architect port; model output does not supply participant authority. */
  draftArchitect?: PartitionDraftArchitect;
  /** Trusted composition only; enables GET public for an independently verified room-bound display. */
  displayAccess?: boolean;
  /** Trusted enqueue-only port; processing/provider/admin capabilities never enter an HTTP body. */
  requestNegotiation?: (request: DurableEnqueueRequest) => Promise<{ jobId: string; state: 'QUEUED'; expiresAt: string }>;
  /** Trusted release-derived classification; JWT and current data conditions still authorize public legacy reads. */
  legacyPublicDecision?: (decisionId: string) => boolean;
  groups: PartitionTransport;
  decisions: PartitionDecisionTransport;
  decisionArn: string;
  partitionArn: string;
  clock: Clock;
  ids: IdSource;
  allowedOrigins: readonly string[];
  maxBodyBytes?: number;
  authTimeoutMs?: number;
  bodyTimeoutMs?: number;
  maxConcurrentRequests?: number;
}
function reject(code: ErrorCode): never { throw new KnownEnoughApplicationError(code); }
function integer(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('PARTITION_HTTP_INVALID');
  return value;
}
function errorBody(code: ErrorCode, requestId: string): Extract<KE.DecisionCommandResult, { ok: false }> {
  return { ok: false, requestId, error: { code, httpStatus: KE.DECISION_ERROR_HTTP_STATUS[code] } };
}
function send(response: ServerResponse, status: number, body: unknown, background = false) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', `application/json; charset=utf-8${background ? `; profile="${BACKGROUND_NEGOTIATION_PROFILE}"` : ''}`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}
async function bounded<T>(work: Promise<T>, milliseconds: number, controller: AbortController): Promise<T> {
  if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, fail) => {
      abort = () => fail(new KnownEnoughApplicationError('RETRYABLE_SERVER_ERROR'));
      controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => controller.abort(), milliseconds);
    })]);
  } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
}
async function body(request: IncomingMessage, maximum: number, milliseconds: number, controller: AbortController) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return reject('INVALID_COMMAND');
  const length = request.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > maximum)) return reject('INVALID_COMMAND');
  const chunks: Buffer[] = []; let size = 0;
  return bounded(new Promise<unknown>((resolve, fail) => {
    function cleanup() {
      request.off('data', data); request.off('end', end); request.off('error', error);
      controller.signal.removeEventListener('abort', aborted);
    }
    function error() { cleanup(); fail(new KnownEnoughApplicationError('INVALID_COMMAND')); }
    function aborted() { cleanup(); fail(new KnownEnoughApplicationError('RETRYABLE_SERVER_ERROR')); }
    function data(chunk: Buffer | string) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximum) { error(); request.resume(); return; }
      chunks.push(bytes);
    }
    function end() {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(new KnownEnoughApplicationError('INVALID_COMMAND')); }
    }
    request.on('data', data); request.once('end', end); request.once('error', error);
    controller.signal.addEventListener('abort', aborted, { once: true });
  }), milliseconds, controller);
}

/** Inactive participant surface. Managed source/control validation must wrap its transports before selection. */
export function createPartitionParticipantApiHandler(options: PartitionParticipantApiOptions) {
  const maximum = integer(options.maxBodyBytes ?? 65_536, 65_536);
  const authMs = integer(options.authTimeoutMs ?? 5_000, 5_000);
  const bodyMs = integer(options.bodyTimeoutMs ?? 5_000, 5_000);
  const concurrency = integer(options.maxConcurrentRequests ?? 8, 8);
  const origins = new Set(options.allowedOrigins);
  if ([...origins].some(origin => {
    const url = URL.parse(origin); return !url || url.origin !== origin || !['http:', 'https:'].includes(url.protocol);
  })) throw new Error('PARTITION_HTTP_INVALID');
  const authenticate = options.authenticate;
  if (typeof authenticate !== 'function') throw new Error('PARTITION_HTTP_INVALID');
  const clock = { now: options.clock.now.bind(options.clock) }; const ids = { next: options.ids.next.bind(options.ids) };
  const registrationProfile = options.registrationProfile;
  const discovery = options.membershipDiscovery;
  const draftArchitect = options.draftArchitect;
  if (discovery !== undefined && typeof discovery !== 'function') throw new Error('PARTITION_HTTP_INVALID');
  if (draftArchitect !== undefined && typeof draftArchitect !== 'function') throw new Error('PARTITION_HTTP_INVALID');
  let active = 0; let authenticating = 0;
  const session = createPartitionGroupSession(options.groups, { ...(options.sharedTestEmailHashes === undefined ? {} : { sharedTestEmailHashes: options.sharedTestEmailHashes }), now: () => Date.parse(clock.now()),
    ...(options.emailKey === undefined ? {} : { emailKey: options.emailKey }),
    ...(options.invitationToken === undefined ? {} : { token: options.invitationToken }),
    ...(draftArchitect === undefined ? {} : { draftArchitect: (subject, input, io, scope) => {
      if (authenticating >= concurrency) return reject('RETRYABLE_SERVER_ERROR');
      authenticating++;
      return Promise.resolve().then(() => {
        if (io.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
        return draftArchitect(subject, input, io, scope);
      }).finally(() => { authenticating--; });
    } }),
    ...(discovery === undefined ? {} : { discovery: (raw, io) => {
      if (authenticating >= concurrency) return reject('RETRYABLE_SERVER_ERROR');
      authenticating++;
      return Promise.resolve().then(() => {
        if (io.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
        return discovery(raw, io);
      }).finally(() => { authenticating--; });
    } }) });
  const repositories = createPartitionDecisionRepository({ decisionArn: options.decisionArn, partitionArn: options.partitionArn,
    groups: options.groups, transport: options.decisions,
    ...(options.legacyPublicDecision ? { legacyPublicDecision: options.legacyPublicDecision } : {}) });
  const displayAccess = options.displayAccess === true;
  const requestNegotiation = options.requestNegotiation;
  if (requestNegotiation !== undefined && typeof requestNegotiation !== 'function') throw new Error('PARTITION_HTTP_INVALID');
  return (request: IncomingMessage, response: ServerResponse): void => {
    const incomingId = request.headers['x-request-id'];
    let requestId = typeof incomingId === 'string' && Id.safeParse(incomingId).success ? incomingId : randomUUID();
    response.setHeader('Vary', 'Origin');
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !origins.has(origin))) {
      send(response, 403, errorBody('FORBIDDEN', requestId)); request.resume(); return;
    }
    if (typeof origin === 'string') response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      response.setHeader('Cache-Control', 'no-store'); response.statusCode = 204; response.end(); return;
    }
    if (active >= concurrency || authenticating >= concurrency) { send(response, 503, errorBody('RETRYABLE_SERVER_ERROR', requestId)); request.resume(); return; }
    active++;
    const controller = new AbortController();
    const closed = () => { if (!response.writableEnded) controller.abort(); };
    request.once('aborted', closed); response.once('close', closed);
    void (async () => {
      try {
        let verified: TrustedPrincipal | null;
        try {
          // A timeout can release the HTTP slot, but cannot release an unresolved provider call.
          authenticating++;
          const authentication = Promise.resolve().then(() => authenticate(request, controller.signal))
            .finally(() => { authenticating--; });
          verified = await bounded(authentication, authMs, controller);
        }
        catch (error) {
          if (controller.signal.aborted) throw error;
          return reject('UNAUTHENTICATED');
        }
        if (!verified) return reject('UNAUTHENTICATED');
        if (!Id.safeParse(verified.subject).success) return reject('FORBIDDEN');
        if (verified.kind === 'display') {
          const url = URL.parse(request.url ?? '', 'http://partition.invalid');
          const selected = url && !url.search && !url.hash ? /^\/decisions\/([A-Za-z0-9_-]{1,80})\/public$/.exec(url.pathname) : null;
          if (!displayAccess || request.method !== 'GET' || !selected || verified.roomId !== selected[1]) return reject('FORBIDDEN');
          const principal = { kind: 'display' as const, subject: verified.subject, roomId: verified.roomId };
          const application = new KnownEnoughApplication({ repository: repositories.forDisplay(principal), clock, ids });
          send(response, 200, await application.getPublicSnapshot(principal, selected[1]!)); return;
        }
        if (verified.kind !== 'participant') return reject('FORBIDDEN');
        const principal = { kind: 'participant' as const, subject: verified.subject };
        if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
        const url = URL.parse(request.url ?? '/', 'http://local.invalid');
        if (!url || url.hash || (url.search && (url.pathname !== '/groups' || request.method !== 'GET'))) return reject('INVALID_COMMAND');
        const memberProfile = /^\/groups\/([A-Za-z0-9_-]{1,80})\/members\/([A-Za-z0-9_-]{1,80})\/profile$/.exec(url.pathname);
        const group = /^\/groups\/([A-Za-z0-9_-]{1,80})(\/(?:remove|invite|invitations))?$/.exec(url.pathname);
        const draft = /^\/groups\/([A-Za-z0-9_-]{1,80})\/drafts(?:\/([A-Za-z0-9_-]{1,80})(\/create)?)?$/.exec(url.pathname);
        const ownerConversation = /^\/decisions\/([A-Za-z0-9_-]{1,80})\/owner-conversation\/(draft|requests\/([A-Za-z0-9_-]{1,80})(\/close)?)$/.exec(url.pathname);
        const decision = /^\/decisions\/([A-Za-z0-9_-]{1,80})\/(public|me|commands)$/.exec(url.pathname);
        const roster = /^\/groups\/([A-Za-z0-9_-]{1,80})\/decisions\/([A-Za-z0-9_-]{1,80})\/(review|revise)$/.exec(url.pathname);
        if (url.pathname === '/account/profile' || url.pathname === '/account/profile/image') {
          if (request.method === 'GET' && url.pathname === '/account/profile') {
            send(response, 200, { profile: await session.ownProfile(principal) }); return;
          }
          if (request.method !== 'POST') return reject('NOT_FOUND');
          await session.ownProfile(principal); // authorize before reading profile/image bytes
          const raw = await body(request, maximum, bodyMs, controller);
          send(response, 200, { profile: await session.updateProfile(principal, raw, url.pathname.endsWith('/image')) }); return;
        }
        if (request.method === 'GET' && url.pathname === '/account') {
          send(response, 200, { account: await session.status(principal) }); return;
        }
        if (request.method === 'GET' && url.pathname === '/groups') {
          const params = url.searchParams;
          if (url.search.length > 2000 || [...params.keys()].some(key => !['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return reject('INVALID_COMMAND');
          const limit = params.get('limit'); const cursor = params.get('cursor');
          if (limit !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(limit)) return reject('INVALID_COMMAND');
          const io = partitionIO();
          const page = await session.list(principal, { ...(limit === null ? {} : { limit: Number(limit) }),
            ...(cursor === null ? {} : { cursor }) }, { ...io, signal: AbortSignal.any([io.signal, controller.signal]) });
          send(response, 200, page); return;
        }
        if (request.method === 'GET' && memberProfile) {
          send(response, 200, { profile: await session.memberProfile(principal, memberProfile[1]!, memberProfile[2]!) }); return;
        }
        if (request.method === 'POST' && url.pathname === '/account/register') {
          if (!registrationProfile) return reject('FORBIDDEN');
          if (authenticating >= concurrency) return reject('RETRYABLE_SERVER_ERROR');
          authenticating++;
          const pending = Promise.resolve().then(() => registrationProfile(request, controller.signal)).finally(() => { authenticating--; });
          let profile;
          try { profile = await bounded(pending, authMs, controller); }
          catch (error) { if (controller.signal.aborted) throw error; return reject('FORBIDDEN'); }
          if (!profile || profile.subject !== principal.subject || profile.verified !== true || typeof profile.email !== 'string') return reject('FORBIDDEN');
          const verifiedProfile = { subject: principal.subject, email: profile.email, verified: true,
            ...(typeof profile.username === 'string' ? { username: profile.username } : {}) };
          const raw = await body(request, maximum, bodyMs, controller);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          send(response, 200, { account: await session.register(principal, verifiedProfile, raw) }); return;
        }
        if (request.method === 'POST' && url.pathname === '/groups/accept') {
          const raw = await body(request, maximum, bodyMs, controller);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          send(response, 200, { group: await session.accept(principal, raw) }); return;
        }
        if (request.method === 'POST' && url.pathname === '/groups') {
          const raw = await body(request, maximum, bodyMs, controller);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          send(response, 200, { group: await session.create(principal, raw) }); return;
        }
        const draftRequest = /^\/groups\/([A-Za-z0-9_-]{1,80})\/draft-requests(?:\/([A-Za-z0-9_-]{1,80})(\/release)?)?$/.exec(url.pathname);
        if (draftRequest && (request.method === 'GET' || request.method === 'POST')) {
          if (Boolean(draftRequest[3]) !== (request.method === 'POST')) return reject('NOT_FOUND');
          const recoveryIO = partitionIO(); const context = { ...recoveryIO, signal: AbortSignal.any([recoveryIO.signal, controller.signal]) };
          await session.inspectDraftRequest(principal, draftRequest[1]!, draftRequest[2], context);
          if (!options.draftRequest) { if (draftArchitect && !draftRequest[2] && request.method === 'GET') { send(response, 200, { requests: [] }); return; } throw new PartitionDraftFailure('AI_UNAVAILABLE'); }
          let revision: number | undefined;
          if (request.method === 'POST') { const raw = await body(request, 1024, bodyMs, controller);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join('|') !== 'revision' || !Number.isSafeInteger((raw as { revision?: unknown }).revision) || Number((raw as { revision: unknown }).revision) < 0) return reject('INVALID_COMMAND');
            revision = Number((raw as { revision: unknown }).revision);
          }
          send(response, 200, await options.draftRequest({ principal, groupId: draftRequest[1]!, ...(draftRequest[2] ? { key: draftRequest[2] } : {}),
            ...(revision !== undefined ? { releaseRevision: revision } : {}), io: context,
            inspect: key => session.inspectDraftRequest(principal, draftRequest[1]!, key, context) })); return;
        }
        if (draft && (request.method === 'GET' || request.method === 'POST')) {
          if (draft[3] && request.method !== 'POST') return reject('NOT_FOUND');
          const io = partitionIO(!draft[2] && request.method === 'POST' ? { timeoutMs: 27000 } : {}); const context = { ...io, signal: AbortSignal.any([io.signal, controller.signal]) };
          if (!draft[2]) {
            if (request.method !== 'POST') return reject('NOT_FOUND');
            await session.roster(principal, draft[1]!, context);
            if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
            const raw = await body(request, maximum, bodyMs, controller);
            if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
            send(response, 200, { draft: await session.generateDraft(principal, draft[1]!, raw, context) }); return;
          }
          // Authenticate and admit the organizer before reading an edit body; commit rechecks the same scope.
          const current = await session.readDraft(principal, draft[1]!, draft[2]!, context);
          if (request.method === 'GET') { send(response, 200, { draft: current }); return; }
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          const raw = await body(request, maximum, bodyMs, controller);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          if (draft[3]) {
            const prepared = await repositories.forDraft(principal, draft[1]!, draft[2]!, raw, context);
            const application = new KnownEnoughApplication({ repository: prepared.repository, clock, ids });
            const decisionId = prepared.definition.decisionId;
            if (prepared.created) {
              if (!await application.getCreatedDecision(principal, decisionId, prepared.creationBodyHash)) return reject('RETRYABLE_SERVER_ERROR');
            } else await application.createDecision({ definition: prepared.definition, memberships: prepared.memberships,
              creatorSubject: principal.subject, creationBodyHash: prepared.creationBodyHash });
            if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
            // Reauthorize the retained directory, group/accounts and decision guard before publication.
            const publication = new KnownEnoughApplication({ repository: repositories.forParticipant(principal, context), clock, ids });
            const snapshot = await publication.getPublicSnapshot(principal, decisionId);
            if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
            send(response, 200, { snapshot }); return;
          }
          send(response, 200, { draft: await session.editDraft(principal, draft[1]!, draft[2]!, raw, context) }); return;
        }
        if (roster) {
          if (!(request.method === 'GET' && roster[3] === 'review') && !(request.method === 'POST' && roster[3] === 'revise')) return reject('NOT_FOUND');
          const io = partitionIO(); const context = { ...io, signal: AbortSignal.any([io.signal, controller.signal]) };
          const review = await repositories.forRoster(principal, roster[1]!, roster[2]!, undefined, context);
          const application = new KnownEnoughApplication({ repository: review.repository, clock, ids });
          const owner = await application.getOwnerSnapshot(principal, roster[2]!);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          const preview = { frame: owner.publicSnapshot.frame, controlVersion: owner.controlVersion,
            groupVersion: review.groupVersion, participants: review.participants.map(person => ({ id: person.id, displayName: person.displayName })) };
          if (request.method === 'GET') { send(response, 200, preview); return; }
          // Organizer and decision membership are verified before the body; revision checks creator authority.
          const raw = await body(request, maximum, bodyMs, controller);
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reject('INVALID_COMMAND');
          const command = raw as Record<string, unknown>;
          if (Object.keys(command).length !== 2 || !Number.isSafeInteger(command.controlVersion) || Number(command.controlVersion) < 0
            || !Number.isSafeInteger(command.groupVersion) || Number(command.groupVersion) < 1) return reject('INVALID_COMMAND');
          if (command.controlVersion !== preview.controlVersion || command.groupVersion !== preview.groupVersion) return reject('STALE_CONTEXT');
          const revision = await repositories.forRoster(principal, roster[1]!, roster[2]!, preview.groupVersion, context);
          if (JSON.stringify(revision.participants) !== JSON.stringify(review.participants)) return reject('STALE_CONTEXT');
          const definition = KE.DecisionDefinition.parse({ ...preview.frame, frameVersion: preview.frame.frameVersion + 1,
            semanticVersion: preview.frame.semanticVersion + 1, participants: revision.participants,
            requiredParticipantIds: revision.participants.map(person => person.id),
            variables: preview.frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) });
          const writer = new KnownEnoughApplication({ repository: revision.repository, clock, ids });
          await writer.reviseDecision(principal, { decisionId: roster[2]!, expectedControlVersion: preview.controlVersion,
            definition, memberships: revision.memberships });
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          const publication = new KnownEnoughApplication({ repository: repositories.forParticipant(principal, context), clock, ids });
          const snapshot = await publication.getPublicSnapshot(principal, roster[2]!);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          send(response, 200, { snapshot }); return;
        }
        if (group && request.method === 'GET' && !group[2]) {
          send(response, 200, { group: await session.snapshot(principal, group[1]!) }); return;
        }
        if (group && request.method === 'POST' && group[2]) {
          const raw = await body(request, maximum, bodyMs, controller);
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          if (group[2] === '/invitations') send(response, 200, await session.invite(principal, group[1]!, raw));
          else if (group[2] === '/invite') send(response, 200, { invitation: await session.invite(principal, group[1]!, raw) });
          else send(response, 200, { group: await (raw && typeof raw === 'object' && Object.hasOwn(raw, 'kind')
            ? session.removeItem(principal, group[1]!, raw) : session.remove(principal, group[1]!, raw)) }); return;
        }
        if (ownerConversation) {
          if (!options.ownerInterpretation || (ownerConversation[2] === 'draft' || ownerConversation[4] ? request.method !== 'POST' : request.method !== 'GET')) return reject('NOT_FOUND');
          const io = partitionIO({ timeoutMs: 27000 }); const context = { ...io, signal: AbortSignal.any([io.signal, controller.signal]) };
          const application = new KnownEnoughApplication({ repository: repositories.forParticipant(principal, context), clock, ids });
          await application.getOwnerSnapshot(principal, ownerConversation[1]!);
          let messages: unknown; let closeRevision: number | undefined;
          if (ownerConversation[2] === 'draft') {
            const raw = await body(request, maximum, bodyMs, controller);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join('|') !== 'messages|processingConsent|requestId') return reject('INVALID_COMMAND');
            const value = raw as Record<string, unknown>;
            if (value.processingConsent !== 'SYNTHETIC_TEST' || !Id.safeParse(value.requestId).success || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 12) return reject('INVALID_COMMAND');
            let total = 0;
            for (const message of value.messages) {
              if (!message || typeof message !== 'object' || Object.keys(message).sort().join('|') !== 'role|text'
                || !['owner', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 2000) return reject('INVALID_COMMAND');
              total += message.text.length;
            }
            if (total > 8000 || value.messages.at(-1)?.role !== 'owner') return reject('INVALID_COMMAND');
            requestId = value.requestId as string; messages = value.messages;
          } else {
            requestId = ownerConversation[3]!;
            if (ownerConversation[4]) {
              const raw = await body(request, maximum, bodyMs, controller);
              if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join('|') !== 'revision'
                || !('revision' in raw) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) return reject('INVALID_COMMAND');
              closeRevision = Number(raw.revision);
            }
          }
          const result = await options.ownerInterpretation({ principal, decisionId: ownerConversation[1]!, requestId, ...(messages === undefined ? {} : { messages, acceptedSynthetic: true }), ...(closeRevision === undefined ? {} : { closeRevision }), io: context });
          send(response, 200, { requestId, interpretation: result, ...(result.state === 'SAVED' ? { draft: result.draft } : {}) }); return;
        }
        if (!decision || (request.method === 'GET' ? decision[2] === 'commands' : request.method !== 'POST' || decision[2] !== 'commands')) return reject('NOT_FOUND');
        // Fresh request-specific repository; no shared principal, raw application or provisioning port escapes.
        const repository = repositories.forParticipant(principal);
        const application = new KnownEnoughApplication({ repository, clock, ids });
        if (request.method === 'GET') {
          const snapshot = decision[2] === 'public' ? await application.getPublicSnapshot(principal, decision[1]!)
            : await application.getOwnerSnapshot(principal, decision[1]!);
          send(response, 200, snapshot, decision[2] === 'public' && requestNegotiation !== undefined); return;
        }
        // Preserve the existing pre-body scope check; execute rechecks and joins guards at the actual commit.
        await application.getPublicSnapshot(principal, decision[1]!);
        if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
        const raw = await body(request, maximum, bodyMs, controller);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const supplied = (raw as Record<string, unknown>).requestId;
          if (typeof supplied === 'string' && Id.safeParse(supplied).success) requestId = supplied;
        }
        if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'REQUEST_NEGOTIATION') {
          const queued = RequestNegotiation.safeParse(raw);
          if (!queued.success || queued.data.decisionId !== decision[1]) return reject('INVALID_COMMAND');
          if (!requestNegotiation) return reject('RETRYABLE_SERVER_ERROR');
          const result = await requestNegotiation({ principal, decisionId: decision[1]!, expected: queued.data.expected,
            signal: controller.signal,
            authorize: async () => { await application.getOwnerSnapshot(principal, decision[1]!); },
            read: () => repository.transactionDecision(decision[1]!, record => record ? structuredClone(record) : null),
            begin: () => application.startReasoning({ kind: 'service', subject: 'durable-negotiator', roomIds: [decision[1]!] }, decision[1]!) });
          if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
          const receipt = NegotiationReceipt.parse(result);
          send(response, 200, { ok: true, requestId: queued.data.requestId, job: receipt }); return;
        }
        const command = KE.DecisionCommand.safeParse(raw);
        if (!command.success || command.data.decisionId !== decision[1]!) return reject('INVALID_COMMAND');
        requestId = command.data.requestId;
        if (controller.signal.aborted) return reject('RETRYABLE_SERVER_ERROR');
        const result = await application.execute(principal, command.data);
        send(response, result.ok ? 200 : result.error.httpStatus, result);
      } catch (error) {
        if (error instanceof PartitionRegistrationConflict) {
          send(response, 409, { ok: false, requestId, error: { code: 'FORBIDDEN', httpStatus: 409 }, registrationFailure: 'EMAIL_ALREADY_LINKED' });
          return;
        }
        const code = error instanceof RepositoryCapacityError || (error instanceof PartitionSessionError && error.code === 'SESSION_CAPACITY') ? 'CAPACITY_EXCEEDED'
          : error instanceof KnownEnoughApplicationError ? error.code : 'RETRYABLE_SERVER_ERROR';
        const result = errorBody(code, requestId); send(response, result.error.httpStatus, error instanceof PartitionDraftFailure ? { ...result, draftFailure: error.category } : error instanceof PartitionOwnerFailure ? { ...result, interpretationFailure: error.category } : result);
      } finally {
        active--; request.off('aborted', closed); response.off('close', closed); request.resume();
      }
    })();
  };
}
