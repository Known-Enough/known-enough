import { useRef, useState, type FormEvent } from 'react';
import { KnownEnough } from '@deal-table/contracts';
import type { KnownEnough as KE } from '@deal-table/contracts';
import type { LocalOwnerDraft, LocalOwnerInterpreter } from './owner-conversation-mock.ts';
import { localTestFetch, type LocalTestSession } from './local-test-session';

type DecisionView = 'overview' | 'private' | 'proposal';
type LocalDecision = {
  draftId: string;
  revision: number;
  status: 'DEFINING' | 'NEEDS_CLARIFICATION';
  frame: KE.PublicDecisionFrame;
  clarificationQuestions: string[];
  participantInformationRequirements: { participantId: string; prompt: string }[];
};
type ArchitectResponse = { requestId: string; draft: LocalDecision };
type ChristmasDemoData = { publicSnapshot: KE.PublicDecisionSnapshot; ownerSnapshot: KE.OwnerDecisionSnapshot };

const CHRISTMAS_DEMO_ID = 'christmas-decision';
const LOCAL_API = 'http://127.0.0.1:8788';

function describeDemoValue(value: KE.DecisionValue, variable: (KE.PublicDecisionSnapshot['frame']['variables'][number] | KE.DecisionVariable) | undefined): string {
  if (value.type === 'ENUM' && variable?.type === 'ENUM') return variable.options.find(item => item.id === value.optionId)?.label ?? 'an option';
  if (value.type === 'ENUM_SET' && variable?.type === 'ENUM_SET') return value.optionIds.map(id => variable.options.find(item => item.id === id)?.label ?? id).join(', ');
  if (value.type === 'MONEY') return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / (10 ** value.minorUnit));
  if (value.type === 'DATE') return value.date;
  if (value.type === 'DURATION') return `${Math.round(value.seconds / 86_400)} days`;
  if (value.type === 'NUMBER') return `${value.coefficient / (10 ** value.scale)} ${value.unitCode}`;
  if (value.type === 'PERCENTAGE') return `${value.basisPoints / 100}%`;
  if (value.type === 'BOOLEAN') return value.value ? 'yes' : 'no';
  return 'the proposed value';
}

function describeDemoRule(rule: KE.ValidationRule, variables: Array<KE.PublicDecisionSnapshot['frame']['variables'][number] | KE.DecisionVariable>): string {
  const variableId = 'variableId' in rule ? rule.variableId : '';
  const variable = variables.find(item => item.id === variableId);
  const label = variable?.label ?? 'this condition';
  if (rule.operator === 'COMPARE') return `${label} ${rule.comparison} ${describeDemoValue(rule.value, variable)}`;
  if (rule.operator === 'IN') return `${label} is one of ${rule.values.map(value => describeDemoValue(value, variable)).join(', ')}`;
  return label;
}

const privacyPromise = 'Your private inputs are processed by Known Enough to help the group reach a decision. Other participants do not receive those inputs unless you explicitly approve a disclosure or the final agreed outcome inherently reveals something.';
const ARCHITECT_URL = 'http://127.0.0.1:8788/decisions/architecture/draft';

function parseResponse(value: unknown): ArchitectResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response');
  const response = value as Record<string, unknown>;
  const raw = response.draft;
  if (typeof response.requestId !== 'string' || raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid response');
  const draft = raw as Record<string, unknown>;
  const frame = KnownEnough.PublicDecisionFrame.parse(draft.frame);
  if (typeof draft.draftId !== 'string' || !Number.isSafeInteger(draft.revision)
    || (draft.status !== 'DEFINING' && draft.status !== 'NEEDS_CLARIFICATION')
    || !Array.isArray(draft.clarificationQuestions) || !draft.clarificationQuestions.every(item => typeof item === 'string')
    || !Array.isArray(draft.participantInformationRequirements)) throw new Error('invalid response');
  const participantIds = new Set(frame.participants.map(person => person.id));
  const requirements = draft.participantInformationRequirements.map(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid response');
    const value = item as Record<string, unknown>;
    if (typeof value.participantId !== 'string' || !participantIds.has(value.participantId)
      || typeof value.prompt !== 'string') throw new Error('invalid response');
    return { participantId: value.participantId, prompt: value.prompt };
  });
  return {
    requestId: response.requestId,
    draft: {
      draftId: draft.draftId, revision: draft.revision as number,
      status: draft.status, frame, clarificationQuestions: draft.clarificationQuestions as string[],
      participantInformationRequirements: requirements,
    },
  };
}

