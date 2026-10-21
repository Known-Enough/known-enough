import { MemberAvatar } from './member-avatar';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';
import { PrivateAnswersModal } from './private-answers-modal';
import { PageIcon } from './app-chrome';
import { type DecisionSection, appViewSearch } from './navigation';
import { decisionPhaseLabel, decisionStatusText } from './decision-copy';
import { backgroundRequest, submitBackgroundRequest, type BackgroundReceipt } from './background-negotiation';

const AlexaChat = lazy(() => import('./alexa-chat'));

class DecisionRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly category: string, readonly reference: string) { super(code); }
}
type Variable = KE.DecisionVariable | KE.PublicDecisionFrame['variables'][number];
export function valueText(value: KE.DecisionValue, variable?: Variable): string {
  if (value.type === 'MONEY') return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / 10 ** value.minorUnit);
  if (value.type === 'PERCENTAGE') return `${value.basisPoints / 100}%`;
  if (value.type === 'ENUM') return variable?.type === 'ENUM' ? variable.options.find(item => item.id === value.optionId)?.label ?? value.optionId : value.optionId;
  if (value.type === 'ENUM_SET') return value.optionIds.map(id => variable?.type === 'ENUM_SET'
    ? variable.options.find(item => item.id === id)?.label ?? id : id).join(', ');
  if (value.type === 'DATE') return value.date;
  if (value.type === 'DURATION') return `${value.seconds} seconds`;
  if (value.type === 'NUMBER') return `${value.coefficient / 10 ** value.scale} ${value.unitCode}`;
  if (value.type === 'DATETIME') return `${value.instant} (${value.displayTimeZone})`;
  if (value.type === 'BOOLEAN') return value.value ? 'Yes' : 'No';
  return value.participantId;
}
export function variableText(variable: KE.PublicDecisionFrame['variables'][number], frame: KE.PublicDecisionFrame): string {
  const requirement = variable.required ? 'required' : 'optional';
  switch (variable.type) {
    case 'ENUM': case 'ENUM_SET': return `${variable.label} (${variable.type === 'ENUM' ? 'one option' : 'multiple options'}, ${requirement}): ${variable.options.map(item => item.label).join(', ')}`;
    case 'PARTICIPANT': return `${variable.label} (participant, ${requirement}): ${variable.participantIds.map(id => frame.participants.find(person => person.id === id)?.displayName ?? id).join(', ')}`;
    case 'MONEY': return `${variable.label} (money, ${variable.currencyCode}, ${variable.minorUnit} decimal places, ${requirement})`;
    case 'NUMBER': return `${variable.label} (number, ${variable.unitCode}, ${variable.scale} decimal places, ${requirement})`;
    case 'PERCENTAGE': return `${variable.label} (percentage, ${requirement})`;
    case 'DATE': return `${variable.label} (date, ${requirement})`;
    case 'DATETIME': return `${variable.label} (date and time, ${variable.displayTimeZone}, ${requirement})`;
    case 'DURATION': return `${variable.label} (duration in seconds, ${requirement})`;
    case 'BOOLEAN': return `${variable.label} (yes or no, ${requirement})`;
  }
}
export function ruleText(rule: KE.ValidationRule, variables: Variable[]): string {
  const variable = (id: string) => variables.find(item => item.id === id);
  const label = (id: string) => variable(id)?.label ?? id;
  const atom = (condition: { variableId: string; operator: 'EQ' | 'NE'; value: KE.DecisionValue }) =>
    `${label(condition.variableId)} ${condition.operator === 'EQ' ? 'equals' : 'does not equal'} ${valueText(condition.value, variable(condition.variableId))}`;
  switch (rule.operator) {
    case 'COMPARE': return `${label(rule.variableId)} ${({ EQ: '=', NE: '≠', LT: '<', LTE: '≤', GT: '>', GTE: '≥' })[rule.comparison]} ${valueText(rule.value, variable(rule.variableId))}`;
    case 'IN': return `${label(rule.variableId)} is one of ${rule.values.map(value => valueText(value, variable(rule.variableId))).join(' or ')}`;
    case 'RANGE': return `${label(rule.variableId)} ${rule.includeMinimum ? '≥' : '>'} ${valueText(rule.minimum, variable(rule.variableId))} and ${rule.includeMaximum ? '≤' : '<'} ${valueText(rule.maximum, variable(rule.variableId))}`;
    case 'SUM_EQUALS': return `Sum of ${rule.variableIds.map(label).join(' + ')} = ${valueText(rule.target, variable(rule.variableIds[0]!))}`;
    case 'ALL_DIFFERENT': return `${rule.variableIds.map(label).join(', ')} must all have different values`;
    case 'MUTUALLY_EXCLUSIVE': return `At most ${rule.maximumSelected} of ${rule.variableIds.map(label).join(', ')} may be Yes`;
    case 'IMPLIES': return `If ${atom(rule.antecedent)}, then ${atom(rule.consequent)}`;
  }
}

