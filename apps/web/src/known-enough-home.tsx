import { useRef, useState, type FormEvent } from 'react';
import { KnownEnough } from '@deal-table/contracts';
import type { KnownEnough as KE } from '@deal-table/contracts';
import type { LocalOwnerDraft, LocalOwnerInterpreter } from './owner-conversation-mock.ts';

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

const privacyPromise = 'Your private inputs are processed by Known Enough to help the group reach a decision. Other participants do not receive those inputs unless you explicitly approve a disclosure or the final agreed outcome inherently reveals something.';
const ARCHITECT_URL = 'http://127.0.0.1:8787/decisions/architecture/draft';
const LOCAL_IDENTITY = 'NON_PRODUCTION organizer';

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

export function KnownEnoughHome({ ownerInterpreter }: { ownerInterpreter?: LocalOwnerInterpreter }) {
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
  const inputRevision = useRef(0);
  const requestSequence = useRef(0);
  const ownerRequestSequence = useRef(0);
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
      const response = await fetch(ARCHITECT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Deal-Table-Test-Identity': LOCAL_IDENTITY,
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
      <span className="badge">Local injected-model preview · no sign-in</span>
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

    <p className="notice ke-privacy"><strong>Known Enough product privacy promise for the connected service:</strong> “{privacyPromise}” This local prototype has no sign-in. It sends only the public objective, proposed participant labels and candidate options to the loopback development API; the injected model is deterministic, and drafts are neither saved nor shared.</p>

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
        <p>This is a local-only conversation prototype for fictional input. It has no verified identity, shared state, or live model. Do not enter personal or sensitive information.</p>
        <p className="ke-private-identity">Demo profile: {frame?.participants[0]?.displayName ?? 'fictional owner'} · proposed, not verified</p>
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
    </section> : <section className="ke-card ke-empty" aria-labelledby="your-decisions-heading">
      <p className="eyebrow">YOUR DECISIONS</p><h2 id="your-decisions-heading">Nothing here yet</h2>
      <p>Your first frame draft will appear here. It stays in this local session and is not shared.</p>
    </section>}

    <footer className="ke-footer">Injected deterministic test model · not live AI · no authenticated identity or shared state. <a href="?legacy=teamtable">Open the retained TeamTable regression demo</a>.</footer>
  </main>;
}
