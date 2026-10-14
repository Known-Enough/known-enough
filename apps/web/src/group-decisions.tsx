import { useEffect, useRef, useState } from 'react';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { ruleText, variableText } from './connected-decision';
import { readDraftRequest,saveDraftRequest,draftFailureMessage } from './draft-request-state';
import { LoadingSkeleton, PageIcon } from './app-chrome';
class UserFlowError extends Error {}
export function GroupDecisions({ group, api, reload, openDecision }: { group: Groups.GroupSnapshot;
  api: (path: string, init?: RequestInit) => Promise<Response>; reload: () => Promise<void>; openDecision: (id: string) => void; startCollapsed?: boolean }) {
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState<'describe' | 'questions' | 'review'>('describe');
  const [questionIndex, setQuestionIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const busyGuard = useRef(false);
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
  useEffect(() => { setAnswers({}); setQuestionIndex(0); }, [draft?.id]);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const pending = useRef<{ objective?: string; idempotencyKey: string } | null>(null);
  const [pendingKey,setPendingKey] = useState<string | null>(() => group.isOrganizer ? readDraftRequest(group.id) : null);
  const [checkingRequest,setCheckingRequest] = useState(group.isOrganizer);
  const [requestLookupAvailable,setRequestLookupAvailable] = useState(false);
  const [requestState,setRequestState] = useState<{ state: string; canRelease: boolean; revision: number; progress?: string } | null>(null);
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
    else setNotice('progress' in state && state.progress === 'EXPIRED' ? 'This request expired before AI started. Close the unfinished request to return to your saved draft.'
      : state.state === 'UNKNOWN' ? 'We haven’t confirmed the AI result yet. Keep this request and check again; contact the operator if it stays uncertain.'
      : state.state === 'PENDING' ? state.canRelease ? 'AI has not started this request. Check progress or close it to return to your draft.' : 'The request has not finished. Check progress; if it stays unresolved, contact the operator.'
      : 'This request has stopped. Choose “Close unfinished request” to continue.');
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
  async function action(work: () => Promise<void>) {
    if (busyGuard.current) return; busyGuard.current = true;
    setBusy(true); setNotice('');
    try { await work(); } catch (error) { setNotice(error instanceof UserFlowError ? error.message : 'The result is unknown. Refresh before retrying.'); }
    finally { busyGuard.current = false; setBusy(false); }
  }
  async function draftObjective(value: string) {
    if (!pending.current) { const key = crypto.randomUUID(); pending.current = { objective: value, idempotencyKey: key }; saveDraftRequest(group.id,key); setPendingKey(key); }
    if (!pending.current.objective) { await recoverRequest(pending.current.idempotencyKey); return; }
    const result = await request('drafts', pending.current);
    const prepared = Groups.GroupDraft.parse(result.draft);
    setDraft(prepared); setStep(prepared.clarificationQuestions.length ? 'questions' : 'review'); setQuestionIndex(0); setDirty(false); setRoster(null);
    finishRequest(); setReviewed(false); await reload();
  }
  const answeredObjective = draft ? [draft.frame.objective, 'Public clarification answers:',
    ...draft.clarificationQuestions.map((question, index) => question + ' Answer: ' + (answers[index] ?? '').trim())].join('\n') : '';
  function changeFrame(frame: KE.PublicDecisionFrame) {
    if (draft) setDraft({ ...draft, frame }); setReviewed(false); setDirty(true);
  }
  async function saveDraft() {
    if (!draft) return;
    const result = await request(`drafts/${draft.id}`, { revision: draft.revision, title: draft.frame.title, objective: draft.frame.objective, variables: draft.frame.variables, rules: draft.frame.rules });
    const saved = Groups.GroupDraft.parse(result.draft); setDraft(saved); setStep(saved.clarificationQuestions.length ? 'questions' : 'review'); setDirty(false); setRoster(null); setReviewed(false); await reload();
  }
  const question = draft?.clarificationQuestions[questionIndex];
  const requestRequirement = busy ? 'Please wait while we prepare or save your decision.'
    : pendingKey ? 'Resolve the unfinished request below before editing or submitting again. Closing a request keeps your saved draft.'
    : checkingRequest ? 'Checking for unresolved AI requests. Please wait before continuing.'
    : !requestLookupAvailable ? 'We could not check your previous requests. Choose “Check saved requests again” to continue; your answer will be kept.' : '';
  const questionRequirement = requestRequirement || (dirty ? 'Save your wording changes below before sending these answers to AI.'
    : answeredObjective.length > 2000 ? 'Your idea, questions and answers exceed 2,000 characters. Shorten your answers or go back and shorten your idea.'
    : draft?.clarificationQuestions.some((_question, index) => !answers[index]?.trim()) ? 'Enter an answer for every follow-up question. Use Back to reach any unanswered earlier question.' : '');
  const readiness = requestRequirement || (draft?.clarificationQuestions.length ? 'Answer the AI’s follow-up questions first.'
    : dirty ? 'Save your changes before creating the decision.'
    : !reviewed ? 'Tick the review confirmation below to enable Create decision.' : '');
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
      <p className="ke-panel-subtitle">A clear path from an idea to a shared decision.</p></div>
      {group.isOrganizer && (group.decisions.length > 0 || group.drafts.length > 0 || pendingKey)
        && <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />{draft || pendingKey ? 'Continue your draft' : 'Start a decision'}</button>}</header>
    {!group.decisions.length && !group.drafts.length && !pendingKey && <div className="ke-decision-empty">
      <span className="ke-decision-empty-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span>
      <h3>What will you decide together?</h3><p>Tell the AI what you have in mind. We’ll help you shape the choices, one step at a time.</p>
      {group.isOrganizer ? <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />Start a decision</button>
        : <p>Your group organizer can start a decision.</p>}
    </div>}
    <div className="ke-decision-list">{group.decisions.map(decision => <article className="ke-decision-row" key={decision.id}>
      <div><h3>{decision.current ? 'Current decision' : 'Roster review needed'}</h3>
        {!decision.current && <p>Membership changed. Everyone needs to review the updated group.</p>}
      </div>
      {decision.current
        ? <button type="button" className="secondary" disabled={busy} onClick={() => openDecision(decision.id)}>Open decision</button>
        : group.isOrganizer && <button type="button" disabled={busy} onClick={() => void action(async () => {
          const result = await request(`decisions/${decision.id}/review`);
          setDraft(null); setDirty(false); setRoster({ id: decision.id, frame: KE.PublicDecisionFrame.parse(result.frame), controlVersion: result.controlVersion as number,
            groupVersion: result.groupVersion as number, participants: result.participants as { id: string; displayName: string }[] }); setReviewed(false);
        })}>Review changed roster</button>}
    </article>)}</div>
    {group.isOrganizer && group.drafts.some(item => !item.created) && <div className="ke-wizard-saved-list">
      <h3>Your saved drafts</h3>{group.drafts.filter(item => !item.created).map(item => <div className="ke-decision-row" key={item.id}>
        <span>{item.title}</span>{item.current
          ? <button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => void action(() => loadDraft(item.id))}>Continue draft</button>
          : <small>The group changed. Start a new draft for the current members.</small>}
      </div>)}
    </div>}
    {group.isOrganizer && <dialog ref={dialog} className="ke-decision-wizard" aria-labelledby={`decision-wizard-title-${group.id}`}
      onCancel={event => { event.preventDefault(); closeWizard(); }} onClick={event => { if (event.target === dialog.current) closeWizard(); }}>
      <div className="ke-wizard-shell">
        <header className="ke-wizard-header"><div><span className="ke-wizard-eyebrow">AI decision guide · {group.name}</span>
          <h2 id={`decision-wizard-title-${group.id}`} ref={draftHeading} tabIndex={-1}>{step === 'describe' ? 'What would you like to decide?' : step === 'questions' ? 'Let’s fill in a few details.' : 'Your decision, ready to review.'}</h2></div>
          <button type="button" className="secondary ke-wizard-close" aria-label="Close decision guide" disabled={busy} onClick={closeWizard}><PageIcon name="X" /></button>
        </header>
        <ol className="ke-wizard-steps" aria-label="Decision creation steps">{(['describe','questions','review'] as const).map((value, index) => <li key={value} data-complete={index < ['describe','questions','review'].indexOf(step)} aria-current={step === value ? 'step' : undefined}>
          <span>{index < ['describe','questions','review'].indexOf(step) ? <PageIcon name="Check" /> : index + 1}</span>{['Your idea','Follow-up','Review'][index]}</li>)}</ol>
        <div className="ke-wizard-body" aria-busy={busy}>
          <p className="ke-wizard-privacy"><PageIcon name="ShieldCheck" />These details are shared with your group and processed by AI. Keep personal limits for your private conversation later.</p>
          {requestRequirement && step !== 'review' && <p className="ke-wizard-help" role="status">{requestRequirement}</p>}
          {!requestLookupAvailable && !checkingRequest && !pendingKey && <button type="button" className="secondary" disabled={busy}
            onClick={() => { setNotice(''); setCheckingRequest(true); setRecoveryGeneration(value => value + 1); }}>Check saved requests again</button>}
          {pendingKey && <div className="ke-wizard-recovery">
            <h3>Let’s check your previous request.</h3><p>{requestState?.progress === 'EXPIRED' ? 'This request expired before AI started. Close it to return to your saved draft.'
              : requestState?.state === 'PENDING' ? requestState.canRelease ? 'AI has not started this request. You can check progress or close it to return to your draft.'
                : 'This request has not finished. Check progress; contact the operator if it stays unresolved.'
              : requestState?.state === 'UNKNOWN' ? 'The previous AI result could not be confirmed. This needs service recovery if checking again does not resolve it. Your saved draft is kept.'
              : 'We’ll recover a saved result, or safely close the previous request before starting a new one.'}</p>
            <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy || checkingRequest} onClick={() => void action(() => recoverRequest())}>Check progress</button>
              {requestState?.canRelease && <button type="button" className="secondary" disabled={busy} onClick={() => void action(releaseRequest)}>Close unfinished request</button>}
              {pending.current?.objective && <button type="button" className="secondary" disabled={busy || checkingRequest || !requestLookupAvailable} onClick={() => { const retry = pending.current?.objective; if (retry) void action(() => draftObjective(retry)); }}>Retry this same request</button>}
            </div>
          </div>}
          {step === 'describe' && <div className="ke-wizard-step">
            <div className="ke-wizard-ai-note"><strong>Start with the big picture.</strong><p>What is your group choosing, and which options are you considering? A few sentences are enough to begin.</p></div>
            <p className="ke-wizard-help">Required: enter a shared idea, up to 2,000 characters, and finish the saved-request check. This guide uses AI to prepare the choices. You can edit its draft before creating the decision; it does not offer fully manual creation.</p>
            <label htmlFor={`group-objective-${group.id}`}>Tell me what you want to decide</label>
            <textarea id={`group-objective-${group.id}`} value={objective} maxLength={2000} placeholder="For example: Help us choose a restaurant for Friday. We’re considering Green Bowl, Pizza Corner and Taco House."
              disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onChange={event => { setObjective(event.target.value); setReviewed(false); }} />
            <div className="ke-wizard-examples"><span>Ideas to get started</span>{['Choose a restaurant for our group dinner.', 'Choose a destination for our weekend trip.', 'Choose which shared purchase to make.'].map(example => <button type="button" key={example} className="secondary"
              disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onClick={() => setObjective(example)}>{example}</button>)}</div>
            <div className="ke-wizard-actions"><button type="button" className="ke-icon-action" disabled={busy || checkingRequest || !requestLookupAvailable || !objective.trim() || !!pendingKey}
              onClick={() => void action(() => draftObjective(objective))}>Continue with AI<PageIcon name="ArrowRight" /></button>
              {draft && !pendingKey && <button type="button" className="secondary" disabled={busy} onClick={() => setStep(draft.clarificationQuestions.length ? 'questions' : 'review')}>Continue the saved draft</button>}</div>
            {!objective.trim() && <p className="ke-wizard-help">Tell us what your group wants to decide to continue.</p>}
          </div>}
          {step === 'questions' && draft && <div className="ke-wizard-step">
            <div className="ke-wizard-ai-note"><strong>The AI needs a little more context.</strong><p>Your answers help turn your idea into clear choices everyone can review.</p></div>
            <p className="ke-wizard-help">Required: answer every question with shared details (up to 200 characters per answer). Your idea, questions and answers together must fit within 2,000 characters. Save any wording edits and finish the saved-request check before asking AI to update the draft.</p>
            <p className="ke-wizard-question-count">Question {questionIndex + 1} of {draft.clarificationQuestions.length}</p>
            <label className="ke-wizard-question" htmlFor={`public-answer-${group.id}-${questionIndex}`}>{question}</label>
            <textarea id={`public-answer-${group.id}-${questionIndex}`} value={answers[questionIndex] ?? ''} maxLength={200}
              placeholder="Add a shared detail here…" disabled={busy || !!pendingKey} onChange={event => setAnswers({ ...answers, [questionIndex]: event.target.value })} />
            <small>{(answers[questionIndex] ?? '').length}/200 characters · shared with the group</small>
            <small>{answeredObjective.length}/2,000 total characters including the idea and questions</small>
            {questionRequirement && !requestRequirement && <p className="ke-wizard-help" role="status">{questionRequirement}</p>}
            {dirty && <button type="button" disabled={busy || !!pendingKey} onClick={() => void action(saveDraft)}>Save changes</button>}
            <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => questionIndex ? setQuestionIndex(questionIndex - 1) : setStep('describe')}>Back</button>
              {questionIndex < draft.clarificationQuestions.length - 1
                ? <button type="button" disabled={busy || !!pendingKey || !answers[questionIndex]?.trim()} onClick={() => setQuestionIndex(questionIndex + 1)}>Next question</button>
                : <button type="button" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable || dirty || answeredObjective.length > 2000 || draft.clarificationQuestions.some((_question, index) => !answers[index]?.trim())}
                  onClick={() => void action(() => draftObjective(answeredObjective))}>Let AI update the draft</button>}
            </div>
            {!answers[questionIndex]?.trim() && <p className="ke-wizard-help">Answer this question to continue.</p>}
          </div>}
          {step === 'review' && draft && <div className="ke-wizard-step">
            <div className="ke-wizard-ai-note"><strong>Here’s what your group will review.</strong><p>Check the choices below. Creating the decision starts your group’s review; everyone still confirms their own needs and approvals.</p></div>
            <p className="ke-wizard-help">Required: resolve all follow-up questions, save any wording changes, and tick the review confirmation for this saved draft. The saved-request check must finish before Create decision is enabled.</p>
            <article className="ke-wizard-preview"><h3>{draft.frame.title}</h3><p>{draft.frame.objective}</p><p className="ke-wizard-description">{draft.frame.description}</p>
              <h4>Choices to explore</h4><ul>{draft.frame.variables.map(variable => <li key={variable.id}>{variableText(variable, draft.frame)}</li>)}</ul>
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
        <footer className="ke-wizard-footer">A saved draft can be continued later. No one’s private needs or final approval are confirmed by this guide.</footer>
      </div>
    </dialog>}
    {roster && <div className="local-note"><h4>Review the new roster</h4><p>{roster.frame.objective}</p>
      <ul>{roster.participants.map(member => <li key={member.id}>{member.displayName}</li>)}</ul>
      {roster.frame.variables.map(variable => <p key={variable.id}>{variableText(variable, roster.frame)}</p>)}
      <ul>{roster.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, roster.frame.variables)}</li>)}</ul>
      <p>Continuing resets every old frame confirmation, private input confirmation, permission and final approval. Everyone must review and confirm again.</p>
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the changed roster and understand the reset</label>
      <button disabled={busy || !reviewed} onClick={() => void action(async () => {
        const result = await request(`decisions/${roster.id}/revise`, { controlVersion: roster.controlVersion, groupVersion: roster.groupVersion });
        const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); setRoster(null); setReviewed(false); await reload(); openDecision(snapshot.frame.decisionId);
      })}>Start a new review with this roster</button>
    </div>}
    {!starting && !busy && notice && <p className="ke-wizard-help" role="status">{notice}</p>}
  </section>;
}
