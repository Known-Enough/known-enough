import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';

async function readResponseJson(response, timeout = 5000) {
  let timer;
  try {
    return await Promise.race([response.json(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('RESPONSE_BODY_TIMEOUT'), {
        code: 'RESPONSE_BODY_TIMEOUT', domain: 'AUTOMATION',
      })), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

// Playwright Response exposes its HTTP method through request(), not method().
export function groupsResponse(response) {
  const url = new URL(response.url());
  return response.request().method() === 'GET' && response.status() === 200
    && url.hostname.endsWith('.execute-api.us-east-1.amazonaws.com')
    && /\/groups$/.test(url.pathname);
}
export function waitForGroups(page, timeout = 45000) {
  // Surface actual account/groups failures immediately, rather than waiting for
  // a successful groups response that the app will never request after failure.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response) => {
      if (settled) return; settled = true; clearTimeout(timer);
      page.off('response', onResponse); page.off('close', onClose);
      if (error) reject(error); else resolve(response);
    };
    const onClose = () => finish(Object.assign(new Error('PAGE_CLOSED'), { domain: 'AUTOMATION' }));
    const onResponse = async response => {
      if (groupsResponse(response)) { finish(null, response); return; }
      const url = new URL(response.url());
      if (response.request().method() !== 'GET' || !safeRoute(response.url())
        || !/^\/(account|groups)$/.test(url.pathname) || response.status() < 400) return;
      // Another response observer records JSON asynchronously. Do not read the
      // same body here: a locked stream can leave sign-in waiting until timeout.
      finish(Object.assign(new Error('APP_HTTP_' + response.status()), {
        code: 'APP_HTTP_' + response.status(), domain: 'APP_HTTP', status: response.status(), route: safeRoute(response.url()),
      }));
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('AUTHENTICATED_GROUP_READ_TIMEOUT'), {
      domain: 'AUTOMATION', code: 'AUTHENTICATED_GROUP_READ_TIMEOUT',
    })), timeout);
    page.on('response', onResponse); page.once('close', onClose);
  });
}
function loadedDecisionDialog(page, decisionId) {
  if (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(decisionId)) {
    throw Object.assign(new Error('DECISION_ID_INVALID'), { code: 'DECISION_ID_INVALID', domain: 'AUTOMATION' });
  }
  return page.locator(`dialog[open].ke-open-decision-dialog[data-decision-id="${decisionId}"]`);
}
export async function waitForDecisionReady(page, decisionId, title, timeout = 15000) {
  // The loading shell also has #open-decision-title. Require the acknowledged
  // decision's loaded identity and expected heading before checking its form.
  const dialog = loadedDecisionDialog(page, decisionId);
  try { await dialog.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout }); }
  catch (cause) {
    throw Object.assign(new Error('DECISION_VIEW_NOT_READY', { cause }), {
      code: 'DECISION_VIEW_NOT_READY', domain: 'AUTOMATION',
    });
  }
}
export function existingFixtureReadback(groups, fixture) {
  const groupMatches = groups.filter(group => group.id === fixture?.groupId);
  if (groupMatches.length !== 1) return { group: groupMatches.length === 0 ? 'MISSING' : 'AMBIGUOUS' };
  const group = groupMatches[0];
  const decisions = group.decisions.filter(item => item.id === fixture.decisionId);
  const drafts = group.drafts.filter(item => item.id === fixture.draftId);
  return {
    group: 'PRESENT',
    memberCount: group.members.length,
    decision: decisions.length === 1 ? 'PRESENT' : decisions.length === 0 ? 'MISSING' : 'AMBIGUOUS',
    decisionTitleMatches: decisions.length === 1 && decisions[0].title === 'Friday activity',
    draft: drafts.length === 1 ? 'PRESENT' : drafts.length === 0 ? 'MISSING' : 'AMBIGUOUS',
  };
}
export function safeRoute(raw) {
  const url = new URL(raw);
  if (!url.hostname.endsWith('.execute-api.us-east-1.amazonaws.com')) return null;
  const parts = url.pathname.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (['groups', 'decisions', 'members', 'drafts', 'draft-requests', 'jobs', 'requests'].includes(parts[i - 1])
      && !['accept', 'invitations', 'drafts'].includes(parts[i])) parts[i] = ':id';
  }
  return parts.join('/');
}
export function atomicJson(file, value) {
  const temporary = file + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
export class Recorder {
  constructor(directory, run) {
    this.directory = path.resolve(directory); this.run = run;
    fs.mkdirSync(this.directory, { recursive: true });
    this.summaryFile = path.join(this.directory, 'summary.json');
    this.summary = fs.existsSync(this.summaryFile) ? JSON.parse(fs.readFileSync(this.summaryFile, 'utf8'))
      : { runId: run, state: 'RUNNING', startedAt: new Date().toISOString(), endedAt: null,
        cases: { '01': 'NOT_RUN', '02': 'NOT_RUN', '03': 'NOT_RUN' }, lastConfirmedAction: null,
        inFlightAction: null, observedRequests: { outcome: 0, assistant: 0 }, error: null };
  }
  event(event, fields = {}) {
    const value = { utc: new Date().toISOString(), run: this.run, event, ...fields };
    const fd = fs.openSync(path.join(this.directory, 'events.jsonl'), 'a', 0o600);
    try { fs.writeSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.summary.lastProgressAt = value.utc;
    atomicJson(this.summaryFile, this.summary);
    return value;
  }
  async step(actor, action, page, work) {
    this.summary.inFlightAction = action;
    this.event('ACTION_INTENT', { actor, action });
    const started = Date.now();
    try {
      const actual = await work();
      this.summary.lastConfirmedAction = action; this.summary.inFlightAction = null;
      return this.event('ACTION_RESULT', { actor, action, state: 'VERIFIED', durationMs: Date.now() - started, actual });
    } catch (error) {
      // Capture before browser/context shutdown, even when authentication failed.
      let screenshot = 'PAGE_UNAVAILABLE';
      const captures = fs.readdirSync(this.directory).filter(file => file.endsWith('.png')).length;
      if (page && !page.isClosed() && captures < 2) {
        const file = action.replace(/[^a-zA-Z0-9._-]/g, '_') + '-failure.png';
        try {
          await page.screenshot({ path: path.join(this.directory, file), timeout: 5000,
            mask: [page.locator('input, textarea, .ke-group-list, [class*="avatar"], .ke-response-progress li')],
            animations: 'disabled' });
          screenshot = file;
        } catch (captureError) { screenshot = 'CAPTURE_FAILED:' + captureError.name; }
      }
      if (captures >= 2) screenshot = 'SCREENSHOT_LIMIT_REACHED';
      const diagnostic = { code: error.code || error.name || 'Error',
        domain: error.domain || 'AUTOMATION', stage: action, screenshot,
        ...(error.domain === 'APP_HTTP' ? { status: error.status, route: error.route,
          serverCode: error.serverCode, reference: error.reference } : {}),
        pageOrigin: page && !page.isClosed() ? new URL(page.url()).origin : null };
      this.summary.error ??= diagnostic; this.summary.lastError = diagnostic; this.summary.inFlightAction = null;
      this.event('ACTION_RESULT', { actor, action, state: 'FAILED', durationMs: Date.now() - started,
        diagnostic, message: 'See the last STEP and normalized HTTP events; raw errors are kept private.' });
      throw error;
    }
  }
}

export async function serve(options, recorder) {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    recorder.event('STARTUP_FAILED', { code: 'NODE20_OR_NEWER_REQUIRED', browserStarted: false });
    throw new Error('NODE20_OR_NEWER_REQUIRED');
  }
  const credentials = JSON.parse(fs.readFileSync(options.credentials, 'utf8')).users;
  if (!Array.isArray(credentials) || credentials.length !== 2) throw new Error('TWO_SYNTHETIC_USERS_REQUIRED');
  const privateDir = path.resolve(options['private-dir']); fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const require = createRequire(path.join(path.resolve(options.dependencies || '.'), 'package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const users = new Map(); let fixture = null; let halted = Boolean(recorder.summary.error);
  const fixtureFile = path.join(privateDir, 'fixture.json');
  if (fs.existsSync(fixtureFile)) fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const persistFixture = () => atomicJson(fixtureFile, fixture);
  for (const [index, actor] of ['U1', 'U2'].entries()) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
    const user = { page, context, credential: credentials[index], groups: [], catalogReads: new Set(), catalogReadError: null, writes: 0 };
    users.set(actor, user);
    context.on('request', request => {
      const route = safeRoute(request.url()); if (!route) return;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) user.writes++;
      recorder.event('HTTP_REQUEST', { actor, route, method: request.method() });
    });
    context.on('response', response => {
      const route = safeRoute(response.url()); if (!route) return;
      recorder.event('HTTP_RESPONSE', { actor, route, method: response.request().method(), status: response.status() });
      // Parse only catalogs needed for fixture reconciliation. Waiting on every
      // old response body can hang after navigation aborts an earlier request.
      if (groupsResponse(response)) {
        const task = readResponseJson(response).then(body => {
          if (!Array.isArray(body.groups)) throw Object.assign(new Error('GROUP_CATALOG_INVALID'), {
            code: 'GROUP_CATALOG_INVALID', domain: 'AUTOMATION',
          });
          for (const group of body.groups) {
            const at = user.groups.findIndex(value => value.id === group.id);
            if (at < 0) user.groups.push(group); else user.groups[at] = group;
          }
        }).catch(error => {
          user.catalogReadError = error;
          recorder.event('CATALOG_READ_FAILED', { actor, code: error.code || 'RESPONSE_BODY_UNAVAILABLE' });
        }).finally(() => user.catalogReads.delete(task));
        user.catalogReads.add(task);
      } else if (response.request().method() === 'GET' && response.status() >= 400
        && /^\/(account(?:\/profile)?|groups)$/.test(route)) {
        // This observer is the only consumer of these GET error bodies. Export
        // only the server UUID/category so a failure can be matched to logs.
        void readResponseJson(response, 3000).then(body => {
          const reference = typeof body.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.requestId)
            ? body.requestId : null;
          const codes = ['RETRYABLE_SERVER_ERROR', 'FORBIDDEN', 'UNAUTHENTICATED', 'CAPACITY_EXCEEDED', 'STALE_CONTEXT'];
          recorder.event('HTTP_FAILURE_DETAILS', { actor, route, status: response.status(), reference,
            serverCode: codes.includes(body.error?.code) ? body.error.code : 'UNAVAILABLE' });
        }).catch(() => recorder.event('HTTP_FAILURE_DETAILS_UNAVAILABLE', { actor, route, status: response.status() }));
      }
    });
    context.on('requestfailed', request => {
      const route = safeRoute(request.url()); if (route) recorder.event('HTTP_FAILED', {
        actor, route, method: request.method(), code: request.failure()?.errorText || 'UNKNOWN' });
    });
    page.on('pageerror', error => recorder.event('PAGE_ERROR', { actor, code: error.name }));
    page.on('close', () => recorder.event('PAGE_CLOSED', { actor }));
  }
  const mark = (actor, stage) => recorder.event('STEP', { actor, stage });
  const settle = async user => {
    await Promise.allSettled([...user.catalogReads]);
    if (user.catalogReadError) throw user.catalogReadError;
  };
  const login = async (actor, user) => {
    const page = user.page;
    if (user.groups.length) return { authenticated: true, groupCount: user.groups.length, session: 'EXISTING_LIVE_CONTEXT' };
    mark(actor, 'navigate'); await page.goto(options.site, { waitUntil: 'domcontentloaded' });
    mark(actor, 'wait-hydrated-sign-in'); const entry = page.getByRole('button', { name: 'Sign in', exact: true }).first();
    await entry.waitFor({ state: 'visible' }); await entry.click();
    await page.getByLabel('Username', { exact: true }).waitFor({ state: 'visible' });
    await page.getByLabel('Username', { exact: true }).fill(user.credential.username);
    await page.getByLabel('Password', { exact: true }).fill(user.credential.password);
    // Listener precedes dispatch; handle rejection immediately to avoid an unhandled promise.
    const ready = waitForGroups(page).then(value => ({ value }), error => ({ error }));
    mark(actor, 'submit-sign-in'); await page.locator('form.ke-auth-form button[type="submit"]').click();
    mark(actor, 'wait-authenticated-groups'); const result = await ready;
    if (result.error) throw result.error;
    await settle(user); await page.getByRole('heading', { name: 'Decision groups', exact: true }).waitFor({ state: 'visible' });
    return { authenticated: true, groupCount: user.groups.length, session: 'SAME_LIVE_CONTEXT' };
  };
  const openGroup = async (actor, user) => {
    if (!fixture) throw new Error('FIXTURE_NOT_SELECTED');
    const page = user.page;
    // A reload in this same page preserves the app's sessionStorage; no storageState serialization.
    user.groups = []; user.catalogReadError = null;
    mark(actor, 'refresh-same-session'); await page.goto(options.site, { waitUntil: 'domcontentloaded' });
    const row = page.getByRole('button', { name: `Open group ${fixture.groupName}`, exact: true });
    await row.waitFor({ state: 'visible' }); await row.click();
    await page.getByRole('heading', { name: fixture.groupName, exact: true }).waitFor({ state: 'visible' });
    await settle(user); return { groupOpened: true };
  };
  const operations = {
    login,
    async reconcile() {
      const u1 = users.get('U1'), u2 = users.get('U2'); await settle(u1); await settle(u2);
      if (!u1.groups.length || !u2.groups.length) throw new Error('BOTH_AUTHENTICATED_CATALOGS_REQUIRED');
      if (fixture?.decisionId) {
        const readbacks = [u1, u2].map(user => existingFixtureReadback(user.groups, fixture));
        if (readbacks.some(item => item.group !== 'PRESENT' || item.memberCount !== 2
          || item.decision !== 'PRESENT' || !item.decisionTitleMatches)) {
          throw Object.assign(new Error('EXISTING_FIXTURE_NOT_SAFE_TO_RESUME'), {
            code: 'EXISTING_FIXTURE_NOT_SAFE_TO_RESUME', domain: 'AUTOMATION',
          });
        }
        return { existingFixture: true, bothUsersSeeGroup: true, bothUsersSeeDecision: true,
          originalDraftVisibleToBoth: readbacks.every(item => item.draft === 'PRESENT'),
          noNewGroupOrDecision: true };
      }
      const matches = [u1, u2].flatMap(user => user.groups.flatMap(group => [...group.decisions, ...group.drafts]
        .filter(item => item.title === 'Friday activity')));
      if (matches.length) throw new Error('EXISTING_FRIDAY_FIXTURE_REQUIRES_RECONCILIATION');
      const other = new Set(u2.groups.map(group => group.id));
      const group = u1.groups.filter(group => group.isOrganizer && group.members.length === 2 && other.has(group.id))
        .sort((a, b) => a.decisions.length - b.decisions.length)[0];
      if (!group) throw new Error('SHARED_TWO_MEMBER_GROUP_REQUIRED');
      fixture = { groupId: group.id, groupName: group.name, run: recorder.run }; persistFixture();
      return { priorFixtureMatches: 0, selectedSharedGroup: true, members: 2, mapping: 'PRIVATE_FILE' };
    },
    'open-group': openGroup,
    async refresh(actor, user) {
      const ready = waitForGroups(user.page).then(value => ({ value }), error => ({ error }));
      user.groups = []; user.catalogReadError = null;
      // A decision URL may not load /groups. Return to the catalog in the SAME
      // authenticated context, then wait only for its bounded catalog read.
      mark(actor, 'explicit-read-only-groups-refresh'); await user.page.goto(options.site, { waitUntil: 'domcontentloaded' });
      const result = await ready; if (result.error) throw result.error;
      await settle(user); return { authenticatedGroupsRead: true, groupCount: user.groups.length };
    },
    async inspect(actor, user) {
      await settle(user);
      const page = user.page;
      const information = await page.locator('body').evaluate(root => ({
        headings: [...root.querySelectorAll('h2,h3')].map(element => element.textContent),
        buttons: [...root.querySelectorAll('button')].filter(element => element.getBoundingClientRect().width)
          .map(element => ({ text: element.textContent, label: element.getAttribute('aria-label'), disabled: element.disabled })),
        inputs: [...root.querySelectorAll('input,textarea')].map(element => ({ id: element.id, type: element.type,
          label: element.labels?.[0]?.textContent, checked: element.checked })),
        dialogs: [...root.querySelectorAll('dialog[open]')].map(element => ({ label: element.getAttribute('aria-label') })),
      }));
      atomicJson(path.join(privateDir, actor + '-inspection.json'), information);
      return { inspection: 'PRIVATE_FILE', headingCount: information.headings.length, writes: user.writes };
    },
    async 'fill-draft'(actor, user) {
      const page = user.page;
      mark(actor, 'open-creation'); await page.getByRole('button', { name: 'Start a decision', exact: true }).click();
      await page.getByLabel('Describe the decision', { exact: true }).fill('Choose one activity for our group.');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Review your options', exact: true }).waitFor({ state: 'visible' });
      await page.getByLabel('Decision name', { exact: true }).fill('Friday activity');
      await page.getByText('Topic details', { exact: true }).click();
      await page.getByLabel('Topic name', { exact: true }).fill('Activity');
      const options = page.locator('[data-topic="0"] [data-option-input]');
      // New drafts can already contain blank options. Fill existing rows before adding more.
      while (await options.count() < 2) await page.getByRole('button', { name: 'Add option', exact: true }).click();
      if (await options.count() !== 2) throw new Error('UNEXPECTED_OPTION_COUNT');
      await options.nth(0).fill('Walk'); await options.nth(1).fill('Board games');
      return { manualChoicesPrepared: true, topics: 1, options: 2, writes: user.writes };
    },
    async 'save-draft'(actor, user) {
      const page = user.page;
      const response = page.waitForResponse(value => value.request().method() === 'POST'
        && /\/groups\/[^/]+\/drafts$/.test(new URL(value.url()).pathname), { timeout: 25000 });
      response.catch(() => {});
      mark(actor, 'dispatch-save-draft-once'); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      const result = await response; await settle(user);
      if (!result.ok()) throw new Error('DRAFT_HTTP_' + result.status());
      const body = await result.json(); fixture.draftId = body.draft?.id; persistFixture();
      if (!fixture.draftId) throw new Error('MISSING_DRAFT_ACK');
      await page.getByText('Draft saved', { exact: true }).waitFor({ state: 'visible' });
      return { status: result.status(), draftAcknowledged: true, uiSaved: true };
    },
    async 'create-decision'(actor, user) {
      if (!fixture) throw new Error('FIXTURE_NOT_SELECTED');
      const page = user.page;
      const response = page.waitForResponse(value => value.request().method() === 'POST'
        && /\/groups\/[^/]+\/drafts\/[^/]+\/create$/.test(new URL(value.url()).pathname), { timeout: 30000 });
      response.catch(() => {});
      mark(actor, 'create-manual-decision-once');
      await page.getByRole('button', { name: 'Create decision', exact: true }).click();
      const result = await response;
      let body = {}; try { body = await result.json(); } catch { /* status remains evidence */ }
      if (!result.ok()) {
        const error = new Error('DECISION_CREATE_HTTP_' + result.status());
        error.domain = 'APP_HTTP'; error.status = result.status(); error.route = safeRoute(result.url());
        const safe = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
        error.serverCode = safe(body.error?.code); error.reference = safe(body.requestId); throw error;
      }
      const decisionId = body.snapshot?.frame?.decisionId;
      if (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(decisionId)) throw new Error('DECISION_CREATE_ACK_MISSING_ID');
      fixture.decisionId = decisionId; persistFixture();
      await waitForDecisionReady(page, fixture.decisionId, 'Friday activity');
      return { status: result.status(), decisionCreated: true, title: 'Friday activity', requiredParticipants: 2 };
    },
    async 'open-created-decision'(actor, user) {
      if (!fixture?.decisionId) throw new Error('DECISION_NOT_CREATED');
      const page = user.page;
      if (actor === 'U2' || !(await loadedDecisionDialog(page, fixture.decisionId).isVisible())) {
        await openGroup(actor, user);
        const row = page.locator('.ke-decision-row-open').filter({ hasText: 'Friday activity' });
        await row.waitFor({ state: 'visible' });
        if (await row.count() !== 1) throw new Error('EXISTING_DECISION_ROW_AMBIGUOUS');
        await row.click();
      }
      await waitForDecisionReady(page, fixture.decisionId, 'Friday activity');
      return { decisionOpened: true, actor };
    },
    async 'save-answer'(actor, user) {
      if (!fixture?.decisionId) throw new Error('DECISION_NOT_CREATED');
      const page = user.page;
      const choices = actor === 'U1' ? ['Board games'] : ['Walk', 'Board games'];
      for (const choice of choices) {
        const option = page.locator('.ke-response-option').filter({ hasText: choice }).locator('input[type="checkbox"]');
        await option.check();
      }
      await page.locator('.ke-response-consent input[type="checkbox"]').check();
      const response = page.waitForResponse(value => value.request().method() === 'POST'
        && /\/decisions\/[^/]+\/commands$/.test(new URL(value.url()).pathname), { timeout: 30000 });
      response.catch(() => {});
      mark(actor, 'save-private-answer-once');
      await page.getByRole('button', { name: 'Save answers', exact: true }).click();
      const result = await response; let body = {}; try { body = await result.json(); } catch { /* status remains evidence */ }
      if (!result.ok()) {
        const error = new Error('PRIVATE_ANSWER_HTTP_' + result.status());
        error.domain = 'APP_HTTP'; error.status = result.status(); error.route = safeRoute(result.url());
        const safe = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
        error.serverCode = safe(body.error?.code); error.reference = safe(body.requestId); throw error;
      }
      await page.locator('.ke-saved-answers').waitFor({ state: 'visible', timeout: 15000 });
      const ownSummary = await page.locator('.ke-saved-answer-topics').innerText();
      if (choices.some(choice => !ownSummary.includes(choice))) throw new Error('PRIVATE_ANSWER_READBACK_MISMATCH');
      return { status: result.status(), privateAnswerSaved: true, ownReadback: true, selectedCount: choices.length };
    },
    async 'answer-state'(actor, user) {
      if (!fixture?.decisionId) throw new Error('DECISION_NOT_CREATED');
      const dialog = loadedDecisionDialog(user.page, fixture.decisionId);
      await dialog.waitFor({ state: 'visible' });
      const saved = await dialog.locator('.ke-saved-answers').isVisible();
      const editor = await dialog.locator('.ke-response-sheet').isVisible();
      return { ownSavedAnswerPresent: saved, answerEditorVisible: editor,
        safeToSaveOnce: !saved && editor };
    },
  };
  console.log(JSON.stringify({ ready: true, run: recorder.run, actors: ['U1', 'U2'] }));
  const input = createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) {
    let command;
    try {
      command = JSON.parse(line); const actor = command.actor || 'U1'; const user = users.get(actor);
      if (command.operation === 'close') break;
      if (!user || !Object.hasOwn(operations, command.operation)) throw new Error('UNSUPPORTED_COMMAND');
      if (halted && !['inspect', 'refresh'].includes(command.operation)) {
        recorder.event('ACTION_SKIPPED', { actor, action: command.operation, reason: 'PRIOR_STEP_FAILED_REVIEW_REQUIRED' });
        console.log(JSON.stringify({ state: 'SKIPPED', reason: 'PRIOR_STEP_FAILED_REVIEW_REQUIRED' })); continue;
      }
      const action = command.action || actor.toLowerCase() + '.' + command.operation;
      const result = await recorder.step(actor, action, user.page, () => operations[command.operation](actor, user, command));
      if (command.operation === 'refresh') halted = false;
      console.log(JSON.stringify(result));
    } catch (error) {
      halted = true;
      if (command) atomicJson(path.join(privateDir, 'last-error.json'), { operation: command.operation,
        name: error.name, message: String(error.message), stack: String(error.stack) });
      console.log(JSON.stringify({ state: 'FAILED', code: recorder.summary.lastError?.code || error.name,
        diagnostic: 'PRIVATE_ERROR_AND_PUBLIC_STEP_LEDGER' }));
    }
  }
  input.close(); await browser.close();
  recorder.event('RUNNER_STOPPED', { browserClosed: true });
}

