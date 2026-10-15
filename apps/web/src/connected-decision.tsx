import { useEffect, useRef, useState } from 'react';
import { KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';
import { PrivateAnswersModal } from './private-answers-modal';
import { backgroundRequest, submitBackgroundRequest, type BackgroundReceipt } from './background-negotiation';

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
    case 'ENUM': case 'ENUM_SET': return `${variable.label} (${variable.type === 'ENUM' ? 'one option' : 'set of options'}, ${requirement}): ${variable.options.map(item => item.label).join(', ')}`;
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

export function ConnectedDecision({ snapshot, owner, api, refresh, backgroundNegotiation = false, onQueued, onDirtyChange, staged = false }: {
  snapshot: KE.PublicDecisionSnapshot; owner: KE.OwnerDecisionSnapshot | null;
  api: (path: string, init?: RequestInit) => Promise<Response>; refresh: () => Promise<void>;
  backgroundNegotiation?: boolean; onQueued?: (receipt: BackgroundReceipt) => void; onDirtyChange?: (dirty: boolean) => void; staged?: boolean;
}) {
  const [text, setText] = useState('');
  const [syntheticProcessing, setSyntheticProcessing] = useState(false);
  const [detailStep, setDetailStep] = useState<'shared' | 'proposal' | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (detailStep) detailDialog.current?.showModal(); else detailDialog.current?.close(); }, [detailStep]);
  const [editingNeeds, setEditingNeeds] = useState(false);
  const [structuredDirty, setStructuredDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewedFrame, setReviewedFrame] = useState<string | null>(null);
  useEffect(() => { setReviewed(false); }, [owner?.draft?.draftId, snapshot.currentProposal?.proposalId]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [awaitingJob, setAwaitingJob] = useState(false);
  useEffect(() => { if (snapshot.status !== 'REASONING') setAwaitingJob(false); }, [snapshot.status, owner?.controlVersion]);
  const pending = useRef<{ type: string; body: unknown } | null>(null);
  const commandGuard = useRef(false);
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
  const confirmed = owner && snapshot.frameConfirmations.some(item => item.participantId === owner.ownerParticipantId);
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
          controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion }, payload } };
    }
    try {
      KE.DecisionCommandResult.parse(await request(`/decisions/${decisionId}/commands`, pending.current.body));
      pending.current = null; setPendingAction(false); setReviewed(false);
      await refresh(); setNotice(type === 'CONFIRM_FRAME' ? 'Your confirmation of what we’re deciding is saved.' : type === 'CONFIRM_PRIVATE_ANSWERS' ? 'Your private answers are saved. Any unanswered needs still require clarification.' : type === 'CONFIRM_CONSTRAINTS' ? 'Your selected private conditions are confirmed.' : 'Your choice is recorded.');
      if (type === 'CONFIRM_PRIVATE_ANSWERS') { setText(''); setStructuredDirty(false); }
      return true;
    } catch (error) {
      if (error instanceof DecisionRequestError && error.status === 409) {
        pending.current = null; setPendingAction(false); setReviewedFrame(null); setReviewed(false);
        try { await refresh(); setNotice('The decision changed while you were reviewing it. The latest version is loaded; review and confirm it again.'); }
        catch { setNotice('The decision changed. Refresh its current state before confirming again.'); }
      } else if (error instanceof DecisionRequestError && [400,401,403,404,422].includes(error.status)) {
        pending.current = null; setPendingAction(false);
        setNotice((error.status === 401 ? 'Your session expired. Sign in again; your unsaved answers are kept in this window.' : 'These answers could not be saved. Your selections are kept. Review the current choices and your access before trying again.') + (error.reference ? ` Reference: ${error.reference}.` : ''));
      } else setNotice('The action was rejected or its result is unknown. Retry the same action, or refresh to review current state.');
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
      setText(''); setReviewed(false); setNotice('AI suggestions for your notes are saved. Review them before including any; your selected options are unchanged.');
    } else if (value.interpretation?.state === 'FAILED') {
      clearInterpretation(); setNotice('No new interpretation was saved. Your text and earlier saved conditions are kept. You can edit and try again.');
    } else if (value.interpretation?.state === 'NOT_SUBMITTED') {
      setNotice('AI has not started this request. Close it before editing or starting another interpretation. Your text is kept.');
    } else if (value.interpretation?.state === 'PENDING' || value.interpretation?.state === 'UNKNOWN') {
      setNotice('The interpretation result is not confirmed yet. Check this request before submitting again; no second AI call will start.');
    } else throw new Error('invalid');
  };
  const checkInterpretation = async () => {
    if (!interpretationRequest || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true);
    try {
      const response = await api(`/decisions/${decisionId}/owner-conversation/requests/${interpretationRequest}`);
      if (!response.ok) throw new Error('unavailable');
      await acceptInterpretation(await response.json());
    } catch { setNotice('We could not check the interpretation result. Your text is kept. Check again; contact the operator if it stays unresolved.'); }
    finally { interpretationGuard.current = false; setBusy(false); }
  };
  const closeInterpretation = async () => {
    if (!interpretationRequest || interpretationRelease === null || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true);
    try { await acceptInterpretation(await request(`/decisions/${decisionId}/owner-conversation/requests/${interpretationRequest}/close`, { revision: interpretationRelease })); }
    catch { setNotice('The request could not be closed safely. Check its current result before trying again. Your text is kept.'); }
    finally { interpretationGuard.current = false; setBusy(false); }
  };
  const interpret = async () => {
    if (!allConfirmed || !confirmed || !text.trim() || !syntheticProcessing || interpretationRequest || interpretationGuard.current) return;
    interpretationGuard.current = true; setBusy(true); setNotice('');
    const requestId = crypto.randomUUID(); interpretationStorageKey.current = interpretationKey; sessionStorage.setItem(interpretationKey, requestId); setInterpretationRequest(requestId);
    try {
      await acceptInterpretation(await request(`/decisions/${decisionId}/owner-conversation/draft`, { requestId, processingConsent: 'SYNTHETIC_TEST', messages: [{ role: 'owner', text }] }));
    } catch (error) {
      if (error instanceof DecisionRequestError) {
        const reference = error.reference ? ` Reference: ${error.reference}.` : '';
        if ([400, 401, 403, 404, 409, 422].includes(error.status) || ['AI_UNAVAILABLE', 'AI_AT_CAPACITY', 'FRAME_NOT_CONFIRMED', 'PROCESSING_NOT_READY'].includes(error.category)) clearInterpretation();
        setNotice((error.status === 401 ? 'Your session expired. Sign in again; your unsent text is kept in this window.'
          : error.category === 'FRAME_NOT_CONFIRMED' ? 'Everyone must confirm the current shared frame before interpretation. Refresh the decision to see the missing confirmations.'
          : error.category === 'PROCESSING_NOT_READY' ? 'Private AI processing is not set up for this account. Your text is kept; contact the operator.'
          : error.category === 'AI_AT_CAPACITY' ? 'AI is at capacity. No interpretation started. Your text is kept; try again later.'
          : error.status === 404 || error.category === 'AI_UNAVAILABLE' ? 'Private interpretation is not available on this server yet. Your text is kept; contact the operator.'
          : error.status === 409 ? 'The shared frame changed. Refresh and review its current version before interpreting your conditions.'
          : error.status === 422 ? 'The interpretation could not be accepted. Your text and earlier conditions are kept; clarify your text before trying again.'
          : 'The interpretation result is uncertain. Check this request before submitting again.') + reference);
      } else setNotice('The interpretation result is uncertain. Your text is kept. Check this request before submitting again.');
    } finally { interpretationGuard.current = false; setBusy(false); }
  };
  const generate = async () => {
    setBusy(true); setNotice('');
    try {
      if (backgroundNegotiation && owner) {
        if (!pending.current) { pending.current = { type: 'REQUEST_NEGOTIATION', body: backgroundRequest(snapshot, owner, crypto.randomUUID()) }; setPendingAction(true); }
        if (pending.current.type !== 'REQUEST_NEGOTIATION') throw new Error('action pending');
        // Keep the same command after an uncertain acknowledgement; never manufacture a second job request.
        const receipt = await submitBackgroundRequest(api, pending.current.body as ReturnType<typeof backgroundRequest>);
        pending.current = null; setPendingAction(false); setAwaitingJob(true); setNotice('Your request is saved. Results will appear automatically.');
        if (onQueued) onQueued(receipt); else await refresh();
      } else { await request(`/decisions/${decisionId}/reasoning`, { requestId: crypto.randomUUID() }); await refresh(); }
    }
    catch { setNotice('Exploration is unavailable. Refresh and check confirmations, or try again.'); }
    finally { setBusy(false); }
  };
  const proposal = snapshot.currentProposal;
  const blocked = busy || pendingAction || !!interpretationRequest;
  useEffect(() => { onDirtyChange?.(!!text.trim() || structuredDirty || pendingAction || !!interpretationRequest || busy); }, [text, structuredDirty, pendingAction, interpretationRequest, busy, onDirtyChange]);
  const describeCondition = (item: KE.AIConstraintDraft['proposedConstraints'][number]) => item.kind === 'PREFERENCE'
    ? `I prefer ${variables.find(variable => variable.id === item.preference.variableId)?.label ?? 'this choice'}: ${valueText(item.preference.value, variables.find(variable => variable.id === item.preference.variableId))}`
    : `${item.kind === 'HARD' ? 'Must work for me' : 'Ask me before changing'}: ${ruleText(item.rule, variables)}`;
  const recoveryControls = <>
    {interpretationRequest && <div className="ke-wizard-recovery" role="status"><p>Your previous AI notes request needs a status check. Your selections and saved conditions are kept.</p><button type="button" disabled={busy} onClick={() => void checkInterpretation()}>Check AI notes result</button>{interpretationRelease !== null && <button type="button" disabled={busy} onClick={() => void closeInterpretation()}>Close AI notes request</button>}</div>}
    {pendingAction && <div className="ke-wizard-recovery"><p>The previous action needs a result check. Do not submit different answers yet.</p><button type="button" disabled={busy} onClick={() => void (pending.current!.type === 'REQUEST_NEGOTIATION' ? generate() : command(pending.current!.type, {}))}>Retry the same action</button>
      <button type="button" disabled={busy} onClick={() => { void (async () => { setBusy(true); try { await refresh(); pending.current = null; setPendingAction(false); setReviewed(false); setReviewedFrame(null); setNotice('The latest decision is loaded. Review it before confirming again.'); } catch { setNotice('The latest state could not be loaded. Your pending action is kept; try refreshing again.'); } finally { setBusy(false); } })(); }}>Refresh and review current state</button></div>}
  </>;
  const continueToProposal = !!proposal || owner?.ownInputReadiness === 'READY' || !!owner?.pendingQuestions.some(question => question.status === 'PENDING') || !!owner?.disclosurePermissions.some(permission => permission.status === 'PENDING');
  const nextStep = !confirmed || !allConfirmed ? 'Review shared choices' : proposal ? 'Review proposal' : continueToProposal ? 'Continue' : 'What works for you?';
  return <>
    <section className="ke-card ke-decision-overview">
      <p>{(snapshot.frame.description || snapshot.frame.objective).split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')}</p>
      {owner && <><h3>Your answers · private</h3>{owner.confirmedConstraints.some(item => item.status === 'ACTIVE')
        ? <ul>{owner.confirmedConstraints.filter(item => item.status === 'ACTIVE').slice(0, 3).map(item => <li key={item.constraintId}>{describeCondition(item)}</li>)}</ul>
        : <p>{owner.ownInputReadiness === 'READY' ? 'Your answers are saved. All available choices work for you.' : "You haven't answered yet."}</p>}</>}
      {owner && owner.confirmedConstraints.filter(item => item.status === 'ACTIVE').length > 3 && <p>More saved conditions are available in your private answers.</p>}
      <h3>Everyone’s progress</h3><ul>{snapshot.frame.participants.map(person => <li key={person.id}>{person.displayName}: {snapshot.approvedParticipantIds.includes(person.id) ? 'proposal approved' : !snapshot.frameConfirmations.some(item => item.participantId === person.id) ? 'reviewing choices' : !snapshot.participantProgress ? 'choices confirmed' : snapshot.participantProgress.find(item => item.participantId === person.id)?.answersSaved ? 'answers saved' : 'answers pending'}</li>)}</ul>
      {owner && <button type="button" disabled={busy} onClick={() => { if (!confirmed || !allConfirmed) setDetailStep('shared'); else if (continueToProposal) setDetailStep('proposal'); else setEditingNeeds(true); }}>{nextStep}</button>}
      {confirmed && !allConfirmed && <p>Waiting for everyone to review the shared choices before private answers can be saved.</p>}
      {owner && confirmed && nextStep !== 'What works for you?' && <button type="button" className="secondary" disabled={busy || !allConfirmed} onClick={() => setEditingNeeds(true)}>What works for you?</button>}
      <button type="button" className="secondary" onClick={() => setDetailStep('shared')}>Shared details</button>
      {!owner && proposal && <button type="button" onClick={() => setDetailStep('proposal')}>View proposal</button>}
    </section>
    <dialog ref={detailDialog} className="ke-step-dialog" aria-label={detailStep === 'shared' ? 'Review shared choices' : 'Review proposal and permissions'} onCancel={event => { event.preventDefault(); setDetailStep(null); }}>
      <button type="button" className="secondary" onClick={() => setDetailStep(null)}>Back to overview</button>
    {detailStep === 'shared' && <section className="ke-card ke-shared-decision"><h2>What we’re deciding</h2><p>{snapshot.frame.description || snapshot.frame.objective}</p>
      {snapshot.frame.description && snapshot.frame.description !== snapshot.frame.objective && <details><summary>Original idea and shared details</summary><p className="ke-shared-original">{snapshot.frame.objective}</p></details>}
      <p>Review the choices, people and shared rules before confirming.</p>
      <h3>People reviewing this decision</h3>
      <ul aria-label="Frame participants and approvals">{snapshot.frame.participants.map(person => <li key={person.id}>{person.displayName}: {person.requiredForApproval ? 'approval needed' : 'optional participant'} · {snapshot.frameConfirmations.some(item => item.participantId === person.id) ? 'review confirmed' : 'review pending'}</li>)}</ul>
      <h3>The choices</h3>
      <ul className="ke-shared-choice-list" aria-label="Shared frame options and types">{snapshot.frame.variables.map(variable => {
        const options = publicChoiceOptions(snapshot.frame, variable);
        return <li key={variable.id}><strong>{variable.label}</strong>{options ? <span>{options.map(value => value.type === 'DATE' ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.date + 'T00:00:00Z')) : valueText(value, variable)).join(' · ')}</span> : <span>{variableText(variable, snapshot.frame)}</span>}</li>;
      })}</ul>
      <details className="ke-shared-rules"><summary>Shared rules ({snapshot.frame.rules.length})</summary>
      {snapshot.frame.rules.length ? <ul aria-label="Public decision rules">{snapshot.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, snapshot.frame.variables)}</li>)}</ul> : <p>No additional shared rules.</p>}</details>
      <p>{snapshot.frame.requiredParticipantIds.filter(id => snapshot.frameConfirmations.some(item => item.participantId === id)).length} of {snapshot.frame.requiredParticipantIds.length} people have confirmed these choices.</p>
      {owner && confirmed && <p>You have confirmed what we’re deciding.</p>}
      {!allConfirmed && <p>Waiting for {snapshot.frame.participants.filter(person => snapshot.frame.requiredParticipantIds.includes(person.id) && !snapshot.frameConfirmations.some(item => item.participantId === person.id)).map(person => person.displayName).join(', ')} to confirm. Each person must review these choices in their own account before private answers can be saved.</p>}
      {owner && !confirmed && <><label><input type="checkbox" disabled={blocked} checked={reviewedFrame === frameReviewKey}
        onChange={event => setReviewedFrame(event.target.checked ? frameReviewKey : null)} />I reviewed these choices, the people and the shared rules.</label>
        <button disabled={blocked || reviewedFrame !== frameReviewKey} onClick={() => void command('CONFIRM_FRAME', { frameVersion: snapshot.frame.frameVersion })}>Confirm these shared choices</button></>}
    </section>}
    {detailStep === 'proposal' && owner && (!staged || allConfirmed) && <section className="ke-card"><h2>Your private answers</h2>
      <p>Choose what works for you. Your selections are saved directly; optional AI help is available for extra notes.</p>
      <p className="ke-help">Other participants cannot read your answers or private notes. Outcomes may imply information about people’s needs. Use fictional, non-sensitive data in this preview.</p>
      {owner.ownInputReadiness === 'READY' ? <p>Your current private answers are saved.</p> : owner.ownInputReadiness === 'NEEDS_CLARIFICATION' ? <p>Some needs still need clarification or new shared options. Open your answers to review them.</p> : <p>Your private answers have not been saved yet.</p>}
      <button type="button" disabled={busy || !allConfirmed || !confirmed} onClick={() => setEditingNeeds(true)}>{owner.ownInputReadiness === 'NOT_STARTED' ? 'Add my private answers' : 'Review or change my private answers'}</button>
      {!allConfirmed && <p>Everyone must confirm the shared choices first.</p>}

      {owner.pendingQuestions.filter(question => question.status === 'PENDING').map(question => <div key={question.questionId}><h3>Private negotiation question</h3>
        <p>Would this alternative work, provided all your confirmed must-have requirements still pass?</p><p>{ruleText(question.adjustment, variables)}</p>
        <p>Expires {question.expiresAt}. Permission for this adjustment does not disclose your conditions or approve a final proposal.</p>
        {(['ALLOW', 'DECLINE'] as const).map(answer => <button key={answer} disabled={blocked} onClick={() => void command('ANSWER_NEGOTIATION', {
          questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer })}>{answer === 'ALLOW' ? 'Allow this adjustment' : 'Decline this adjustment'}</button>)}
      </div>)}
      {owner.negotiationPermissions.filter(permission => permission.status === 'ACTIVE').map(permission => <div key={permission.permissionId}><h3>Your allowed adjustment</h3>
        <p>{ruleText(permission.adjustment, variables)}</p><p>Expires {permission.expiresAt}. You can revoke permission for future use.</p>
        <button disabled={blocked} onClick={() => void command('REVOKE_NEGOTIATION', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion })}>Revoke this adjustment</button>
      </div>)}
      {(!staged || ['READY', 'SUPERSEDED', 'NO_AGREEMENT'].includes(snapshot.status)) && <button disabled={blocked || awaitingJob || !['READY', 'SUPERSEDED', 'NO_AGREEMENT'].includes(snapshot.status)} onClick={() => void generate()}>Explore proposals</button>}
    </section>}
    {detailStep === 'proposal' && owner && owner.disclosurePermissions.length > 0 && <section className="ke-card"><h2>Your disclosure choices</h2>
      <p>Sharing a detail is separate from allowing an adjustment or approving a proposal. Declining to share does not by itself reject the proposal.</p>
      {owner.disclosurePermissions.map(permission => <div key={permission.permissionId}>
        <h3>{permission.status === 'PENDING' ? 'Review this exact disclosure' : 'Disclosure record'}</h3>
        {permission.kind === 'EXACT_TEXT' ? <blockquote>{permission.text}</blockquote> : <ul>{permission.variableIds.map(id => {
          const variable = variables.find(item => item.id === id); const assignment = owner.privateProposalValues?.values.find(item => item.variableId === id);
          return <li key={id}>{variable?.label ?? 'Your value'}: {assignment ? valueText(assignment.value, variable) : 'Refresh to review the current proposal value.'}</li>;
        })}</ul>}
        <p>Audience: {permission.audienceParticipantIds.map(id => snapshot.frame.participants.find(person => person.id === id)?.displayName ?? 'Earlier group member').join(', ')}.</p>
        <p>Expires {permission.expiresAt}. {permission.status === 'PENDING' ? 'Not yet allowed or published.' : permission.status === 'ACTIVE' ? 'Permission recorded; publication is a separate action.' : permission.status.toLowerCase()}.</p>
        {permission.status === 'PENDING' && <>
          <button disabled={blocked || (permission.kind === 'VARIABLE_VALUES' && (!owner.privateProposalValues || permission.variableIds.some(id => !owner.privateProposalValues!.values.some(value => value.variableId === id))))} onClick={() => void command('DECIDE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion, decision: 'ALLOW' })}>Allow this disclosure</button>
          <button disabled={blocked} onClick={() => void command('DECIDE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion, decision: 'DECLINE' })}>Decline this disclosure</button>
        </>}
        {permission.status === 'ACTIVE' && <button disabled={blocked} onClick={() => void command('REVOKE_DISCLOSURE', { permissionId: permission.permissionId, permissionVersion: permission.permissionVersion })}>Revoke future disclosure</button>}
        <p>Revoking stops future publication. People cannot unread information already shared.</p>
      </div>)}
    </section>}
    {detailStep === 'proposal' && proposal && <section className="ke-card"><h2>{decisionId.startsWith('groupdecision-') ? 'Current proposal' : 'Current hypothetical proposal'}</h2>
      <ul>{proposal.facts.values.map(item => <li key={item.variableId}>{variables.find(variable => variable.id === item.variableId)?.label}: {valueText(item.value, variables.find(variable => variable.id === item.variableId))}</li>)}</ul>
      {owner?.privateProposalValues && <div><h3>Your private part of this proposal</h3>
        <ul>{owner.privateProposalValues.values.map(item => <li key={item.variableId}>{variables.find(variable => variable.id === item.variableId)?.label}: {valueText(item.value, variables.find(variable => variable.id === item.variableId))}</li>)}</ul></div>}
      <p>Valid under currently confirmed supported conditions. {decisionId.startsWith('groupdecision-') ? 'Review the actual choices and your own needs before approving; this is not a promise of the best possible outcome.' : 'All offers are synthetic.'} This does not execute a booking or purchase, or establish legal ownership.</p>
      <p>{snapshot.approvedParticipantIds.length} of {snapshot.frame.requiredParticipantIds.length} approvals. {snapshot.status === 'AGREED' ? 'Everyone approved this exact outcome.' : 'Agreement is still pending.'}</p>
      {owner && <><label><input type="checkbox" disabled={blocked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the shared outcome and my private part of this exact proposal.</label>
        <button disabled={blocked || !reviewed || !!owner.ownApproval} onClick={() => void command('APPROVE_PROPOSAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Approve this exact proposal</button>
        {owner.ownApproval && <button disabled={blocked} onClick={() => void command('WITHDRAW_APPROVAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Withdraw my approval</button>}</>}
    </section>}
    </dialog>
    {owner && <PrivateAnswersModal open={editingNeeds} owner={owner} busy={busy} blocked={blocked} notes={text} consent={syntheticProcessing} notice={notice} recovery={recoveryControls}
        onClose={() => setEditingNeeds(false)} onNotes={setText} onConsent={setSyntheticProcessing} onInterpret={interpret} onDirty={setStructuredDirty}
        onSave={payload => command('CONFIRM_PRIVATE_ANSWERS', payload)} describeValue={valueText} describeCondition={describeCondition} />}
    {!editingNeeds && recoveryControls}
    {!editingNeeds && notice && <p role="status">{notice}</p>}
  </>;
}