export function KnownEnoughHome({
  ownerInterpreter, session, onSignOut, onSessionExpired, pendingInviteToken, onInviteHandled,
}: {
  ownerInterpreter?: LocalOwnerInterpreter;
  session: LocalTestSession;
  onSignOut: () => void;
  onSessionExpired: () => void;
  pendingInviteToken: string | null;
  onInviteHandled: () => void;
}) {
  const [objective, setObjective] = useState('');
  const [participantNames, setParticipantNames] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [decision, setDecision] = useState<LocalDecision | null>(null);
  const [view, setView] = useState<DecisionView>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ownerText, setOwnerText] = useState('');
  const [ownerDraft, setOwnerDraft] = useState<LocalOwnerDraft | null>(null);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const [demoData, setDemoData] = useState<ChristmasDemoData | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [demoOutcome, setDemoOutcome] = useState('');
  const [inviteParticipant, setInviteParticipant] = useState('leo');
  const [replaceActiveInvitation, setReplaceActiveInvitation] = useState(false);
  const [invitationLink, setInvitationLink] = useState('');
  const [invitationError, setInvitationError] = useState('');
  const [invitationNotice, setInvitationNotice] = useState('');
  const inputRevision = useRef(0);
  const requestSequence = useRef(0);
  const ownerRequestSequence = useRef(0);
  const demoRequestSequence = useRef(0);
  const draftRevision = useRef(0);
  const draftId = useRef('');
  if (!draftId.current) draftId.current = crypto.randomUUID();

  const clearOwnerReview = () => {
    ownerRequestSequence.current++;
    setOwnerDraft(null);
    setOwnerConfirmed(false);
    setOwnerLoading(false);
    setOwnerError('');
  };

  const changed = () => {
    inputRevision.current++;
    requestSequence.current++;
    setDecision(null);
    setLoading(false);
    setError('');
    clearOwnerReview();
  };

  const interpretOwnerText = async () => {
    const sequence = ++ownerRequestSequence.current;
    setOwnerDraft(null);
    setOwnerConfirmed(false);
    setOwnerLoading(true);
    setOwnerError('');
    try {
      const mock = ownerInterpreter ? null : await import('./owner-conversation-mock.ts');
      const raw = await (ownerInterpreter ? ownerInterpreter(ownerText) : mock!.localOwnerInterpreter(ownerText));
      const parsed = ownerInterpreter ? await import('./owner-conversation-mock.ts').then(module => module.validateLocalOwnerDraft(raw))
        : mock!.validateLocalOwnerDraft(raw);
      if (!parsed) throw new Error('invalid local draft');
      if (sequence === ownerRequestSequence.current) setOwnerDraft(parsed);
    } catch {
      if (sequence === ownerRequestSequence.current) setOwnerError('The local fixture could not safely prepare this draft. Please clarify the wording.');
    } finally {
      if (sequence === ownerRequestSequence.current) setOwnerLoading(false);
    }
  };

  const loadChristmasDemo = async () => {
    const sequence = ++demoRequestSequence.current;
    setDemoLoading(true); setDemoError('');
    try {
      const [publicResponse, ownerResponse] = await Promise.all([
        localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/public`),
        localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/me`),
      ]);
      if (publicResponse.status === 404 || ownerResponse.status === 404) {
        setDemoError('This test user has not joined the scenario yet. Sign in as Maya and issue an invitation for this test user.');
        return;
      }
      if (!publicResponse.ok || !ownerResponse.ok) throw new Error('local API unavailable');
      const [rawPublic, rawOwner] = await Promise.all([publicResponse.json(), ownerResponse.json()]);
      const loaded = {
        publicSnapshot: KnownEnough.PublicDecisionSnapshot.parse(rawPublic),
        ownerSnapshot: KnownEnough.OwnerDecisionSnapshot.parse(rawOwner),
      };
      if (sequence === demoRequestSequence.current) setDemoData(loaded);
    } catch {
      if (sequence === demoRequestSequence.current) setDemoError('Start the loopback API to load the fictional Christmas scenario.');
    } finally {
      if (sequence === demoRequestSequence.current) setDemoLoading(false);
    }
  };

  const generateChristmasCandidate = async () => {
    const sequence = ++demoRequestSequence.current;
    setDemoLoading(true); setDemoError(''); setDemoOutcome('');
    try {
      const response = await localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/reasoning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID() },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const raw = await response.json();
      if (!response.ok) throw new Error('reasoning unavailable');
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid response');
      const result = raw as Record<string, unknown>;
      if (typeof result.outcome !== 'string') throw new Error('invalid response');
      setDemoOutcome(result.outcome);
      await loadChristmasDemo();
    } catch {
      if (sequence === demoRequestSequence.current) setDemoError('The local reasoning action could not complete. Refresh the demo and try again.');
    } finally {
      if (sequence === demoRequestSequence.current) setDemoLoading(false);
    }
  };

  const answerChristmasQuestion = async (question: KE.NegotiationQuestion, answer: 'ALLOW' | 'DECLINE') => {
    if (!demoData) return;
    const owner = demoData.ownerSnapshot;
    const command = {
      schemaVersion: KnownEnough.KE_SCHEMA_VERSION, type: 'ANSWER_NEGOTIATION',
      requestId: crypto.randomUUID(), decisionId: CHRISTMAS_DEMO_ID, idempotencyKey: crypto.randomUUID(),
      expected: { contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion },
      payload: { questionId: question.questionId, constraintVersion: question.constraintVersion,
        requestIdentity: question.requestIdentity, answer },
    };
    const sequence = ++demoRequestSequence.current;
    setDemoLoading(true); setDemoError('');
    try {
      const response = await localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/commands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const raw = await response.json() as { ok?: boolean };
      if (!response.ok || raw.ok !== true) throw new Error('command rejected');
      await loadChristmasDemo();
      if (answer === 'ALLOW') await generateChristmasCandidate();
    } catch {
      if (sequence === demoRequestSequence.current) setDemoError('That response could not be applied. Refresh the owner profile and review the current question.');
    } finally {
      if (sequence === demoRequestSequence.current) setDemoLoading(false);
    }
  };

  const issueInvitation = async () => {
    setInvitationError(''); setInvitationNotice(''); setInvitationLink('');
    try {
      const response = await localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/invitations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), participantId: inviteParticipant,
          ...(replaceActiveInvitation ? { replaceActive: true } : {}) }),
      });
      if (response.status === 409) {
        setInvitationError('A live invitation may already exist. If its link was lost, select “Replace current link” to invalidate it and issue a new one.');
        return;
      }
      if (!response.ok) throw new Error('invitation unavailable');
      const raw: unknown = await response.json();
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid invitation response');
      const result = raw as Record<string, unknown>;
      if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(result.token)
        || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('invalid invitation response');
      setInvitationLink(`${window.location.origin}${window.location.pathname}${window.location.search}#invite=${encodeURIComponent(result.token)}`);
      setInvitationNotice(replaceActiveInvitation
        ? 'New invitation link created. The previous link is now invalid.'
        : 'Invitation link created. It can be redeemed once by the matching local test user.');
      setReplaceActiveInvitation(false);
    } catch {
      setInvitationError('The invitation could not be issued. If the response was lost, retry; if the API reports an active link, replace it only when the old link cannot be recovered.');
    }
  };

  const redeemPendingInvitation = async () => {
    if (!pendingInviteToken) return;
    setDemoLoading(true); setDemoError(''); setInvitationNotice('');
    try {
      const response = await localTestFetch(session, onSessionExpired, `${LOCAL_API}/decisions/${CHRISTMAS_DEMO_ID}/invitations/redeem`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), token: pendingInviteToken }),
      });
      if (!response.ok) {
        setDemoError('This invitation is invalid, expired, or belongs to another test user. Sign out and choose the invited user, or ask Maya for a new link.');
        return;
      }
      onInviteHandled();
      setInvitationNotice('Invitation accepted. This local test user can now access the shared scenario.');
      await loadChristmasDemo();
    } catch {
      setDemoError('The invitation could not be checked. Keep this tab open and retry, or ask Maya for a replacement link if it expired.');
    } finally {
      setDemoLoading(false);
    }
  };

  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = participantNames.split(',').map(name => name.trim()).filter(Boolean);
    const options = optionsText.split(',').map(option => option.trim()).filter(Boolean);
    if (names.length < 1 || names.length > 20) { setError('Add between 1 and 20 proposed participants.'); return; }
    if (options.length > 32) { setError('Add no more than 32 possible options.'); return; }

    const sequence = ++requestSequence.current;
    const inputVersion = inputRevision.current;
    const revision = ++draftRevision.current;
    setLoading(true);
    setError('');
    try {
      const requestId = crypto.randomUUID();
      const response = await localTestFetch(session, onSessionExpired, ARCHITECT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
        body: JSON.stringify({
          requestId, draftId: draftId.current, revision, objective: objective.trim(),
          participants: names.map((displayName, index) => ({ id: `person-${index + 1}`, displayName })),
          allowedOptions: options,
        }),
      });
      if (!response.ok) throw new Error('local architect rejected request');
      const parsed = parseResponse(await response.json());
      if (sequence !== requestSequence.current || inputVersion !== inputRevision.current) return;
      setDecision(parsed.draft);
      setView('overview');
    } catch {
      if (sequence === requestSequence.current && inputVersion === inputRevision.current)
        setError('The local frame service is unavailable or could not validate a draft. Start the local API and try again.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const frame = decision?.frame;
  const statusLabel = decision?.status === 'NEEDS_CLARIFICATION' ? 'Needs clarification · draft only' : 'Draft · awaiting shared confirmation';

  return <main className="ke-home">
    <header className="masthead ke-masthead">
      <div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div>
      <div className="header-actions"><span className="badge">Local test session · {session.displayName}</span>
        <button type="button" className="secondary" onClick={onSignOut}>Sign out</button></div>
    </header>

    <section className="ke-hero" aria-labelledby="create-heading">
      <p className="eyebrow">A SHARED DECISION SPACE</p>
      <h2 id="create-heading">What are you trying to decide?</h2>
      <p>Start with the question. The group can clarify what matters before anyone commits to an outcome.</p>
      <form className="ke-create" onSubmit={createDraft}>
        <label htmlFor="decision-objective">Describe the shared objective</label>
        <textarea id="decision-objective" value={objective} onChange={event => { changed(); setObjective(event.target.value); }} maxLength={2000} required placeholder="For example: Where should our family go on holiday?" />
        <label htmlFor="decision-participants">Proposed participants (comma-separated fictional names)</label>
        <input id="decision-participants" value={participantNames} onChange={event => { changed(); setParticipantNames(event.target.value); }} maxLength={1600} required placeholder="For example: Maya, Leo, Nina" />
        <label htmlFor="decision-options">Options already under consideration (optional, comma-separated)</label>
        <input id="decision-options" value={optionsText} onChange={event => { changed(); setOptionsText(event.target.value); }} maxLength={1200} placeholder="For example: Cancún, Oaxaca, Mazatlán" />
        <p className="ke-help">Use fictional labels in this local demo. Do not enter private conditions or sensitive personal information.</p>
        <button type="submit" disabled={loading}>{loading ? 'Drafting…' : 'Draft the shared frame'}</button>
        {error && <p role="alert" className="ke-error">{error}</p>}
      </form>
    </section>

    <p className="notice ke-privacy"><strong>Known Enough product privacy promise for the connected service:</strong> “{privacyPromise}” This test login is a local-only signed session issued by the loopback API; it is not Cognito, a real account, or production authentication. The frame draft sends only the public objective, proposed participant labels and candidate options to the loopback API. The Christmas scenario uses fictional participants, synthetic conditions, and temporary in-memory state; it disappears when the API stops. Invitations are local links only and are never emailed.</p>

    <section className="ke-card ke-christmas-demo" aria-labelledby="christmas-demo-heading">
      <p className="eyebrow">END-TO-END LOCAL SCENARIO</p>
      <h2 id="christmas-demo-heading">Try the fictional Christmas decision</h2>
      <p>Five fictional participants, confirmed conditions, a kernel-checked proposal and an optional private negotiation. Each participant signs in as a separate local test user and must accept Maya’s invitation before the API grants scenario access. The loopback API uses temporary in-memory shared state that disappears when it stops; the hosted HTTPS preview remains a static mock with no shared state.</p>
      {pendingInviteToken && <div className="local-note" aria-label="Pending invitation">
        <p>An invitation link is open for this browser tab. Sign in with the test user it was issued for.</p>
        <button type="button" onClick={() => void redeemPendingInvitation()} disabled={demoLoading}>
          {demoLoading ? 'Checking invitation…' : 'Accept local invitation'}
        </button>
      </div>}
      {session.accountId === 'maya' && <section className="ke-invitation" aria-labelledby="issue-invitation-heading">
        <h3 id="issue-invitation-heading">Invite a fictional participant</h3>
        <p className="ke-help">The Maya test account can issue these local links. This picker does not verify who is using that account. Replacing a live link immediately invalidates the old link.</p>
        <label htmlFor="local-invite-participant">Participant</label>
        <select id="local-invite-participant" value={inviteParticipant} onChange={event => setInviteParticipant(event.target.value)}>
          {['leo', 'nina', 'ana', 'raul'].map(person => <option key={person} value={person}>{person[0]!.toUpperCase() + person.slice(1)}</option>)}
        </select>
        <label className="ke-checkbox"><input type="checkbox" checked={replaceActiveInvitation}
          onChange={event => setReplaceActiveInvitation(event.target.checked)} /> Replace current link if its response was lost or the old link must be invalidated</label>
        <button type="button" onClick={() => void issueInvitation()} disabled={demoLoading}>Create invitation link</button>
        {invitationError && <p role="alert" className="ke-error">{invitationError}</p>}
        {invitationNotice && <p role="status" className="local-note">{invitationNotice}</p>}
        {invitationLink && <label htmlFor="local-invitation-link">Copy this one-time link and send it yourself</label>}
        {invitationLink && <input id="local-invitation-link" className="ke-invitation-link" readOnly value={invitationLink} onFocus={event => event.currentTarget.select()} />}
        {invitationLink && <p className="ke-help">The link works only in this local test setup while its API process is running. It is not an email invitation or a link to the hosted preview.</p>}
        {invitationLink && <button type="button" className="secondary" onClick={() => setInvitationLink('')}>Hide invitation link</button>}
      </section>}
      <div className="ke-private-actions">
        <button type="button" onClick={() => void loadChristmasDemo()} disabled={demoLoading}>{demoData ? 'Refresh local scenario' : 'Load local scenario'}</button>
        <button type="button" className="secondary" onClick={() => void generateChristmasCandidate()} disabled={!demoData || demoLoading || !['READY', 'NO_AGREEMENT', 'SUPERSEDED'].includes(demoData.publicSnapshot.status)}>
          {demoLoading ? 'Working…' : 'Generate candidate'}
        </button>
      </div>
      {demoError && <p role="alert" className="ke-error">{demoError}</p>}
      {demoOutcome && <p role="status">Local reasoning outcome: {demoOutcome}.</p>}
      {demoData && <>
        <div className="ke-demo-summary">
          <strong>{demoData.publicSnapshot.frame.title}</strong>
          <span> · {demoData.publicSnapshot.status.replaceAll('_', ' ')}</span>
          <p>{demoData.publicSnapshot.frame.objective}</p>
          <p className="ke-help">The scenario is synthetic. This local session verifies the server-issued test identity but does not prove managed authentication.</p>
        </div>
        {demoData.publicSnapshot.currentProposal && <section className="ke-demo-proposal" aria-label="Validated public proposal">
          <h3>Validated proposal · public facts only</h3>
          <ul>{demoData.publicSnapshot.currentProposal.facts.values.map(assignment => {
            const variable = demoData.publicSnapshot.frame.variables.find(item => item.id === assignment.variableId);
            return variable ? <li key={assignment.variableId}><strong>{variable.label}:</strong> {describeDemoValue(assignment.value, variable)}</li> : null;
          })}</ul>
          <p>The proposal was accepted by the existing deterministic kernel. No private reason or condition is included in these shared facts.</p>
        </section>}
        {demoData.ownerSnapshot.pendingQuestions.filter(question => question.status === 'PENDING').map(question => {
          const constraint = demoData.ownerSnapshot.confirmedConstraints.find(item => item.constraintId === question.constraintId
            && item.constraintVersion === question.constraintVersion && item.status === 'ACTIVE' && item.kind === 'NEGOTIABLE');
          const variables = [...demoData.publicSnapshot.frame.variables, ...demoData.ownerSnapshot.privateVariables];
          return <section className="ke-owner-draft" key={question.questionId} aria-label="Private negotiation question">
            <p className="eyebrow">PRIVATE QUESTION · {demoData.ownerSnapshot.ownerParticipantId}</p>
            <h3>Optional one-time adjustment</h3>
            <p>For “{demoData.publicSnapshot.frame.objective},” your condition is {constraint?.kind === 'NEGOTIABLE' ? describeDemoRule(constraint.rule, variables) : 'this negotiable condition'}.</p>
            <p>The requested adjustment is {describeDemoRule(question.adjustment, variables)}. This private question is visible only in this participant’s local signed test session.</p>
            <p>Expires {new Date(question.expiresAt).toLocaleString()}.</p>
            <div className="ke-private-actions">
              <button type="button" onClick={() => void answerChristmasQuestion(question, 'ALLOW')} disabled={demoLoading}>Allow this exact adjustment</button>
              <button type="button" className="secondary" onClick={() => void answerChristmasQuestion(question, 'DECLINE')} disabled={demoLoading}>Decline</button>
            </div>
          </section>;
        })}
        {demoData.publicSnapshot.status === 'PRIVATE_NEGOTIATION' && demoData.ownerSnapshot.pendingQuestions.length === 0
          && <p>A participant’s private question is pending. That participant must sign in separately to view and answer it.</p>}
      </>}
    </section>

    {decision && frame ? <section className="ke-workspace" aria-labelledby="decision-heading">
      <div className="ke-card ke-decision-heading">
        <div><p className="eyebrow">FRAME DRAFT · INJECTED TEST MODEL · NOT LIVE AI</p><h2 id="decision-heading">{frame.title}</h2><p>{frame.objective}</p></div>
        <span role="status" className="status-pill">{statusLabel}</span>
      </div>
      <nav className="ke-tabs" aria-label="Decision views">
        {(['overview', 'private', 'proposal'] as const).map(item => <button key={item} type="button" className={view === item ? '' : 'secondary'} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'overview' ? 'Shared overview' : item === 'private' ? 'Your private space' : 'Proposal'}</button>)}
      </nav>
      {view === 'overview' && <section className="ke-card" aria-labelledby="overview-heading">
        <div className="section-heading"><h3 id="overview-heading">Decision status</h3><span className="status-pill">{decision.status === 'NEEDS_CLARIFICATION' ? 'Clarification needed' : 'Frame draft'}</span></div>
        <p>This is not a shared decision. Proposed names are not verified identities, and no participant has confirmed this frame.</p>
        <h3>Proposed participants</h3>
        <ul className="ke-participant-list" aria-label="Participants">{frame.participants.map(person => <li key={person.id}>{person.displayName} <span>· proposed, not verified</span></li>)}</ul>
        {decision.clarificationQuestions.length > 0 && <><h3>Questions to clarify</h3><ul className="ke-information-list">{decision.clarificationQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></>}
        {decision.participantInformationRequirements.length > 0 && <><h3>Information the group may need</h3><ul className="ke-information-list">{decision.participantInformationRequirements.map((item, index) => <li key={`${item.participantId}-${index}`}><strong>{frame.participants.find(person => person.id === item.participantId)?.displayName}:</strong> {item.prompt}</li>)}</ul></>}
        {frame.variables.length > 0 && <><h3>Shared topics and options</h3><ul className="ke-information-list" aria-label="Draft shared topics">{frame.variables.map(variable => <li key={variable.id}><strong>{variable.label}</strong>{(variable.type === 'ENUM' || variable.type === 'ENUM_SET') && <span>: {variable.options.map(option => option.label).join(', ')}</span>}</li>)}</ul></>}
        <p className="ke-next">Next: resolve the questions, then let participants review and confirm the shared frame.</p>
      </section>}
      {view === 'private' && <section className="ke-card" aria-labelledby="private-heading">
        <h3 id="private-heading">Your private space</h3>
        <p>This is a local-only conversation prototype for fictional input. It has no live model or saved shared state. Do not enter personal or sensitive information.</p>
        <p className="ke-private-identity">Local test user: {session.displayName} · not a real account</p>
        <label htmlFor="owner-private-statement">Describe one private condition</label>
        <textarea id="owner-private-statement" value={ownerText} maxLength={2_000} onChange={event => {
          clearOwnerReview(); setOwnerText(event.target.value);
        }} placeholder="Use the fictional sample to see hard limits, preferences, and a conditional trade-off." />
        <div className="ke-private-actions">
          <button type="button" className="secondary" onClick={() => {
            void import('./owner-conversation-mock.ts').then(module => {
              clearOwnerReview(); setOwnerText(module.LOCAL_OWNER_SAMPLE);
            });
          }}>Use fictional sample</button>
          <button type="button" onClick={() => void interpretOwnerText()} disabled={!ownerText.trim() || ownerLoading}>
            {ownerLoading ? 'Preparing…' : 'Review my private draft'}
          </button>
          <button type="button" className="secondary" onClick={() => { clearOwnerReview(); setOwnerText(''); }}>Clear</button>
        </div>
        {ownerError && <p role="alert" className="ke-error">{ownerError}</p>}
        <p className="ke-help">The exact fictional sample is handled by a fixed local fixture; all other wording returns a clarification prompt. Nothing is sent over the network or added to the shared frame.</p>
        {ownerDraft && <div className="ke-owner-draft" aria-label="Private draft review">
          <p className="eyebrow">PRIVATE DRAFT · LOCAL SIMULATION</p>
          {ownerDraft.hardLimits.length > 0 && <><h4>Hard limits</h4><ul>{ownerDraft.hardLimits.map(item => <li key={item}>{item}</li>)}</ul></>}
          {ownerDraft.preferences.length > 0 && <><h4>Preferences</h4><ul>{ownerDraft.preferences.map(item => <li key={item}>{item}</li>)}</ul></>}
          {ownerDraft.negotiableConditions.length > 0 && <><h4>Negotiable conditions</h4><ul>{ownerDraft.negotiableConditions.map(item => <li key={item}>{item}</li>)}</ul></>}
          {ownerDraft.clarificationQuestions.length > 0 && <><h4>Clarify before saving</h4><ul>{ownerDraft.clarificationQuestions.map(item => <li key={item}>{item}</li>)}</ul></>}
          {ownerDraft.status === 'DRAFT' && <div className="ke-private-actions">
            <button type="button" onClick={() => setOwnerConfirmed(true)}>Confirm this draft in the local preview</button>
            <button type="button" className="secondary" onClick={() => { clearOwnerReview(); document.getElementById('owner-private-statement')?.focus(); }}>Edit or clarify</button>
            <button type="button" className="secondary" onClick={() => { clearOwnerReview(); setOwnerText(''); }}>Reject and clear</button>
          </div>}
          {ownerConfirmed && <p role="status">Marked confirmed in this local preview only. It is not authenticated, stored, or shared.</p>}
        </div>}
        <p>In the working product, conditions stay owner-private unless you separately approve a disclosure or an outcome that reveals them.</p>
        <p><a href="?view=owner&owner=approval">See the retained fictional private-receipts and permissions demo</a></p>
      </section>}
      {view === 'proposal' && <section className="ke-card" aria-labelledby="proposal-heading">
        <h3 id="proposal-heading">Proposal</h3>
        <p>No proposal yet. A proposal can be shown only after the required participants confirm the shared frame and provide their own inputs.</p>
        <p>The frame structure was checked against supported contract types. That does not confirm participants, private conditions or an outcome.</p>
      </section>}
    </section> : !demoData ? <section className="ke-card ke-empty" aria-labelledby="your-decisions-heading">
      <p className="eyebrow">YOUR DECISIONS</p><h2 id="your-decisions-heading">Nothing here yet</h2>
      <p>Your first frame draft will appear here. It stays in this local session and is not shared.</p>
    </section> : null}

    <footer className="ke-footer">Injected deterministic test model · not live AI · local test identity only · no cloud-shared state. Christmas scenario data stays in local memory. <a href="?legacy=teamtable">Open the retained TeamTable regression demo</a>.</footer>
  </main>;
}