export function ConnectedDecision({ snapshot, owner, api, refresh, backgroundNegotiation = false, onQueued, onDirtyChange, staged = false, title, onRefresh, refreshing = false, mcpUrl, groupId, section = 'overview', onNavigate }: {
  section?: DecisionSection; onNavigate?: (section: DecisionSection) => void;
  mcpUrl?: string; groupId?: string; title?: string; onRefresh?: () => void; refreshing?: boolean;
  snapshot: KE.PublicDecisionSnapshot; owner: KE.OwnerDecisionSnapshot | null;
  api: (path: string, init?: RequestInit) => Promise<Response>; refresh: () => Promise<void>;
  backgroundNegotiation?: boolean; onQueued?: (receipt: BackgroundReceipt) => void; onDirtyChange?: (dirty: boolean) => void; staged?: boolean;
}) {
  const [text, setText] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [syntheticProcessing, setSyntheticProcessing] = useState(false);
  const [localSection, setLocalSection] = useState<DecisionSection>('overview');
  const activeSection = onNavigate ? section : localSection;
  const detailStep = activeSection === 'details' ? 'shared' : activeSection === 'outcome' ? 'proposal' : null;
  function setDetailStep(next: 'shared' | 'proposal' | null) {
    const destination = next === 'shared' ? 'details' : next === 'proposal' ? 'outcome' : 'overview';
    if (onNavigate) onNavigate(destination); else setLocalSection(destination);
  }
  const headerMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && headerMenu.current?.open && !headerMenu.current.contains(event.target)) headerMenu.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const [structuredDirty, setStructuredDirty] = useState(false);
  const [editingAnswers, setEditingAnswers] = useState(owner?.ownInputReadiness === 'NOT_STARTED');
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => { setReviewed(false); }, [owner?.draft?.draftId, snapshot.currentProposal?.proposalId, snapshot.currentProposal?.facts.proposalVersion, snapshot.currentProposal?.publicHash]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [awaitingJob, setAwaitingJob] = useState(false);
  const automaticOutcomeAttempt = useRef<string | null>(null);
  useEffect(() => { if (snapshot.status !== 'REASONING') setAwaitingJob(false); }, [snapshot.status, owner?.controlVersion]);
  const pending = useRef<{ type: string; body: unknown } | null>(null);
  const commandGuard = useRef(false);
  const interpretationSubmittedText = useRef('');
  const [pendingAction, setPendingAction] = useState(false);
  const decisionId = snapshot.frame.decisionId;
  const interpretationKey = 'ke-owner-request:' + decisionId + ':' + (owner?.ownerParticipantId ?? 'display') + ':' + snapshot.contextToken;
  const [interpretationRequest, setInterpretationRequest] = useState<string | null>(() => typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(interpretationKey));
  const interpretationStorageKey = useRef(interpretationKey);
  const interpretationGuard = useRef(false);
  const [interpretationRelease, setInterpretationRelease] = useState<number | null>(null);
  const clearInterpretation = () => { sessionStorage.removeItem(interpretationStorageKey.current); setInterpretationRequest(null); setInterpretationRelease(null); };
  const frameReviewKey = `${snapshot.contextToken}:${snapshot.frame.frameVersion}`;
  useEffect(() => { setSyntheticProcessing(false); }, [frameReviewKey]);
  const variables: Variable[] = [...snapshot.frame.variables, ...(owner?.privateVariables ?? [])];
  const allConfirmed = snapshot.frame.requiredParticipantIds.every(id => snapshot.frameConfirmations.some(item => item.participantId === id));
  const request = async (path: string, body: unknown) => {
    const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result: unknown = await response.json();
    if (!response.ok) {
      const value = result as { error?: { code?: unknown }; interpretationFailure?: unknown; requestId?: unknown };
      const safe = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : '';
      throw new DecisionRequestError(response.status, safe(value?.error?.code), safe(value?.interpretationFailure), safe(value?.requestId));
    }
    if (result && typeof result === 'object' && 'ok' in result && result.ok !== true) throw new Error('rejected');
    return result;
  };
  const command = async (type: string, payload: unknown) => {
    if (!owner || commandGuard.current) return false;
    commandGuard.current = true; setBusy(true); setNotice('');
    if (!pending.current) {
      const id = crypto.randomUUID();
      setPendingAction(true); pending.current = { type, body: { schemaVersion: 2, decisionId, type, requestId: id, idempotencyKey: id,
        expected: { contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion,
          controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion,
          ...(type === 'CONFIRM_PRIVATE_ANSWERS' && owner.privateAnswerContext
            ? { privateAnswerContext: owner.privateAnswerContext } : {}) }, payload } };
    }
    try {
      KE.DecisionCommandResult.parse(await request(`/decisions/${decisionId}/commands`, pending.current.body));
      pending.current = null; setPendingAction(false); setReviewed(false);
      await refresh(); setNotice(type === 'CONFIRM_FRAME' ? 'Your confirmation of what we’re deciding is saved.' : type === 'CONFIRM_PRIVATE_ANSWERS' ? 'Your private answers are saved.' : type === 'CONFIRM_CONSTRAINTS' ? 'Your extra requirements are saved.' : 'Saved.');
      if (type === 'CONFIRM_PRIVATE_ANSWERS') { setText(''); setStructuredDirty(false); }
      return true;
    } catch (error) {
      if (error instanceof DecisionRequestError && error.status === 409) {
        pending.current = null; setPendingAction(false); setReviewed(false);
        const conflict = type === 'CONFIRM_PRIVATE_ANSWERS'
          ? error.code === 'STALE_OWNER' || error.code === 'STALE_DRAFT'
            ? 'Your saved answers or notes changed in another window. Your latest saved information is loaded; review it before saving your edits.'
            : 'The options or proposal changed, so these answers weren’t saved. Check the latest decision before saving again.'
          : 'The decision changed while you were reviewing it. The latest version is loaded; review and confirm it again.';
        try { await refresh(); setNotice(conflict + (error.reference ? ` Reference: ${error.reference}.` : '')); }
        catch { setNotice('The decision changed. Refresh before confirming again.'); }
      } else if (error instanceof DecisionRequestError && [400,401,403,404,422].includes(error.status)) {
        pending.current = null; setPendingAction(false);
        setNotice((error.status === 401 ? 'Your session expired. Sign in again. Unsaved edits may need to be entered again.' : 'These answers could not be saved. Your selections are kept. Review the current choices and your access before trying again.') + (error.reference ? ` Reference: ${error.reference}.` : ''));
      } else setNotice('We couldn’t confirm the result. Refresh to check it, or retry the same action.');
      return false;
    }
    finally { commandGuard.current = false; setBusy(false); }
  };
  const acceptInterpretation = async (result: unknown) => {
    if (!result || typeof result !== 'object') throw new Error('invalid');
    const value = result as { draft?: unknown; interpretation?: { state?: unknown; canRelease?: unknown; revision?: unknown } };
    setInterpretationRelease(value.interpretation?.canRelease === true && Number.isSafeInteger(value.interpretation.revision) ? Number(value.interpretation.revision) : null);
    if (value.draft) {
      KE.AIConstraintDraft.parse(value.draft); await refresh(); clearInterpretation();
      setText(current => current === interpretationSubmittedText.current ? '' : current);
      interpretationSubmittedText.current = '';
      setReviewed(false); setNotice('AI suggestions are ready. Review the requirements you want to include. Your selected options are unchanged.');
    } else if (value.interpretation?.state === 'FAILED') {
      clearInterpretation(); setNotice('The assistant couldn’t finish suggestions for this note. Your saved answers are unchanged. You can edit the note and try again.');
    } else if (value.interpretation?.state === 'NOT_SUBMITTED') {
      setNotice('The assistant hasn’t started. Close this attempt to edit your note or ask again.');
    } else if (value.interpretation?.state === 'PENDING' || value.interpretation?.state === 'UNKNOWN') {
      setNotice('We haven’t confirmed the suggestions yet. Check this attempt before asking again.');
    } else throw new Error('invalid');
  };
  const checkInterpretation = async () => {
    if (!interpretationRequest || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true);
    try {
      const response = await api(`/decisions/${decisionId}/owner-conversation/requests/${interpretationRequest}`);
      if (!response.ok) throw new Error('unavailable');
      await acceptInterpretation(await response.json());
    } catch { setNotice('We couldn’t check the suggestions. Try checking again. If this continues, ask the preview owner for help.'); }
    finally { interpretationGuard.current = false; setBusy(false); }
  };
  const closeInterpretation = async () => {
    if (!interpretationRequest || interpretationRelease === null || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true);
    try { await acceptInterpretation(await request(`/decisions/${decisionId}/owner-conversation/requests/${interpretationRequest}/close`, { revision: interpretationRelease })); }
    catch { setNotice('We couldn’t close this attempt. Check its result before trying again.'); }
    finally { interpretationGuard.current = false; setBusy(false); }
  };
  const interpret = async () => {
    if (!text.trim() || !syntheticProcessing || interpretationRequest || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true); setNotice('');
    const requestId = crypto.randomUUID(); interpretationStorageKey.current = interpretationKey; sessionStorage.setItem(interpretationKey, requestId); setInterpretationRequest(requestId);
    interpretationSubmittedText.current = text;
    try {
      await acceptInterpretation(await request(`/decisions/${decisionId}/owner-conversation/draft`, { requestId, processingConsent: 'SYNTHETIC_TEST', messages: [{ role: 'owner', text }] }));
    } catch (error) {
      if (error instanceof DecisionRequestError) {
        const reference = error.reference ? ` Reference: ${error.reference}.` : '';
        if ([400, 401, 403, 404, 409, 422].includes(error.status) || ['AI_UNAVAILABLE', 'AI_AT_CAPACITY', 'FRAME_NOT_CONFIRMED', 'PROCESSING_NOT_READY'].includes(error.category)) clearInterpretation();
        setNotice((error.status === 401 ? 'Your session expired. Sign in again. Unsent notes may need to be entered again.'
          : error.category === 'FRAME_NOT_CONFIRMED' ? 'The current options need to be confirmed before AI can help. Refresh the decision to see what’s missing.'
          : error.category === 'PROCESSING_NOT_READY' ? 'AI help isn’t available for this account. Ask the preview owner for help.'
          : error.category === 'AI_AT_CAPACITY' ? 'The assistant is busy and hasn’t started. Try again later.'
          : error.status === 404 || error.category === 'AI_UNAVAILABLE' ? 'AI help for private notes is unavailable. Ask the preview owner for help.'
          : error.status === 409 ? 'The options changed. Refresh before asking AI about your note.'
          : error.status === 422 ? 'The assistant couldn’t use this note. Try describing your requirement more clearly. Your saved answers are unchanged.'
          : 'We couldn’t confirm the suggestions. Check this attempt before asking again.') + reference);
      } else setNotice('We couldn’t confirm the suggestions. Check this attempt before asking again.');
    } finally { interpretationGuard.current = false; setBusy(false); }
  };
  const generate = async () => {
    if (commandGuard.current) return;
    commandGuard.current = true;
    setBusy(true); setNotice('');
    try {
      if (backgroundNegotiation && owner) {
        if (!pending.current) { pending.current = { type: 'REQUEST_NEGOTIATION', body: backgroundRequest(snapshot, owner, crypto.randomUUID()) }; setPendingAction(true); }
        if (pending.current.type !== 'REQUEST_NEGOTIATION') throw new Error('action pending');
        // Keep the same command after an uncertain acknowledgement; never manufacture a second job request.
        const receipt = await submitBackgroundRequest(api, pending.current.body as ReturnType<typeof backgroundRequest>);
        pending.current = null; setPendingAction(false); setAwaitingJob(true);
        if (onQueued) onQueued(receipt); else await refresh();
      } else { await request(`/decisions/${decisionId}/reasoning`, { requestId: crypto.randomUUID() }); await refresh(); }
      onDirtyChange?.(false); setDetailStep(null);
    }
    catch { setNotice('We couldn’t load an outcome. Refresh to check progress before trying again.'); }
    finally { commandGuard.current = false; setBusy(false); }
  };
  const proposal = snapshot.currentProposal;
  useEffect(() => {
    if (!owner || snapshot.status !== 'READY' || proposal || !allConfirmed || owner.ownInputReadiness !== 'READY'
      || busy || pendingAction || interpretationRequest || structuredDirty || editingAnswers || text.trim() || commandGuard.current) return;
    const identity = `${decisionId}:${snapshot.contextToken}:${snapshot.semanticVersion}:${owner.controlVersion}`;
    if (automaticOutcomeAttempt.current === identity) return;
    automaticOutcomeAttempt.current = identity;
    // One attempt per ready version; an uncertain result keeps the same request
    // for explicit recovery instead of automatically producing another job.
    void generate();
  }, [snapshot.status, snapshot.contextToken, snapshot.semanticVersion, owner?.controlVersion, owner?.ownInputReadiness,
    proposal, allConfirmed, busy, pendingAction, interpretationRequest, structuredDirty, editingAnswers, text, decisionId]);
  const findingOutcome = awaitingJob || snapshot.status === 'REASONING' || busy && pending.current?.type === 'REQUEST_NEGOTIATION';
  // An uncertain optional AI-notes request must not freeze structured answers,
  // while other decision actions remain blocked until its result is checked.
  const blocked = busy || pendingAction || !!interpretationRequest;
  const answersBlocked = busy || pendingAction;
  useEffect(() => { onDirtyChange?.(!!text.trim() || structuredDirty || pendingAction || !!interpretationRequest || busy); }, [text, structuredDirty, pendingAction, interpretationRequest, busy, onDirtyChange]);
  const describeCondition = (item: KE.AIConstraintDraft['proposedConstraints'][number]) => item.kind === 'PREFERENCE'
    ? `I prefer ${variables.find(variable => variable.id === item.preference.variableId)?.label ?? 'this choice'}: ${valueText(item.preference.value, variables.find(variable => variable.id === item.preference.variableId))}`
    : `${item.kind === 'HARD' ? 'Must work for me' : 'Ask me before changing'}: ${ruleText(item.rule, variables)}`;
  const recoveryControls = busy ? <div className="ke-decision-saving" role="status" aria-live="polite"><span aria-hidden="true" />{pending.current?.type === 'CONFIRM_PRIVATE_ANSWERS' ? 'Saving your answers…' : pending.current?.type === 'REQUEST_NEGOTIATION' ? 'Preparing an outcome…' : interpretationRequest ? 'Processing your notes…' : 'Updating decision…'}</div> : <>
    {interpretationRequest && <div className="ke-wizard-recovery" role="status"><p>Check the earlier AI suggestions before asking again. Your saved answers are unchanged.</p><button type="button" disabled={busy} onClick={() => void checkInterpretation()}>Check suggestions</button>{interpretationRelease !== null && <button type="button" disabled={busy} onClick={() => void closeInterpretation()}>Close attempt</button>}</div>}
    {pendingAction && <div className="ke-wizard-recovery"><p>Check whether your last action was saved before making another change.</p><button type="button" disabled={busy} onClick={() => void (pending.current!.type === 'REQUEST_NEGOTIATION' ? generate() : command(pending.current!.type, {}))}>Retry the same action</button>
      <button type="button" disabled={busy} onClick={() => { void (async () => { setBusy(true); try { await refresh(); pending.current = null; setPendingAction(false); setReviewed(false); setNotice('The latest decision is loaded. Check it before continuing.'); } catch { setNotice('We couldn’t load the latest result. Try refreshing again before making another change.'); } finally { setBusy(false); } })(); }}>Refresh decision</button></div>}
  </>;
  const continueToProposal = !!proposal || !!owner?.pendingQuestions.some(question => question.status === 'PENDING') || !!owner?.disclosurePermissions.some(permission => permission.status === 'PENDING');
  return <>
    <section hidden={!!detailStep} className={`ke-card ke-decision-overview ke-response-overview${staged ? ' ke-cohesive-decision-header' : ''}`}>
      {staged && <>
        <h1 id="open-decision-title" tabIndex={-1}>{title ?? snapshot.frame.title}</h1>
        <details ref={headerMenu} className="ke-decision-header-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary aria-label="Decision actions"><PageIcon name="Ellipsis" /></summary>
          <div className="ke-decision-header-menu-items">
            <button type="button" onClick={() => { if (headerMenu.current) headerMenu.current.open = false; setDetailStep('shared'); }}><PageIcon name="ListChecks" />Decision details</button>
            <button type="button" aria-label="Refresh decision" disabled={busy || refreshing} onClick={() => { if (headerMenu.current) headerMenu.current.open = false; if (onRefresh) onRefresh(); else void refresh(); }}><PageIcon name="RefreshCw" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </details>
      </>}
      <p className="ke-response-summary">{(snapshot.frame.description || snapshot.frame.objective).split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')}</p>
      <details className={`ke-response-progress ke-compact-activity${staged ? ' ke-header-activity' : ''}`}><summary aria-label={staged ? 'Show participant activity' : undefined}>{staged ? <>
        <span className="ke-response-phase" data-finished={['AGREED', 'CLOSED'].includes(snapshot.status)} title={decisionStatusText(snapshot.status)}>{findingOutcome ? 'Finding an outcome' : decisionPhaseLabel(snapshot.status)}</span>
        <span className="ke-response-status-divider" aria-hidden="true">·</span>
        <span className="ke-response-count">{snapshot.participantProgress ? `${snapshot.frame.participants.filter(person => snapshot.participantProgress?.some(progress => progress.participantId === person.id && progress.answersSaved)).length}/${snapshot.frame.participants.length} responded` : `${snapshot.frame.participants.length} participants`}<PageIcon name="ChevronRight" /></span>
      </> : <span><PageIcon name="Users" />Group activity<PageIcon name="ChevronRight" /></span>}</summary>
        <ul>{snapshot.frame.participants.map(person => {
          const approved = snapshot.approvedParticipantIds.includes(person.id);
          const progress = snapshot.participantProgress?.find(item => item.participantId === person.id);
          const answered = progress?.answersSaved;
          return <li key={person.id}><span className="ke-response-person">{groupId ? <MemberAvatar api={api} groupId={groupId} memberId={person.id} name={person.displayName} revision={snapshot.publicRevision} /> : <span aria-hidden="true" className="ke-response-person-initial">{person.displayName.slice(0, 1).toLocaleUpperCase()}</span>}<span className="ke-response-person-name">{person.displayName}</span>{person.id === owner?.ownerParticipantId && <small>You</small>}</span>
            <span className="ke-response-person-state" data-complete={approved || answered}>{approved ? 'Approved' : answered ? 'Answered' : progress ? 'Waiting for answers' : 'Not checked yet'}</span></li>;
        })}</ul>
      </details>
      <div className="ke-response-overview-actions">
      {owner && !editingAnswers && !structuredDirty && continueToProposal && <button type="button" disabled={blocked || awaitingJob} onClick={() => {
        setDetailStep('proposal');
      }}>{proposal ? ['AGREED', 'CLOSED'].includes(snapshot.status) ? 'View outcome' : 'View proposal' : 'Review follow-up'}</button>}
      {staged && mcpUrl && <button type="button" className="ke-response-text-button" onClick={() => setAssistantOpen(true)}><PageIcon name="MessageCircle" />Chat</button>}
      {!staged && <button type="button" className="ke-response-text-button" onClick={() => setDetailStep('shared')}>Decision details<PageIcon name="ChevronRight" /></button>}
      {!owner && proposal && <button type="button" onClick={() => setDetailStep('proposal')}>View proposal</button>}
      </div>
    </section>
    <section hidden={!detailStep} className={`ke-decision-subpage${detailStep === 'proposal' ? ' ke-outcome-page' : ''}`} aria-label={detailStep === 'shared' ? 'Decision details' : 'Review proposal and permissions'}>
      <a className="ke-workflow-back" href={appViewSearch({ kind: 'decision', decisionId, ...(groupId ? { groupId } : {}) })} onClick={event => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setDetailStep(null); }
      }}><PageIcon name="ArrowLeft" />Back to decision</a>
    {detailStep === 'shared' && <section className="ke-card ke-shared-decision"><h1 tabIndex={-1}>Decision details</h1><p>{snapshot.frame.description || snapshot.frame.objective}</p>
      {snapshot.frame.description && snapshot.frame.description !== snapshot.frame.objective && <details><summary>Original idea and shared details</summary><p className="ke-shared-original">{snapshot.frame.objective}</p></details>}

      <h3>Participants</h3>
      <ul aria-label="Participants and approval requirements">{snapshot.frame.participants.map(person => <li key={person.id}>{person.displayName}: {person.requiredForApproval ? 'required approval' : 'approval optional'}</li>)}</ul>
      <h3>The choices</h3>
      <ul className="ke-shared-choice-list" aria-label="Options for this decision">{snapshot.frame.variables.map(variable => {
        const options = publicChoiceOptions(snapshot.frame, variable);
        return <li key={variable.id}><strong>{variable.label}</strong>{options ? <span>{options.map(value => value.type === 'DATE' ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.date + 'T00:00:00Z')) : valueText(value, variable)).join(' · ')}</span> : <span>{variableText(variable, snapshot.frame)}</span>}</li>;
      })}</ul>
      {snapshot.frame.rules.length > 0 && <details className="ke-shared-rules"><summary>Group requirements ({snapshot.frame.rules.length})</summary>
        <ul aria-label="Group requirements">{snapshot.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, snapshot.frame.variables)}</li>)}</ul></details>}
    </section>}
    {detailStep === 'proposal' && !proposal && <header className="ke-outcome-heading"><h1 tabIndex={-1}>{snapshot.status === 'REASONING' ? 'Finding an outcome' : 'No outcome yet'}</h1>
      <p>{snapshot.status === 'REASONING' ? 'We’re comparing the saved answers. You can return to this page to check progress.' : 'An outcome will appear here once the group’s answers are ready and a proposal has been prepared.'}</p></header>}
    {detailStep === 'proposal' && proposal && <section className="ke-outcome-result" aria-labelledby="outcome-title">
      <header className="ke-outcome-heading"><h1 id="outcome-title" tabIndex={-1}>{snapshot.status === 'AGREED' ? 'Decision agreed' : 'Proposed outcome'}</h1>
        <p>{snapshot.status === 'AGREED' ? 'All required participants approved this proposal.' : 'Review the choices before giving your approval.'}</p>
      </header>
      <dl className="ke-outcome-choices" aria-label="Selected shared choices">{proposal.facts.values.map(item => {
        const variable = variables.find(variable => variable.id === item.variableId);
        return <div key={item.variableId}><dt>{variable?.label ?? 'Choice'}</dt><dd>{item.value.type === 'DATE'
          ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(item.value.date + 'T00:00:00Z')) : valueText(item.value, variable)}</dd></div>;
      })}</dl>
      {owner?.privateProposalValues && <section className="ke-outcome-private"><h3><PageIcon name="Lock" />Details shown only to you</h3>
        <dl>{owner.privateProposalValues.values.map(item => <div key={item.variableId}><dt>{variables.find(variable => variable.id === item.variableId)?.label ?? 'Your choice'}</dt><dd>{valueText(item.value, variables.find(variable => variable.id === item.variableId))}</dd></div>)}</dl>
      </section>}
      <details className="ke-outcome-approvals"><summary><span><PageIcon name="Users" />{snapshot.frame.requiredParticipantIds.filter(id => snapshot.approvedParticipantIds.includes(id)).length} of {snapshot.frame.requiredParticipantIds.length} approved</span><PageIcon name="ChevronRight" /></summary>
        <ul>{snapshot.frame.participants.map(person => <li key={person.id}><span>{person.displayName}{person.id === owner?.ownerParticipantId && <small>You</small>}{!person.requiredForApproval && <small>Optional</small>}</span>
          <span data-approved={snapshot.approvedParticipantIds.includes(person.id)}>{snapshot.approvedParticipantIds.includes(person.id) ? 'Approved' : 'Not approved'}</span></li>)}</ul>
      </details>
      {owner && (owner.ownApproval ? <div className="ke-outcome-your-approval"><p><PageIcon name="Check" />You approved this outcome.</p>
        <button type="button" className="ke-outcome-text-action" disabled={blocked} onClick={() => void command('WITHDRAW_APPROVAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Withdraw approval</button>
      </div> : <div className="ke-outcome-approve">
        <label><input type="checkbox" disabled={blocked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>I’ve reviewed this exact proposal, including any details shown only to me.</span></label>
        <button type="button" disabled={blocked || !reviewed} onClick={() => void command('APPROVE_PROPOSAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Approve proposal<PageIcon name="Check" /></button>
      </div>)}
      <details className="ke-outcome-about"><summary>About this outcome</summary>
        <p>This proposal fits the saved requirements the app can compare. Check it against your own needs before approving. It may not be the best possible option. {decisionId.startsWith('groupdecision-') ? '' : 'This example uses made-up offers. '}It does not make a booking or purchase, or establish legal ownership.</p>
        <p>Your approval applies only to this proposal. Agreeing to an adjustment or sharing a private detail is a separate choice. Outcomes can still hint at someone’s needs.</p>
      </details>
      {recoveryControls}{notice && <p role="status" className="ke-outcome-notice">{notice}</p>}
    </section>}
    {detailStep === 'proposal' && owner && (!staged || allConfirmed) && (owner.pendingQuestions.some(question => question.status === 'PENDING') || owner.negotiationPermissions.some(permission => permission.status === 'ACTIVE')) && <section className="ke-card ke-outcome-auxiliary"><h2>Your extra requirements</h2>
      {owner.pendingQuestions.filter(question => question.status === 'PENDING').map(question => <div key={question.questionId}><h3>Would this adjustment work?</h3>
        <p>Would this work for you if it still meets your must-have requirements?</p><p>{ruleText(question.adjustment, variables)}</p>
        <p>Expires {question.expiresAt}. Allowing this adjustment doesn’t share your requirements or approve the final proposal.</p>
        {(['ALLOW', 'DECLINE'] as const).map(answer => <button key={answer} disabled={blocked} onClick={() => void command('ANSWER_NEGOTIATION', {
          questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer })}>{answer === 'ALLOW' ? 'Allow this adjustment' : 'Decline this adjustment'}</button>)}
      </div>)}
      {owner.negotiationPermissions.filter(permission => permission.status === 'ACTIVE').map(permission => <div key={permission.permissionId}><h3>Adjustment you allowed</h3>
        <p>{ruleText(permission.adjustment, variables)}</p><p>Expires {permission.expiresAt}. You can stop allowing this adjustment for future proposals.</p>
        <button disabled={blocked} onClick={() => void command('REVOKE_NEGOTIATION', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion })}>Stop allowing this adjustment</button>
      </div>)}
    </section>}
    {detailStep === 'proposal' && owner && owner.disclosurePermissions.length > 0 && <section className="ke-card ke-outcome-auxiliary"><h2>Details you choose to share</h2>
      <p>You choose which private details to share. Declining to share doesn’t reject the proposal.</p>
      {owner.disclosurePermissions.map(permission => <div key={permission.permissionId}>
        <h3>{permission.status === 'PENDING' ? 'Check the details to share' : 'Sharing permission'}</h3>
        {permission.kind === 'EXACT_TEXT' ? <blockquote>{permission.text}</blockquote> : <ul>{permission.variableIds.map(id => {
          const variable = variables.find(item => item.id === id); const assignment = owner.privateProposalValues?.values.find(item => item.variableId === id);
          return <li key={id}>{variable?.label ?? 'Your choice'}: {assignment ? valueText(assignment.value, variable) : 'Refresh to review the current proposal value.'}</li>;
        })}</ul>}
        <p>Audience: {permission.audienceParticipantIds.map(id => snapshot.frame.participants.find(person => person.id === id)?.displayName ?? 'Earlier group member').join(', ')}.</p>
        <p>Expires {permission.expiresAt}. {permission.status === 'PENDING' ? 'You haven’t allowed this to be shared yet' : permission.status === 'ACTIVE' ? 'You’ve allowed this to be shared; it has not necessarily been posted' : permission.status.toLowerCase()}.</p>
        {permission.status === 'PENDING' && <>
          <button disabled={blocked || (permission.kind === 'VARIABLE_VALUES' && (!owner.privateProposalValues || permission.variableIds.some(id => !owner.privateProposalValues!.values.some(value => value.variableId === id))))} onClick={() => void command('DECIDE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion, decision: 'ALLOW' })}>Allow sharing</button>
          <button disabled={blocked} onClick={() => void command('DECIDE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion, decision: 'DECLINE' })}>Keep private</button>
        </>}
        {permission.status === 'ACTIVE' && <button disabled={blocked} onClick={() => void command('REVOKE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion })}>Stop future sharing</button>}
        <p>Stopping sharing prevents new posts of this detail. It won’t remove information people have already seen.</p>
      </div>)}
    </section>}
    {detailStep === 'proposal' && !proposal && owner && <>{recoveryControls}{notice && <p role="status" className="ke-outcome-notice">{notice}</p>}</>}
    </section>
    {assistantOpen && mcpUrl && <Suspense fallback={<p role="status">Opening assistant…</p>}><AlexaChat decisionId={decisionId} title={title ?? snapshot.frame.title} groupId={groupId} endpoint={mcpUrl} api={api} onClose={() => setAssistantOpen(false)} /></Suspense>}
    {owner && <div hidden={!!detailStep}><PrivateAnswersModal embedded open={true} owner={owner} busy={busy} blocked={answersBlocked} saveBlocked={false} notesLocked={!!interpretationRequest} notes={text} consent={syntheticProcessing} notice={notice} recovery={recoveryControls}
        onClose={() => {}} onNotes={setText} onConsent={setSyntheticProcessing} onInterpret={interpret} onDirty={setStructuredDirty} onEditingChange={setEditingAnswers}
        onSave={payload => command('CONFIRM_PRIVATE_ANSWERS', payload)} describeValue={valueText} describeCondition={describeCondition} /></div>}
    {!owner && notice && <p role="status">{notice}</p>}
  </>;
}
