import { DecisionGuide } from './decision-guide';
import { RenameAction } from './rename-action';
import { useEffect, useRef, useState } from 'react';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { ruleText, variableText, valueText } from './connected-decision';
import { readDraftRequest,saveDraftRequest,draftFailureMessage } from './draft-request-state';
import { LoadingSkeleton, PageIcon } from './app-chrome';
class UserFlowError extends Error {}
function guidanceText(value: string) { return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function savedPublicAnswer(draft: Groups.GroupDraft | null, question: string): string | undefined {
  return [...(draft?.publicClarifications ?? [])].reverse().find(item => guidanceText(item.question) === guidanceText(question))?.answer;
}
const suggestionAnswer = 'I am not sure yet. Suggest a small set of clearly labelled provisional shared options for us to review. Keep our earlier answers, and do not assume anyone’s private preferences, availability or budget.';
const rebuildAnswer = 'Use the shared alternatives already in my original idea and saved answers to build the choices for review. Keep all alternatives unselected. Each person will provide their preferred option, availability and spending limits privately later. Do not ask me for their preferences.';
function publicChoiceValues(variable: KE.PublicDecisionFrame['variables'][number], frame: KE.PublicDecisionFrame): string[] {
  if (variable.type === 'ENUM' || variable.type === 'ENUM_SET') return variable.options.map(option => option.label);
  const rule = frame.rules.find(item => 'variableId' in item && item.variableId === variable.id && (item.operator === 'IN' || item.operator === 'COMPARE' && item.comparison === 'EQ'));
  return rule?.operator === 'IN' ? rule.values.map(value => valueText(value, variable)) : rule?.operator === 'COMPARE' ? [valueText(rule.value, variable)] : [];
}
const privateAnswer = 'Each participant should provide their own preferences, availability and spending limits privately later. Help us draft the shared choices now without assuming those personal answers.';
export function GroupDecisions({ group, api, reload, openDecision, onDirtyChange }: { group: Groups.GroupSnapshot;
  api: (path: string, init?: RequestInit) => Promise<Response>; reload: () => Promise<void>; openDecision: (id: string) => void; startCollapsed?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [showExample, setShowExample] = useState(false);
  const exampleTrigger = useRef<HTMLButtonElement>(null);
  const returnFromExample = () => { setShowExample(false); exampleTrigger.current?.focus(); };
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState<'describe' | 'questions' | 'review'>('describe');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [aiWorking, setAiWorking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'DRAFT' | 'DECISION'; id: string; title: string } | null>(null);
  useEffect(() => {
    const element = deleteDialog.current;
    if (deleteTarget && group.isOrganizer) { if (element && !element.open) element.showModal(); }
    else element?.close();
  }, [deleteTarget, group.isOrganizer]);
  const busyGuard = useRef(false);
  const objectiveInput = useRef<HTMLTextAreaElement>(null);
  const descriptionHelp = useRef<HTMLDetailsElement>(null);
  const [helpGoal, setHelpGoal] = useState('');
  const [helpOptions, setHelpOptions] = useState('');
  const [helpUnknowns, setHelpUnknowns] = useState('');
  const [objective, setObjective] = useState(''); const [draft, setDraft] = useState<Groups.GroupDraft | null>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (starting && dialog.current?.open) draftHeading.current?.focus(); }, [starting, step, questionIndex]);
  useEffect(() => {
    const element = dialog.current;
    if (starting && group.isOrganizer) { if (element && !element.open) element.showModal(); draftHeading.current?.focus(); }
    else element?.close();
    if (!starting || !group.isOrganizer) return;
    const prior = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prior; };
  }, [starting, group.isOrganizer]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answersByQuestion = useRef<Record<string, string>>({});
  useEffect(() => { setAnswers(Object.fromEntries((draft?.clarificationQuestions ?? []).map((question, index) => [index, answersByQuestion.current[question] ?? savedPublicAnswer(draft, question) ?? '']))); setQuestionIndex(0); }, [draft?.id]);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const pending = useRef<{ objective?: string; followUp?: { draftId: string; revision: number; answers: string[] }; idempotencyKey: string } | null>(null);
  const [pendingKey,setPendingKey] = useState<string | null>(() => group.isOrganizer ? readDraftRequest(group.id) : null);
  const [checkingRequest,setCheckingRequest] = useState(group.isOrganizer);
  const [requestLookupAvailable,setRequestLookupAvailable] = useState(false);
  const [requestState,setRequestState] = useState<{ state: string; canRelease: boolean; revision: number; progress?: string } | null>(null);
  useEffect(() => { onDirtyChange?.(busy || !!pendingKey || dirty || (!!objective.trim() && objective !== draft?.frame.objective) || Object.entries(answers).some(([index, value]) => !!value.trim() && value !== savedPublicAnswer(draft, draft?.clarificationQuestions[Number(index)] ?? ''))); }, [busy, pendingKey, dirty, objective, answers, draft, onDirtyChange]);
  const recoveryEpoch = useRef(0);
  const [recoveryGeneration,setRecoveryGeneration] = useState(0);
  const finishRequest = () => { pending.current = null; saveDraftRequest(group.id,null); setPendingKey(null); setRequestState(null); setCheckingRequest(true); setRequestLookupAvailable(false); setRecoveryGeneration(value => value + 1); };
  async function recoverRequest(key = pendingKey) {
    if (!key) return; const epoch = ++recoveryEpoch.current;
    const result = await request('draft-requests/' + key);
    if (epoch !== recoveryEpoch.current) return;
    const state = result.draftRequest;
    if (!state || typeof state !== 'object' || !('state' in state) || !('canRelease' in state) || !('revision' in state)
      || !['SAVED','NOT_SUBMITTED','PENDING','UNKNOWN','FAILED','CANCELLED'].includes(String(state.state)) || typeof state.canRelease !== 'boolean' || !Number.isSafeInteger(state.revision)
      || ('progress' in state && !['NOT_STARTED','IN_PROGRESS','EXPIRED','NEEDS_RECOVERY','STOPPED'].includes(String(state.progress)))) throw new Error('Invalid request status');
    setRequestState({ state: String(state.state), canRelease: state.canRelease, revision: Number(state.revision), ...('progress' in state ? { progress: String(state.progress) } : {}) });
    if (state.state === 'SAVED' && 'draft' in state) { const saved = Groups.GroupDraft.parse(state.draft); setDraft(saved); setObjective(saved.frame.objective); setQuestionIndex(0); setStep(saved.clarificationQuestions.length ? 'questions' : 'review'); setDirty(false); setReviewed(false); finishRequest(); setNotice('The saved draft was recovered without another AI call.'); await reload(); }
    else if (state.state === 'FAILED' && state.canRelease) {
      // Only a confirmed terminal outcome may close automatically. Unknown or active
      // calls keep their original key; this never starts another paid request.
      const released = await request(`draft-requests/${key}/release`, { revision: state.revision });
      if (epoch !== recoveryEpoch.current) return;
      const value = released.draftRequest as { state?: unknown; canRelease?: unknown } | undefined;
      if (!value || !['FAILED','CANCELLED'].includes(String(value.state)) || value.canRelease !== true) throw new Error('Terminal release not confirmed');
      finishRequest();
      setNotice('That attempt finished without a new draft. Your saved draft and answers are kept. You can edit and try again; no automatic AI retry was made.');
      return 'CLOSED';
    }
    else setNotice('progress' in state && state.progress === 'EXPIRED' ? 'This request expired before AI started. Close the unfinished request to return to your saved draft.'
      : state.state === 'UNKNOWN' ? 'We haven’t confirmed the AI result yet. Keep this request and check again; contact the operator if it stays uncertain.'
      : state.state === 'PENDING' ? state.canRelease ? 'AI has not started this request. Check progress or close it to return to your draft.' : 'The request has not finished. Check progress; if it stays unresolved, contact the operator.'
      : 'This request has stopped. Choose “Close unfinished request” to continue.');
    return state.state === 'SAVED' && 'draft' in state ? 'SAVED' : false;
  }
  useEffect(() => {
    if (!group.isOrganizer) { setCheckingRequest(false); return; } let active = true; const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try { const response = await api(`/groups/${group.id}/draft-requests`, { signal: controller.signal }); const body = await response.json();
        if (!response.ok) throw new UserFlowError(draftFailureMessage(response.status, body));
        if (!Array.isArray(body.requests) || body.requests.length > 64 || body.requests.some((value: unknown) => !value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.key))) throw new Error('Request recovery unavailable');
        if (!active) return; setRequestLookupAvailable(true); const key = readDraftRequest(group.id) ?? body.requests[0]?.key ?? null;
        if (key) { saveDraftRequest(group.id,key); setPendingKey(key); pending.current = { idempotencyKey: key }; await recoverRequest(key); }
      } catch (error) { if (active) setNotice(error instanceof UserFlowError ? error.message : 'We couldn’t finish checking your previous AI request. Use the request check below to try again.'); }
      finally { window.clearTimeout(timeout); if (active) setCheckingRequest(false); }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); ++recoveryEpoch.current; };
  }, [group.id,group.isOrganizer,recoveryGeneration]);
  const [roster, setRoster] = useState<{ id: string; frame: KE.PublicDecisionFrame; controlVersion: number; groupVersion: number;
    participants: { id: string; displayName: string }[] } | null>(null);
  async function request(path: string, body?: unknown) {
    const response = await api(`/groups/${group.id}/${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let result: unknown; try { result = await response.json(); } catch { throw new UserFlowError(draftFailureMessage(response.status,null)); }
    if (!response.ok) {
      const reference = result && typeof result === 'object' && 'requestId' in result && typeof result.requestId === 'string'
        && /^[A-Za-z0-9_-]{1,100}$/.test(result.requestId) ? ` Reference: ${result.requestId}.` : '';
      throw new UserFlowError(draftFailureMessage(response.status,result) + reference);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response');
    return result as Record<string, unknown>;
  }
  async function action(work: () => Promise<unknown>) {
    if (busyGuard.current) return; busyGuard.current = true;
    setBusy(true); setNotice('');
    try { await work(); } catch (error) { setNotice(error instanceof UserFlowError ? error.message : 'The result is unknown. Refresh before retrying.'); }
    finally { busyGuard.current = false; setBusy(false); }
  }
  async function draftObjective(value: string, followUp?: { draftId: string; revision: number; answers: string[] }) {
    if (!pending.current) { const key = crypto.randomUUID(); pending.current = { objective: value, ...(followUp ? { followUp } : {}), idempotencyKey: key }; saveDraftRequest(group.id,key); setPendingKey(key); }
    if (!pending.current.objective) { await recoverRequest(pending.current.idempotencyKey); return; }
    setAiWorking(true);
    try {
      const result = await request('drafts', pending.current);
      const prepared = Groups.GroupDraft.parse(result.draft);
      setDraft(prepared); setStep(prepared.clarificationQuestions.length ? 'questions' : 'review'); setQuestionIndex(0); setDirty(false); setRoster(null);
      finishRequest(); setReviewed(false); setNotice(prepared.clarificationQuestions.length
        ? 'Your starting draft is saved. Review it below, then answer the next shared question or choose a help option.'
        : 'Your draft is saved and ready for review. Check the suggested choices before creating the decision.'); await reload();
    } catch (error) {
      // A failed acknowledgement is followed by a status read, never a second paid call.
      try {
        const recovered = await recoverRequest(pending.current?.idempotencyKey);
        if (recovered === 'SAVED') return;
        if (recovered === 'CLOSED') {
          setNotice((error instanceof UserFlowError ? error.message : 'That attempt finished without a new draft.')
            + ' The finished request is closed. You can edit and try again. No automatic AI retry was made.');
          return;
        }
      } catch { /* Keep the original failure and nonce unless closure was confirmed. */ }
      throw error;
    } finally { setAiWorking(false); }
  }

  const answersTooLong = Object.values(answers).some(answer => answer.length > 500);
  function changeFrame(frame: KE.PublicDecisionFrame) {
    if (draft) setDraft({ ...draft, frame }); setReviewed(false); setDirty(true);
  }
  async function saveDraft() {
    if (!draft) return;
    const result = await request(`drafts/${draft.id}`, { revision: draft.revision, title: draft.frame.title, objective: draft.frame.objective, variables: draft.frame.variables, rules: draft.frame.rules });
    const saved = Groups.GroupDraft.parse(result.draft); setDraft(saved); setStep(saved.clarificationQuestions.length ? 'questions' : 'review'); setDirty(false); setRoster(null); setReviewed(false); await reload();
  }
  const question = draft?.clarificationQuestions[questionIndex];
  const previousAnswer = question ? savedPublicAnswer(draft, question) : undefined;
  const unchangedRepeatedAnswers = !!draft?.clarificationQuestions.length && draft.clarificationQuestions.every((item, index) => {
    const prior = savedPublicAnswer(draft, item);
    return prior !== undefined && guidanceText(prior) === guidanceText(answers[index] ?? '');
  });
  const rebuiltAlready = !!draft?.clarificationQuestions.length && draft.clarificationQuestions.every(item => savedPublicAnswer(draft, item) === rebuildAnswer);
  function answerQuestion(value: string) {
    if (!question || busy || pendingKey) return;
    answersByQuestion.current[question] = value;
    setAnswers(current => ({ ...current, [questionIndex]: value }));
  }
  const requestRequirement = busy ? aiWorking ? 'AI is working on your draft. Please wait; your earlier answers are kept.' : 'Please wait while we check or save your decision.'
    : pendingKey ? 'Resolve the unfinished request below before editing or submitting again. Closing a request keeps your saved draft.'
    : checkingRequest ? 'Checking for unresolved AI requests. You can keep typing; wait for the check before sending anything to AI.'
    : !requestLookupAvailable ? 'We could not check your previous requests. You can keep typing; choose “Check saved requests again” before sending anything to AI.' : '';
  const questionRequirement = requestRequirement || (dirty ? 'Save your wording changes below before sending these answers to AI.'
    : answersTooLong ? 'Keep each answer within 500 characters.'
    : unchangedRepeatedAnswers ? 'AI repeated a question you already answered. Choose a help option below, or add the specific missing detail. We won’t send the same answers again unchanged.'
    : draft?.clarificationQuestions.some((_question, index) => !answers[index]?.trim()) ? 'Enter an answer for every follow-up question. Use Back to reach any unanswered earlier question.' : '');
  const readiness = requestRequirement || (draft?.clarificationQuestions.length ? 'Answer the AI’s follow-up questions first.'
    : dirty ? 'Save your changes before creating the decision.'
    : !reviewed ? 'Tick the review confirmation below to enable Create decision.' : '');
  const descriptionParts = [helpGoal.trim(), helpOptions.trim() ? `Options we are considering: ${helpOptions.trim()}` : '', helpUnknowns.trim() ? `Still undecided: ${helpUnknowns.trim()}` : ''].filter(Boolean).join('\n');
  const assistedDescription = [objective.trim(), descriptionParts].filter(Boolean).join('\n\n');
  function applyDescriptionHelp() {
    if (busy || pendingKey || !descriptionParts || assistedDescription.length > 2000) return;
    setObjective(assistedDescription); setReviewed(false);
    setHelpGoal(''); setHelpOptions(''); setHelpUnknowns('');
    if (descriptionHelp.current) descriptionHelp.current.open = false;
    objectiveInput.current?.focus();
  }
  function closeWizard() {
    if (busyGuard.current) return;
    dialog.current?.close(); setStarting(false); launcher.current?.focus();
  }
  function startWizard() {
    setStep(draft ? draft.clarificationQuestions.length ? 'questions' : 'review' : 'describe');
    setStarting(true);
  }
  async function loadDraft(id: string) {
    const result = await request(`drafts/${id}`), saved = Groups.GroupDraft.parse(result.draft);
    setDraft(saved); setObjective(saved.frame.objective); setQuestionIndex(0); setStep(saved.clarificationQuestions.length ? 'questions' : 'review');
    setDirty(false); setRoster(null); setReviewed(false); setStarting(true);
  }
  async function deleteItem() {
    if (!deleteTarget || !group.isOrganizer) return;
    const selected = deleteTarget;
    const result = await request('remove', { kind: selected.kind, id: selected.id, version: group.version });
    const updated = Groups.GroupSnapshot.parse(result.group);
    if (updated.id !== group.id || (selected.kind === 'DRAFT' ? updated.drafts : updated.decisions).some(item => item.id === selected.id)) throw new Error('Deletion not confirmed');
    if (selected.kind === 'DECISION' && roster?.id === selected.id) setRoster(null);
    if (draft && (draft.id === selected.id || draft.createdDecisionId === selected.id)) {
      setDraft(null); setObjective(''); setAnswers({}); answersByQuestion.current = {};
      setDirty(false); setReviewed(false); setStep('describe'); setStarting(false);
    }
    setDeleteTarget(null);
    setNotice(selected.kind === 'DRAFT' ? 'Draft deleted.' : 'Decision deleted for everyone in this group.');
    await reload();
  }
  async function releaseRequest() {
    if (!pendingKey || !requestState?.canRelease) return;
    const result = await request(`draft-requests/${pendingKey}/release`, { revision: requestState.revision });
    const value = result.draftRequest as { state?: unknown; canRelease?: unknown } | undefined;
    if (!value || !value.canRelease || !['CANCELLED','FAILED','SAVED'].includes(String(value.state))) throw new Error('Release not confirmed');
    finishRequest(); setStep(draft ? draft.clarificationQuestions.length ? 'questions' : 'review' : 'describe');
    setNotice('The previous request is closed. Your saved draft and any answers in this window are kept. You can continue editing.');
  }
  return <section className="ke-card ke-group-panel ke-decisions-panel" aria-busy={busy} aria-labelledby={`decisions-heading-${group.id}`}>
    <header className="ke-panel-heading"><div><h2 id={`decisions-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span><span>Decisions</span></h2>
      <p className="ke-panel-subtitle">Describe your idea, review the choices, then hear from everyone privately.</p></div>
      {group.isOrganizer && (group.decisions.length > 0 || group.drafts.length > 0 || pendingKey)
        && <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />{draft || pendingKey ? 'Continue your draft' : 'Start a decision'}</button>}</header>
    {!group.decisions.length && !group.drafts.length && !pendingKey && <div className="ke-decision-empty">
      <span className="ke-decision-empty-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span>
      <h3>What will you decide together?</h3><p>Tell the AI what you have in mind. We’ll help you shape the choices, one step at a time.</p>
      {group.isOrganizer ? <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />Start a decision</button>
        : <p>Your group organizer can start a decision.</p>}
    </div>}
    <div className="ke-decision-list">{group.decisions.map(decision => <article className="ke-decision-row" key={decision.id}>
      <div><h3>{decision.title ?? 'Untitled decision'}</h3>
        {!decision.current && <p>This decision needs an organizer membership update. Existing answers are kept when only adding people.</p>}
      </div>
      <div className="ke-decision-row-actions">{decision.current
        ? <button type="button" className="secondary" disabled={busy} onClick={() => openDecision(decision.id)}>Open decision</button>
        : null}
        {group.isOrganizer && <button type="button" disabled={busy} onClick={() => void action(async () => {
          const result = await request(`decisions/${decision.id}/review`);
          setDraft(null); setDirty(false); setRoster({ id: decision.id, frame: KE.PublicDecisionFrame.parse(result.frame), controlVersion: result.controlVersion as number,
            groupVersion: result.groupVersion as number, participants: result.participants as { id: string; displayName: string }[] }); setReviewed(false);
        })}>Update decision participants</button>}
        {group.isOrganizer && <RenameAction name={decision.title ?? 'Untitled decision'} save={async name => { await request('name', { version: group.version, name, previousName: decision.title ?? 'Untitled decision', decisionId: decision.id }); await reload(); }} />}
        {group.isOrganizer && <button type="button" className="secondary ke-delete-action" disabled={busy}
          onClick={() => setDeleteTarget({ kind: 'DECISION', id: decision.id, title: 'this decision' })}>Delete decision</button>}
      </div>
    </article>)}</div>
    {group.isOrganizer && group.drafts.some(item => !item.created) && <div className="ke-wizard-saved-list">
      <h3>Your saved drafts</h3>{group.drafts.filter(item => !item.created).map(item => <div className="ke-decision-row" key={item.id}>
        <span>{item.title}</span><div className="ke-decision-row-actions">{item.current
          ? <button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => void action(() => loadDraft(item.id))}>Continue draft</button>
          : <small>The group changed. Start a new draft for the current members.</small>}
          <button type="button" className="secondary ke-delete-action" disabled={busy}
            onClick={() => setDeleteTarget({ kind: 'DRAFT', id: item.id, title: item.title })}>Delete draft</button>
        </div>
      </div>)}
    </div>}
    {group.isOrganizer && <dialog ref={deleteDialog} className="ke-delete-dialog" aria-labelledby={`delete-title-${group.id}`}
      aria-describedby={`delete-description-${group.id}`} onCancel={event => { event.preventDefault(); if (!busyGuard.current) setDeleteTarget(null); }}>
      <h2 id={`delete-title-${group.id}`}>Delete {deleteTarget?.kind === 'DRAFT' ? 'draft' : 'decision'}?</h2>
      <p id={`delete-description-${group.id}`}>{deleteTarget?.kind === 'DRAFT'
        ? `Delete “${deleteTarget.title}”? It will disappear from your saved drafts and cannot be reopened.`
        : 'This decision will be removed for everyone in the group. Existing links will stop working.'}</p>
      <p className="ke-delete-note">This cannot be undone. Historical system records are retained.</p>
      <div className="ke-wizard-actions">
        <button type="button" className="secondary" autoFocus disabled={busy} onClick={() => setDeleteTarget(null)}>Keep {deleteTarget?.kind === 'DRAFT' ? 'draft' : 'decision'}</button>
        <button type="button" className="ke-delete-confirm" disabled={busy || !deleteTarget} onClick={() => void action(deleteItem)}>{busy ? 'Deleting…' : deleteTarget?.kind === 'DRAFT' ? 'Delete draft' : 'Delete decision'}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </dialog>}
    {group.isOrganizer && <dialog ref={dialog} className="ke-decision-wizard" aria-labelledby={`decision-wizard-title-${group.id}`}
      onCancel={event => { event.preventDefault(); closeWizard(); }} onClick={event => { if (event.target === dialog.current) closeWizard(); }}>
      <div className="ke-wizard-shell">
        <header className="ke-wizard-header"><div><span className="ke-wizard-eyebrow">AI decision guide · {group.name}</span>
          <h2 id={`decision-wizard-title-${group.id}`} ref={draftHeading} tabIndex={-1}>{step === 'describe' ? 'What would you like to decide?' : step === 'questions' ? 'Let’s fill in a few details.' : 'Your decision, ready to review.'}</h2></div>
          <button type="button" className="secondary ke-wizard-close" aria-label="Close decision guide" disabled={busy} onClick={closeWizard}><PageIcon name="X" /></button>
        </header>
        <p className="ke-wizard-example"><button ref={exampleTrigger} type="button" className="secondary" aria-expanded={showExample} aria-controls={`create-example-${group.id}`} onClick={() => setShowExample(value => !value)}>{showExample ? 'Back to my decision draft' : 'See an example'}</button></p>
        {showExample && <div id={`create-example-${group.id}`}><DecisionGuide onReturn={returnFromExample} /></div>}
        <div hidden={showExample}>
        <ol className="ke-wizard-steps" aria-label="Decision creation steps">{(['describe','questions','review'] as const).map((value, index) => <li key={value} data-complete={index < ['describe','questions','review'].indexOf(step)} aria-current={step === value ? 'step' : undefined}>
          <span aria-hidden="true">{index < ['describe','questions','review'].indexOf(step) ? <PageIcon name="Check" /> : index + 1}</span><span className="ke-wizard-step-label">{['Your idea','Build the draft','Review'][index]}</span></li>)}</ol>
        <div className="ke-wizard-body" aria-busy={busy}>
          <p className="ke-wizard-privacy"><PageIcon name="ShieldCheck" />These details are shared with your group and processed by AI. Keep personal limits for your private conversation later.</p>
          {requestRequirement && step !== 'review' && <p className="ke-wizard-help" role="status">{requestRequirement}</p>}
          {!requestLookupAvailable && !checkingRequest && !pendingKey && <button type="button" className="secondary" disabled={busy}
            onClick={() => { setNotice(''); setCheckingRequest(true); setRecoveryGeneration(value => value + 1); }}>Check saved requests again</button>}
          {aiWorking && <LoadingSkeleton kind="inline" label={pending.current?.followUp ? 'AI is updating your saved draft with your answers' : 'AI is preparing a starting draft from your idea'} />}
          {pendingKey && !aiWorking && <div className="ke-wizard-recovery">
            <h3>{requestState?.state === 'FAILED' ? 'This attempt did not produce a new draft.' : requestState?.state === 'UNKNOWN' ? 'Your request needs a result check.' : 'Let’s check your previous request.'}</h3><p>{requestState?.progress === 'EXPIRED' ? 'This request expired before AI started. Close it to return to your saved draft.'
              : requestState?.state === 'PENDING' ? requestState.canRelease ? 'AI has not started this request. You can check progress or close it to return to your draft.'
                : 'This request has not finished. Check progress; contact the operator if it stays unresolved.'
              : requestState?.state === 'UNKNOWN' ? 'The previous AI result could not be confirmed. This needs service recovery if checking again does not resolve it. Your saved draft is kept.'
              : requestState?.state === 'FAILED' ? 'This attempt finished without a new draft. Your earlier saved draft and answers are kept. Close this request to edit or try again.'
              : 'We’ll recover a saved result, or safely close the previous request before starting a new one.'}</p>
            <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy || checkingRequest} onClick={() => void action(() => recoverRequest())}>Check progress</button>
              {requestState?.canRelease && <button type="button" className="secondary" disabled={busy} onClick={() => void action(releaseRequest)}>Close unfinished request</button>}
              {pending.current?.objective && (!requestState || requestState.state === 'NOT_SUBMITTED') && <button type="button" className="secondary" disabled={busy || checkingRequest || !requestLookupAvailable} onClick={() => { const retry = pending.current?.objective; if (retry) void action(() => draftObjective(retry, pending.current?.followUp)); }}>Retry this same request</button>}
            </div>
          </div>}
          {step === 'describe' && !pendingKey && <div className="ke-wizard-step">
            <div className="ke-wizard-ai-note"><strong>Tell us what you have in mind.</strong><p>Include the options you’re considering and anything still undecided. A few useful details help AI shape the choices. You don’t need everyone’s preferences or personal budget.</p></div>
            <p className="ke-wizard-help">First, describe the idea. Then review AI’s draft and create the decision. Each participant reviews the shared choices and adds their own needs privately; nothing is approved automatically.</p>
            <details className="ke-wizard-limits"><summary>About the current preview</summary><p>The app compares up to 64 combinations. AI should keep the initial choices small and ask for a specific limit only when needed. Suggested dates, places or spending limits are unverified until your group reviews them.</p></details>
            <label htmlFor={`group-objective-${group.id}`}>Tell me what you want to decide</label>
            <textarea ref={objectiveInput} id={`group-objective-${group.id}`} value={objective} maxLength={2000} placeholder="For example: We want dinner together. We’re considering Place X, Place Y or Place Z, on Friday or Saturday. We don’t know what works best for everyone yet."
              disabled={busy || !!pendingKey} onChange={event => { setObjective(event.target.value); setReviewed(false); }} />
            <small className="ke-wizard-counter">{objective.length} / 2,000 characters · shared with your group</small>
            <details ref={descriptionHelp} className="ke-wizard-description-help"><summary>Help me describe my idea</summary><p>Answer whichever prompts help. These details are shared; keep personal limits for your private conversation later. This prepares your description without calling AI.</p>
              <fieldset disabled={busy || !!pendingKey}>
                <label htmlFor={`idea-goal-${group.id}`}>What would you like to decide?</label><input id={`idea-goal-${group.id}`} value={helpGoal} maxLength={500} placeholder="For example: Plan a dinner together" onChange={event => setHelpGoal(event.target.value)} />
                <label htmlFor={`idea-options-${group.id}`}>Which options are you considering? <span>(optional)</span></label><textarea id={`idea-options-${group.id}`} value={helpOptions} maxLength={500} placeholder="For example: Place X, Place Y or Place Z" onChange={event => setHelpOptions(event.target.value)} />
                <label htmlFor={`idea-unknowns-${group.id}`}>What is still undecided? <span>(optional)</span></label><textarea id={`idea-unknowns-${group.id}`} value={helpUnknowns} maxLength={500} placeholder="For example: Friday or Saturday; the spending plan is still open" onChange={event => setHelpUnknowns(event.target.value)} />
                <button type="button" className="secondary" disabled={!descriptionParts || assistedDescription.length > 2000} onClick={applyDescriptionHelp}>Add these details to my idea</button>
                {assistedDescription.length > 2000 && <p role="status">These details would exceed 2,000 characters. Shorten your idea or these answers before adding them; nothing has been removed.</p>}
              </fieldset>
            </details>
            {!objective.trim() && <div className="ke-wizard-examples"><span>Or start with an example</span>{['Compare three restaurants for dinner on Friday or Saturday.', 'Choose between a coastal or mountain weekend trip.', 'Compare two shared purchases and decide which fits the group.'].map(example => <button type="button" key={example} className="secondary"
              disabled={busy || !!pendingKey} onClick={() => setObjective(example)}>{example}</button>)}</div>}
            <div className="ke-wizard-actions"><button type="button" className="ke-icon-action" disabled={busy || checkingRequest || !requestLookupAvailable || !objective.trim() || !!pendingKey}
              onClick={() => void action(() => draftObjective(objective))}>Continue with AI<PageIcon name="ArrowRight" /></button>
              {draft && !pendingKey && <button type="button" className="secondary" disabled={busy} onClick={() => setStep(draft.clarificationQuestions.length ? 'questions' : 'review')}>Continue the saved draft</button>}</div>
            {!objective.trim() && <p className="ke-wizard-help">Describe the decision above, or use “Help me describe my idea” to get started.</p>}
          </div>}
          {step === 'questions' && draft && !pendingKey && <div className="ke-wizard-step">
            <article className="ke-wizard-starting-point"><span className="ke-wizard-eyebrow">Your starting point · saved</span><h3>{draft.frame.title}</h3><p>{draft.frame.objective}</p>
              {draft.frame.description && <p>{draft.frame.description}</p>}
              {!!draft.frame.variables.length && <><h4>Choices proposed for review</h4><ul>{draft.frame.variables.map(variable => <li key={variable.id}><strong>{variable.label}</strong>{publicChoiceValues(variable, draft.frame).length ? `: ${publicChoiceValues(variable, draft.frame).join(', ')}` : ''}</li>)}</ul></>}
              <small>These are shared draft choices. They do not confirm anyone’s availability, budget, preferences or approval.</small>
            </article>
            <div className="ke-wizard-ai-note"><strong>{previousAnswer !== undefined ? 'AI has asked about an earlier answer.' : 'Let’s work out the next shared detail.'}</strong><p>{previousAnswer !== undefined ? 'Your earlier answer is saved. If you don’t have more detail, ask AI to suggest a starting point rather than repeating the same answer.' : 'Answer what you know, or ask AI to suggest a starting point. Personal preferences and limits belong in each person’s private conversation later.'}</p></div>
            {!!draft.publicClarifications?.length && <details className="ke-wizard-history"><summary>What you’ve already shared with AI</summary><dl>{draft.publicClarifications.map((item, index) => <div key={index}><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}</dl></details>}
            <p className="ke-wizard-help">One question at a time. A short shared answer is enough; you can also choose a help option below. Nothing is sent until you select “Let AI update the draft.”</p>
            <div className="ke-wizard-rebuild"><p>If your idea already lists the options, you don’t need to choose a winner or answer on anyone else’s behalf.</p><button type="button" className="secondary" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable || dirty || rebuiltAlready} onClick={() => void action(() => draftObjective(draft.frame.objective, { draftId: draft.id, revision: draft.revision, answers: draft.clarificationQuestions.map(() => rebuildAnswer) }))}>Rebuild shared choices with AI</button><small>This sends your existing idea and shared answers to AI once. It does not provide anyone’s private preferences.</small>{rebuiltAlready && <small>AI already received this rebuild request. Add a concrete missing shared detail above before another update.</small>}</div>
            <p className="ke-wizard-question-count">Question {questionIndex + 1} of {draft.clarificationQuestions.length}</p>
            <label className="ke-wizard-question" htmlFor={`public-answer-${group.id}-${questionIndex}`}>{question}</label>
            <textarea id={`public-answer-${group.id}-${questionIndex}`} value={answers[questionIndex] ?? ''} maxLength={500}
              placeholder="Share what you know, or choose a help option below…" disabled={busy || !!pendingKey} onChange={event => answerQuestion(event.target.value)} />
            {previousAnswer !== undefined && <small>Your previously submitted answer is kept. You don’t need to start over.</small>}
            <div className="ke-wizard-help-options" aria-label="Help with this shared question"><button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => answerQuestion(suggestionAnswer)}>Not sure—suggest options</button><button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => answerQuestion(privateAnswer)}>Ask each person privately</button></div>
            <small className="ke-wizard-counter">{(answers[questionIndex] ?? '').length} / 500 characters · shared with the group</small>
            {questionRequirement && !requestRequirement && <p className="ke-wizard-help" role="status">{questionRequirement}</p>}
            {dirty && <button type="button" disabled={busy || !!pendingKey} onClick={() => void action(saveDraft)}>Save changes</button>}
            <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => questionIndex ? setQuestionIndex(questionIndex - 1) : setStep('describe')}>Back</button>
              {questionIndex < draft.clarificationQuestions.length - 1
                ? <button type="button" disabled={busy || !!pendingKey || !answers[questionIndex]?.trim()} onClick={() => setQuestionIndex(questionIndex + 1)}>Next question</button>
                : <button type="button" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable || dirty || answersTooLong || unchangedRepeatedAnswers || draft.clarificationQuestions.some((_question, index) => !answers[index]?.trim())}
                  onClick={() => void action(() => draftObjective(draft.frame.objective, { draftId: draft.id, revision: draft.revision, answers: draft.clarificationQuestions.map((_question, index) => (answers[index] ?? '').trim()) }))}>Let AI update the draft</button>}
            </div>
            {!answers[questionIndex]?.trim() && <p className="ke-wizard-help">Answer what you know or choose a help option to continue.</p>}
          </div>}
          {step === 'review' && draft && <div className="ke-wizard-step">
            <div className="ke-wizard-ai-note"><strong>Here’s what your group will review.</strong><p>Check the choices below. Creating the decision starts your group’s review. Next, each person adds their needs privately and reviews the interpretation; everyone approves proposals for themselves.</p></div>
            <p className="ke-wizard-help">Required: resolve all follow-up questions, save any wording changes, and tick the review confirmation for this saved draft. The saved-request check must finish before Create decision is enabled.</p>
            <article className="ke-wizard-preview"><h3>{draft.frame.title}</h3><p>{draft.frame.objective}</p><p className="ke-wizard-description">{draft.frame.description}</p>
              <h4>Choices to explore</h4><ul>{draft.frame.variables.map(variable => <li key={variable.id}>{variableText(variable, draft.frame)}{variable.type !== 'ENUM' && variable.type !== 'ENUM_SET' && publicChoiceValues(variable, draft.frame).length > 0 && <small className="ke-wizard-counter">Choices: {publicChoiceValues(variable, draft.frame).join(', ')}</small>}</li>)}</ul>
              {!!draft.frame.rules.length && <><h4>Shared rules</h4><ul>{draft.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, draft.frame.variables)}</li>)}</ul></>}
              <h4>Who will review it</h4><div className="ke-wizard-members">{draft.frame.participants.map(member => <span key={member.id}>{member.displayName}</span>)}</div>
            </article>
            {!draft.createdDecisionId && <details className="ke-wizard-edit"><summary>Adjust the wording</summary>
              <label htmlFor={`draft-title-${group.id}`}>Decision title</label><input id={`draft-title-${group.id}`} value={draft.frame.title} maxLength={160} disabled={busy || !!pendingKey} onChange={event => changeFrame({ ...draft.frame, title: event.target.value })} />
              {draft.frame.variables.map((variable, index) => <div key={variable.id}><label htmlFor={`draft-label-${group.id}-${index}`}>Choice name {index + 1}</label>
                <input id={`draft-label-${group.id}-${index}`} value={variable.label} disabled={busy || !!pendingKey} maxLength={160} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })} />
                {(variable.type === 'ENUM' || variable.type === 'ENUM_SET') && variable.options.map((option, at) => <label key={option.id}>Option {at + 1} for {variable.label}
                  <input value={option.label} maxLength={120} disabled={busy || !!pendingKey} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, vi) => vi === index && (item.type === 'ENUM' || item.type === 'ENUM_SET') ? { ...item, options: item.options.map((value, oi) => oi === at ? { ...value, label: event.target.value } : value) } : item) })} /></label>)}
              </div>)}
            </details>}
            {dirty && <div className="ke-wizard-save"><p>You changed the wording. Save it first, then confirm your review.</p><button type="button" disabled={busy || !!pendingKey} onClick={() => void action(saveDraft)}>Save changes</button></div>}
            {!draft.createdDecisionId && <label className="ke-wizard-confirm"><input type="checkbox" checked={reviewed} disabled={busy || dirty || !!pendingKey} onChange={event => setReviewed(event.target.checked)} />
              <span>I’ve reviewed these shared choices and who needs to approve.</span></label>}
            {!draft.createdDecisionId && readiness && <p className="ke-wizard-help" role="status">{readiness}</p>}
            <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => setStep('describe')}>Back to my idea</button>
              {draft.createdDecisionId ? <button type="button" disabled={busy} onClick={() => { closeWizard(); openDecision(draft.createdDecisionId!); }}>Open decision</button>
                : <button type="button" disabled={busy || !reviewed || dirty || !!pendingKey || checkingRequest || !requestLookupAvailable || draft.clarificationQuestions.length > 0} onClick={() => void action(async () => {
                  const result = await request(`drafts/${draft.id}/create`, { revision: draft.revision });
                  const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); await reload(); setDraft(null); setStarting(false); openDecision(snapshot.frame.decisionId);
                })}>Create decision</button>}
            </div>
          </div>}
          {busy && <LoadingSkeleton kind="inline" label="Preparing or saving your decision" />}
          {!busy && notice && <div className="ke-wizard-notice" role="status">{notice}</div>}
        </div>
        </div>
        <footer className="ke-wizard-footer">A saved draft can be continued later. No one’s private needs or final approval are confirmed by this guide.</footer>
      </div>
    </dialog>}
    {roster && <div className="local-note"><h4>Include current group members</h4><p>{roster.frame.objective}</p>
      <p>New participants provide their own answers. A finished decision keeps its recorded outcome and participants. Removing people or changing shared choices still needs the existing review.</p>
      <ul>{roster.participants.map(member => <li key={member.id}>{member.displayName}</li>)}</ul>
      {roster.frame.variables.map(variable => <p key={variable.id}>{variableText(variable, roster.frame)}</p>)}
      <ul>{roster.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, roster.frame.variables)}</li>)}</ul>
      <p>Continuing resets every old frame confirmation, private input confirmation, permission and final approval. Everyone must review and confirm again.</p>
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> Include these people in this decision. Existing answers and confirmations stay saved when only adding people.</label>
      <button disabled={busy || !reviewed} onClick={() => void action(async () => {
        const result = await request(`decisions/${roster.id}/revise`, { controlVersion: roster.controlVersion, groupVersion: roster.groupVersion });
        const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); setRoster(null); setReviewed(false); await reload(); openDecision(snapshot.frame.decisionId);
      })}>Update decision participants</button>
    </div>}
    {!starting && !busy && notice && <p className="ke-wizard-help" role="status">{notice}</p>}
  </section>;
}