async function main() {
  const { values } = parseArgs({ options: { prepare: { type: 'boolean' }, serve: { type: 'boolean' },
    credentials: { type: 'string' }, evidence: { type: 'string' }, 'private-dir': { type: 'string' },
    dependencies: { type: 'string' }, site: { type: 'string', default: 'https://main.d143q5ravxp5av.amplifyapp.com/' } } });
  if (!values.evidence) throw new Error('EVIDENCE_DIRECTORY_REQUIRED');
  const recorder = new Recorder(values.evidence, path.basename(path.resolve(values.evidence)));
  if (values.prepare) {
    recorder.event('RUN_STARTED', { scope: 'E2E03; two users; one manual decision; outcome <=1; assistant <=1',
      next: 'Record current serving publication and reconcile the existing fixture before any write.' });
    fs.writeFileSync(path.join(recorder.directory, 'report.md'), '# E2E03 new run\n\nRUNNING. Startup journal and summary created before browser actions.\n\nRecord the current serving publication and latest report, then reconcile the existing fixture and both owners before any write. This startup record claims no diagnosed cause or completed product step.\n\n| Case | Result |\n| --- | --- |\n| 01 — two private saves | NOT_RUN |\n| 02 — one outcome/two approvals | NOT_RUN |\n| 03 — optional assistant | NOT_RUN |\n\n[Events](events.jsonl) · [Summary](summary.json)\n');
    console.log(JSON.stringify({ state: 'PREPARED', run: recorder.run }));
  } else if (values.serve) await serve(values, recorder);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.log(JSON.stringify({ state: 'STARTUP_FAILED', code: error.name })); process.exitCode = 1; });
}
