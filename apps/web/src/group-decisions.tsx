import { readDecisionListStatus, type DecisionListStatus } from './decision-list-status';
import { Modal } from './modal';
import { ChoicePlanEditor } from './choice-plan-editor';
import { choicePlanFeedback, type CreationIssue } from './choice-plan-feedback';
import { addSuggestedOption, addSuggestedTopic, emptyChoicePlan, suggestedChoices, suggestedDecisionTitle, type CreationSuggestion } from './creation-options';
import { CreationSuggestions } from './creation-suggestions';
import { RenameAction } from './rename-action';
import { useEffect, useRef, useState } from 'react';
import { ChoicePlan, compileChoicePlan, Groups, KnownEnough as KE } from '@deal-table/contracts';
import { ruleText, variableText, valueText } from './connected-decision';
import { readDraftRequest,saveDraftRequest,draftFailureMessage } from './draft-request-state';
import { LoadingSkeleton, PageIcon } from './app-chrome';
import { appViewSearch, type CreationStep, type DecisionSection } from './navigation';
class UserFlowError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
function guidanceText(value: string) { return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function savedPublicAnswer(draft: Groups.GroupDraft | null, question: string): string | undefined {
  return [...(draft?.publicClarifications ?? [])].reverse().find(item => guidanceText(item.question) === guidanceText(question))?.answer;
}
function publicChoiceValues(variable: KE.PublicDecisionFrame['variables'][number], frame: KE.PublicDecisionFrame): string[] {
  if (variable.type === 'ENUM' || variable.type === 'ENUM_SET') return variable.options.map(option => option.label);
  const rule = frame.rules.find(item => 'variableId' in item && item.variableId === variable.id && (item.operator === 'IN' || item.operator === 'COMPARE' && item.comparison === 'EQ'));
  return rule?.operator === 'IN' ? rule.values.map(value => valueText(value, variable)) : rule?.operator === 'COMPARE' ? [valueText(rule.value, variable)] : [];
}
function DecisionRow({ decision, status, organizer, busy, onOpen, onOutcome, onReview, onRename, onDelete }: {
  decision: Groups.GroupSnapshot['decisions'][number]; status: DecisionListStatus | undefined; organizer: boolean; busy: boolean;
  onOpen: () => void; onOutcome: () => void; onReview: () => void; onRename: (name: string) => Promise<void>; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const name = decision.title ?? 'Untitled decision';
  const currentStatus = decision.current ? status : undefined;
  const canOpen = decision.current || !!status && status.label !== 'Status unavailable';
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  const menu = (rename?: () => void) => <>
    <button ref={trigger} type="button" className="ke-group-menu-trigger" disabled={busy}
      aria-label={`Actions for ${name}`} aria-expanded={menuOpen} aria-controls={`decision-actions-${decision.id}`}
      onClick={() => setMenuOpen(current => !current)}><PageIcon name="Ellipsis" /></button>
    <div id={`decision-actions-${decision.id}`} className="ke-decision-actions-menu" hidden={!menuOpen}>
      {status?.canViewOutcome && <button type="button" disabled={busy} onClick={() => { setMenuOpen(false); onOutcome(); }}><PageIcon name="Check" />View outcome</button>}
      {organizer && <>
        <button type="button" disabled={busy} onClick={() => { setMenuOpen(false); rename?.(); }}><PageIcon name="Pencil" />Rename</button>
        <button type="button" className="ke-decision-menu-delete" disabled={busy} onClick={() => { setMenuOpen(false); onDelete(); }}><PageIcon name="X" />Delete decision</button>
      </>}
    </div>
  </>;
  return <article ref={root} className="ke-decision-row ke-clickable-decision-row">
    <button type="button" className="ke-decision-row-open" disabled={busy || (!canOpen && !organizer)}
      onClick={canOpen ? onOpen : onReview}>
      <span className="ke-decision-row-content"><span className="ke-decision-row-title"><strong>{name}</strong></span>
        {currentStatus?.detail && <small>{currentStatus.detail}</small>}</span>
      {currentStatus && <span className="ke-decision-status-chip" data-tone={currentStatus.tone}>{currentStatus.label}</span>}
      <PageIcon name="ChevronRight" />
    </button>
    {(organizer || status?.canViewOutcome) && <div className="ke-decision-menu-wrap" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); trigger.current?.focus(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}>
      {organizer ? <RenameAction name={name} save={onRename} renderTrigger={menu} /> : menu()}
    </div>}
  </article>;
}
export function GroupDecisions({ group, api, reload, openDecision, onDirtyChange, creationStep, onOpenCreation, onCloseCreation }: { creationStep?: CreationStep; onOpenCreation?: (step: CreationStep, replace?: boolean) => void; onCloseCreation?: () => void; group: Groups.GroupSnapshot;
  api: (path: string, init?: RequestInit) => Promise<Response>; reload: () => Promise<void>; openDecision: (id: string, section?: DecisionSection) => void; startCollapsed?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [listStatuses, setListStatuses] = useState<Record<string, DecisionListStatus | null>>({});
  const [statusGroup, setStatusGroup] = useState<Groups.GroupSnapshot | null>(null);
  const statusApi = useRef(api); statusApi.current = api;
  useEffect(() => {
    const controller = new AbortController();
    let active = true, index = 0;
    const decisions = group.decisions;
    const statuses: Record<string, DecisionListStatus | null> = {};
    async function worker() {
      while (active && index < decisions.length) {
        const decision = decisions[index++]!;
        try {
          // Project immediately; private answers never enter list state or browser storage.
          const status = await readDecisionListStatus(statusApi.current, decision.id, controller.signal);
          statuses[decision.id] = status;
        } catch {
          statuses[decision.id] = { label: 'Status unavailable', tone: 'muted' };
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, decisions.length) }, () => worker())).then(() => {
      if (active) { setListStatuses(statuses); setStatusGroup(group); }
    });
    return () => { active = false; controller.abort(); };
  }, [group]);
  const [localStarting, setStarting] = useState(false);
  const [localStep, setLocalStep] = useState<CreationStep>('describe');
  const starting = creationStep !== undefined || localStarting;
  const step = creationStep ?? localStep;
  function setStep(next: CreationStep) { setLocalStep(next); if (creationStep) onOpenCreation?.(next); }
  function showWizard(next: CreationStep) {
    setLocalStep(next);
    if (onOpenCreation) onOpenCreation(next); else setStarting(true);
  }
  const [aiWorking, setAiWorking] = useState(false);
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
  const creationPage = useRef<HTMLElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpGoal, setHelpGoal] = useState('');
  const [helpFeedback, setHelpFeedback] = useState<'idle' | 'pending' | 'ready' | 'failed'>('idle');
  const helpToggle = useRef<HTMLButtonElement>(null), helpField = useRef<HTMLInputElement>(null), helpAction = useRef<HTMLButtonElement>(null);
  const assistancePanel = useRef<HTMLElement>(null);
  const [descriptionError, setDescriptionError] = useState('');
  const [exampleToApply, setExampleToApply] = useState<string | null>(null);
  const aiIntent = useRef<'description' | 'options'>((() => {
    try { return sessionStorage.getItem('ke-creation-assist-intent:' + group.id) === 'description' ? 'description' : 'options'; } catch { return 'options'; }
  })());
  const editorKey = 'ke-public-choice-editor:' + group.id;
  const [choicePlan, setChoicePlan] = useState<ChoicePlan | null>(() => {
    try { const cached = JSON.parse(sessionStorage.getItem(editorKey) ?? 'null'); const parsed = ChoicePlan.safeParse(cached?.plan ?? cached); return parsed.success ? parsed.data : null; } catch { return null; }
  });
  // Old caches and saved drafts have unknown title provenance: conservatively preserve their names.
  const [titleEdited, setTitleEdited] = useState(() => {
    try { const cached = JSON.parse(sessionStorage.getItem(editorKey) ?? 'null'); return !!choicePlan && cached?.titleEdited !== false; }
    catch { return !!choicePlan; }
  });
  const optionsPreview = useRef<HTMLDivElement>(null);
  const [choiceMode, setChoiceMode] = useState(() => !!choicePlan), [choiceSaved, setChoiceSaved] = useState(false);
  const [choiceDraft, setChoiceDraft] = useState<Groups.GroupDraft | null>(() => {
    try { const parsed = Groups.GroupDraft.safeParse(JSON.parse(sessionStorage.getItem(editorKey) ?? 'null')?.draft);
      return parsed.success && !parsed.data.createdDecisionId && !parsed.data.deleted ? parsed.data : null; } catch { return null; }
  });
  const [aiReview, setAiReview] = useState<CreationSuggestion | null>(() => {
    try { const raw = JSON.parse(sessionStorage.getItem(editorKey) ?? 'null')?.suggestion;
      const saved = Groups.GroupDraft.safeParse(raw?.draft), plan = ChoicePlan.safeParse(raw?.plan);
      return saved.success && plan.success && ['description', 'options'].includes(raw?.intent) && typeof raw?.description === 'string' && raw.description.length <= 2000
        ? { draft: saved.data, plan: plan.data, description: raw.description, intent: raw.intent } : null;
    } catch { return null; }
  });
  const [hideEarlierSuggestions, setHideEarlierSuggestions] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(editorKey) ?? 'null')?.hideEarlierSuggestions === true; } catch { return false; }
  });
  const earlierSuggestionsHidden = useRef(hideEarlierSuggestions); earlierSuggestionsHidden.current = hideEarlierSuggestions;
  function hideRecoveredSuggestions(value: boolean) { earlierSuggestionsHidden.current = value; setHideEarlierSuggestions(value); }
  const [choiceConflict, setChoiceConflict] = useState<Groups.GroupDraft | null>(null);
  const editorVersion = useRef(0);
  const manualPendingKey = editorKey + ':save';
  const manualPending = useRef<{ objective: string; choicePlan: ChoicePlan; idempotencyKey: string } | null>((() => {
    try { const value = JSON.parse(sessionStorage.getItem(manualPendingKey) ?? 'null');
      return value && typeof value.objective === 'string' && value.objective.length <= 2000
        && typeof value.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.idempotencyKey)
        && ChoicePlan.safeParse(value.choicePlan).success ? value : null;
    } catch { return null; }
  })());
  function changeChoices(plan: ChoicePlan) { if (plan.title !== choicePlan?.title) setTitleEdited(true); editorVersion.current++; setChoicePlan(plan); setChoiceSaved(false); setDirty(true); }
  function openChoices() {
    editorVersion.current++;
    if (!choicePlan && draft?.choicePlan) { setChoicePlan(draft.choicePlan); setChoiceDraft(draft); setChoiceSaved(true); setTitleEdited(true); }
    else if (!choicePlan) { setChoicePlan(emptyChoicePlan(objective)); setTitleEdited(false); }
    else if (!titleEdited) {
      const title = suggestedDecisionTitle(objective);
      if (title !== choicePlan.title) { setChoicePlan({ ...choicePlan, title }); setChoiceSaved(false); setDirty(true); }
    }
    setChoiceMode(true); showWizard('options');
  }
  async function saveChoices() {
    if (choiceConflict) throw new UserFlowError('Choose whether to load the saved version or keep your edits before saving.');
    if (!choicePlan || !objective.trim()) throw new UserFlowError('Describe the decision first. Your choices are kept.');
    const parsed = ChoicePlan.safeParse(choicePlan);
    if (!parsed.success) throw new UserFlowError('Check the question titles and choice lengths. Your draft is kept.');
    let saved: Groups.GroupDraft;
    if (choiceDraft) {
      const compiled = compileChoicePlan(parsed.data);
      const body = { revision: choiceDraft.revision,
        title: parsed.data.title.trim() || suggestedDecisionTitle(objective), objective,
        variables: compiled.variables, rules: compiled.rules, choicePlan: parsed.data };
      try { const result = await request(`drafts/${choiceDraft.id}`, body, true); saved = Groups.GroupDraft.parse(result.draft); }
      catch (error) {
        const result = await request(`drafts/${choiceDraft.id}`, undefined, true);
        const observed = Groups.GroupDraft.parse(result.draft);
        if (JSON.stringify(observed.choicePlan) !== JSON.stringify(parsed.data) || observed.frame.objective !== objective) {
          if (observed.revision !== choiceDraft.revision || observed.createdDecisionId) setChoiceConflict(observed);
          throw error;
        }
        saved = observed;
      }
    } else {
      manualPending.current ??= { objective, choicePlan: parsed.data, idempotencyKey: crypto.randomUUID() };
      try { sessionStorage.setItem(manualPendingKey, JSON.stringify(manualPending.current)); } catch { /* Preserve in-memory request. */ }
      let result;
      try { result = await request('drafts', manualPending.current, true); }
      catch (error) {
        if (error instanceof UserFlowError && error.status && [400,401,403,404,409,422].includes(error.status)) {
          manualPending.current = null; sessionStorage.removeItem(manualPendingKey);
        }
        throw error;
      }
      saved = Groups.GroupDraft.parse(result.draft); manualPending.current = null; sessionStorage.removeItem(manualPendingKey);
    }
    setChoiceDraft(saved); setDraft(saved);
    if (JSON.stringify(saved.choicePlan) !== JSON.stringify(parsed.data) || saved.frame.objective !== objective) {
      setChoiceSaved(false); throw new UserFlowError('Your earlier draft is saved. Save your latest edits before creating the decision.');
    }
    setChoicePlan(saved.choicePlan ?? parsed.data);
    setChoiceSaved(true); setDirty(false); setNotice('Draft saved.');
    await reload().catch(() => setNotice('Your draft is saved. The group list could not refresh, but you can continue here.')); return saved;
  }
  async function createChoices() {
    if (!choicePlan || choiceConflict || !choicePlanFeedback(choicePlan).valid) return;
    const saved = choiceSaved && choiceDraft ? choiceDraft : await saveChoices();
    let snapshot: KE.PublicDecisionSnapshot;
    try {
      const result = await request(`drafts/${saved.id}/create`, { revision: saved.revision }, true);
      snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot);
    } catch (error) {
      // A read can confirm an applied create, but never starts another creation.
      const observed = Groups.GroupDraft.parse((await request(`drafts/${saved.id}`, undefined, true)).draft);
      if (observed.revision !== saved.revision || JSON.stringify(observed.choicePlan) !== JSON.stringify(saved.choicePlan)
        || observed.frame.objective !== saved.frame.objective) { setChoiceConflict(observed); throw error; }
      if (!observed.createdDecisionId) {
        if (observed.revision !== saved.revision) setChoiceConflict(observed);
        throw error;
      }
      const response = await api(`/decisions/${observed.createdDecisionId}/public`);
      if (!response.ok) throw error;
      snapshot = KE.PublicDecisionSnapshot.parse(await response.json());
      if (snapshot.frame.decisionId !== observed.createdDecisionId) throw error;
    }
    setDirty(false); setChoiceMode(false); setChoiceDraft(null); setChoicePlan(null); setTitleEdited(false); setDraft(null); setObjective(''); setAiReview(null);
    sessionStorage.removeItem(editorKey); await reload().catch(() => {}); setStarting(false);
    onDirtyChange?.(false); openDecision(snapshot.frame.decisionId);
  }
  const [objective, setObjective] = useState(() => {
    try { const value = JSON.parse(sessionStorage.getItem(editorKey) ?? 'null')?.objective; return typeof value === 'string' && value.length <= 2000 ? value : ''; } catch { return ''; }
  });
  const [draft, setDraft] = useState<Groups.GroupDraft | null>(() => {
    try { const saved = Groups.GroupDraft.safeParse(JSON.parse(sessionStorage.getItem(editorKey) ?? 'null')?.legacyDraft);
      return saved.success && !saved.data.choicePlan && !saved.data.deleted && !saved.data.createdDecisionId ? saved.data : null;
    } catch { return null; }
  });
  const [locallySaved, setLocallySaved] = useState(false);
  useEffect(() => {
    try {
      if (choicePlan || objective || aiReview || draft || hideEarlierSuggestions) sessionStorage.setItem(editorKey, JSON.stringify({ plan: choicePlan, objective, draft: choiceDraft, suggestion: aiReview, titleEdited, hideEarlierSuggestions, legacyDraft: draft && !draft.choicePlan ? draft : null }));
      else sessionStorage.removeItem(editorKey);
      setLocallySaved(true);
    } catch { setLocallySaved(false); /* Keep in-memory work when browser storage is unavailable. */ }
  }, [choicePlan, objective, choiceDraft, aiReview, draft, editorKey, titleEdited, hideEarlierSuggestions]);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!starting) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (step === 'describe') objectiveInput.current?.focus({ preventScroll: true });
    else draftHeading.current?.focus({ preventScroll: true });
  }, [starting, step]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answersByQuestion = useRef<Record<string, string>>({});
  useEffect(() => { setAnswers(Object.fromEntries((draft?.clarificationQuestions ?? []).map((question, index) => [index, answersByQuestion.current[question] ?? savedPublicAnswer(draft, question) ?? '']))); }, [draft?.id]);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const pending = useRef<{ objective?: string; followUp?: { draftId: string; revision: number; answers: string[] }; choiceContext?: ChoicePlan; idempotencyKey: string } | null>(null);
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
    if (state.state === 'SAVED' && 'draft' in state) {
      const recovered = Groups.GroupDraft.parse(state.draft);
      if (!earlierSuggestionsHidden.current) reviewSuggestions(recovered);
      finishRequest();
      setNotice(earlierSuggestionsHidden.current ? 'Your earlier draft is saved. Open it from your saved drafts to continue it.' : ''); await reload(); return 'SAVED';
    }
    else if (state.state === 'FAILED' && state.canRelease) {
      // Only a confirmed terminal outcome may close automatically. Unknown or active
      // calls keep their original key; this never starts another paid request.
      const released = await request(`draft-requests/${key}/release`, { revision: state.revision });
      if (epoch !== recoveryEpoch.current) return;
      const value = released.draftRequest as { state?: unknown; canRelease?: unknown } | undefined;
      if (!value || !['FAILED','CANCELLED'].includes(String(value.state)) || value.canRelease !== true) throw new Error('Terminal release not confirmed');
      finishRequest();
      setNotice('The assistant couldn’t finish a new draft. Your saved draft is unchanged. You can edit it and try again.');
      return 'CLOSED';
    }
    else setNotice('progress' in state && state.progress === 'EXPIRED' ? 'The assistant didn’t start before this attempt expired. Close it to return to your draft.'
      : state.state === 'UNKNOWN' ? 'We couldn’t confirm the suggestions yet. Check again before asking AI for more. If this continues, ask the preview owner for help.'
      : state.state === 'PENDING' ? state.canRelease ? 'The assistant hasn’t started. Check progress, or close this attempt to return to your draft.' : 'The assistant hasn’t finished. Check progress again. If this continues, ask the preview owner for help.'
      : 'This request has stopped. Choose “Close attempt” to continue.');
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
      } catch (error) { if (active) setNotice(error instanceof UserFlowError ? error.message : 'We couldn’t check the earlier attempt. Choose Check progress to try again.'); }
      finally { window.clearTimeout(timeout); if (active) setCheckingRequest(false); }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); ++recoveryEpoch.current; };
  }, [group.id,group.isOrganizer,recoveryGeneration]);
  const [roster, setRoster] = useState<{ id: string; frame: KE.PublicDecisionFrame; controlVersion: number; groupVersion: number;
    participants: { id: string; displayName: string }[] } | null>(null);
  async function request(path: string, body?: unknown, manual = false) {
    const response = await api(`/groups/${group.id}/${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let result: unknown; try { result = await response.json(); } catch { throw new UserFlowError(manual ? 'We could not read the save result. Your choices are kept; retry the same save to check it.' : draftFailureMessage(response.status,null), response.status); }
    if (!response.ok) {
      const reference = result && typeof result === 'object' && 'requestId' in result && typeof result.requestId === 'string'
        && /^[A-Za-z0-9_-]{1,100}$/.test(result.requestId) ? ` Reference: ${result.requestId}.` : '';
      throw new UserFlowError((manual ? response.status === 409 ? 'The group or draft changed. Your edits are kept. Check the latest saved draft before trying again.' : response.status === 403 ? 'Only the current group organizer can save or create this decision.' : response.status >= 500 ? 'The save result is not confirmed. Your choices are kept; retry the same save.' : 'These choices could not be saved. Check the names, choices and your session; your edits are kept.' : draftFailureMessage(response.status,result)) + reference, response.status);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response');
    return result as Record<string, unknown>;
  }
  async function action(work: () => Promise<unknown>) {
    if (busyGuard.current) return; busyGuard.current = true;
    setBusy(true); setNotice('');
    try { await work(); } catch (error) { setNotice(error instanceof UserFlowError ? error.message : 'We couldn’t confirm the result. Refresh to check before trying again.'); }
    finally { busyGuard.current = false; setBusy(false); }
  }
  async function draftObjective(value: string, followUp?: { draftId: string; revision: number; answers: string[] }, choiceContext?: ChoicePlan) {
    if (!pending.current) { const key = crypto.randomUUID(); pending.current = { objective: value, ...(followUp ? { followUp } : {}), ...(choiceContext ? { choiceContext } : {}), idempotencyKey: key }; saveDraftRequest(group.id,key); setPendingKey(key); }
    if (!pending.current.objective) { await recoverRequest(pending.current.idempotencyKey); return; }
    const startedVersion = editorVersion.current;
    setAiWorking(true);
    try {
      const result = await request('drafts', pending.current);
      const prepared = Groups.GroupDraft.parse(result.draft);
      reviewSuggestions(prepared); finishRequest();
      setNotice(editorVersion.current !== startedVersion ? 'These suggestions use your earlier description. Your newer edits are kept.' : '');
      await reload().catch(() => {});
    } catch (error) {
      if (aiIntent.current === 'description') setHelpFeedback('failed');
      // A failed acknowledgement is followed by a status read, never a second paid call.
      try {
        const recovered = await recoverRequest(pending.current?.idempotencyKey);
        if (recovered === 'SAVED') return;
        if (recovered === 'CLOSED') {
          setNotice((error instanceof UserFlowError ? error.message : 'That attempt finished without a new draft.')
            + ' This attempt is closed. You can edit your draft and try again.');
          return;
        }
      } catch { /* Keep the original failure and nonce unless closure was confirmed. */ }
      setNotice((error instanceof UserFlowError ? error.message : 'We couldn’t prepare suggestions.') + ' You can still add your own choices below. Check the earlier attempt before asking AI again.');
    } finally { setAiWorking(false); }
  }

  const answersTooLong = Object.values(answers).some(answer => answer.length > 500);
  function changeFrame(frame: KE.PublicDecisionFrame) {
    if (draft) setDraft({ ...draft, frame }); setReviewed(false); setDirty(true);
  }
  async function saveDraft() {
    if (!draft) return;
    const result = await request(`drafts/${draft.id}`, { revision: draft.revision, title: draft.frame.title, objective: draft.frame.objective, variables: draft.frame.variables, rules: draft.frame.rules });
    const saved = Groups.GroupDraft.parse(result.draft); setDraft(saved); setStep('options'); setDirty(false); setRoster(null); setReviewed(false); await reload(); return saved;
  }
  function changeDescription(value: string) {
    editorVersion.current++; setObjective(value); setDescriptionError(''); setChoiceSaved(false); setDirty(true);
    if (draft && !draft.choicePlan && !choicePlan) setDraft({ ...draft, frame: { ...draft.frame, objective: value } });
  }
  function continueToOptions() {
    if (!objective.trim()) { setDescriptionError('Describe the decision to continue.'); objectiveInput.current?.focus(); return; }
    if (objective.length > 2000) { setDescriptionError('Keep your description within 2,000 characters.'); return; }
    if (draft && !draft.choicePlan && !choicePlan) { setChoiceMode(false); setStep('options'); return; }
    openChoices();
  }
  function reviewSuggestions(prepared: Groups.GroupDraft) {
    if (aiIntent.current === 'description') setHelpFeedback('ready');
    setAiReview({ draft: prepared, plan: suggestedChoices(prepared), intent: aiIntent.current,
      description: prepared.choicePlan?.description.trim() || prepared.frame.description.trim() || prepared.frame.objective });
  }
  function askForHelp(intent: 'description' | 'options', value = objective) {
    if (!value.trim() || pendingKey || !requestLookupAvailable || checkingRequest || busyGuard.current) return;
    hideRecoveredSuggestions(false); aiIntent.current = intent;
    if (intent === 'description') setHelpFeedback('pending');
    try { sessionStorage.setItem('ke-creation-assist-intent:' + group.id, intent); } catch { /* In-memory intent remains available. */ }
    const context = choicePlan?.topics.some(topic => topic.options.length) ? choicePlan : undefined;
    void action(() => draftObjective(value, undefined, context));
  }
  function acceptOption(topic: ChoicePlan['topics'][number], option: string) {
    const next = addSuggestedOption(choicePlan ?? emptyChoicePlan(objective), topic, option);
    if (!next) return;
    if (!choiceDraft && aiReview?.draft.choicePlan) { setChoiceDraft(aiReview.draft); setDraft(aiReview.draft); }
    changeChoices(next); setChoiceMode(true);
  }
  function acceptTopic(topic: ChoicePlan['topics'][number]) {
    if (!choicePlan) return;
    const next = addSuggestedTopic(choicePlan, topic);
    if (!next) return;
    if (!choiceDraft && aiReview?.draft.choicePlan) { setChoiceDraft(aiReview.draft); setDraft(aiReview.draft); }
    changeChoices(next);
  }
  function updateSuggestions(values: string[]) {
    if (!aiReview || !requestLookupAvailable || pendingKey) return;
    if (aiReview.draft.clarificationQuestions.every((question, index) => guidanceText(savedPublicAnswer(aiReview.draft, question) ?? '') === guidanceText(values[index] ?? ''))) {
      setNotice('Add a little more detail, or edit your choices directly.'); return;
    }
    aiIntent.current = aiReview.intent;
    void action(() => draftObjective(aiReview.draft.frame.objective, { draftId: aiReview.draft.id, revision: aiReview.draft.revision, answers: values }));
  }
  async function createLegacyDraft() {
    if (!draft || draft.clarificationQuestions.length || answersTooLong) return;
    const saved = dirty ? await saveDraft() : draft;
    if (!saved || saved.clarificationQuestions.length) return;
    let snapshot: KE.PublicDecisionSnapshot;
    try { snapshot = KE.PublicDecisionSnapshot.parse((await request(`drafts/${saved.id}/create`, { revision: saved.revision })).snapshot); }
    catch (error) {
      const observed = Groups.GroupDraft.parse((await request(`drafts/${saved.id}`)).draft);
      if (observed.revision !== saved.revision || !observed.createdDecisionId) throw error;
      const response = await api(`/decisions/${observed.createdDecisionId}/public`);
      if (!response.ok) throw error;
      snapshot = KE.PublicDecisionSnapshot.parse(await response.json());
      if (snapshot.frame.decisionId !== observed.createdDecisionId) throw error;
    }
    await reload().catch(() => {});
    setDraft(null); setObjective(''); setChoicePlan(null); setTitleEdited(false); setAiReview(null); setDirty(false); setStarting(false);
    sessionStorage.removeItem(editorKey); onDirtyChange?.(false); openDecision(snapshot.frame.decisionId);
  }
  function closeWizard() {
    if (busyGuard.current) return;
    if (onCloseCreation) { onCloseCreation(); return; }
    if (dirty && !window.confirm('Leave this draft? Your description and choices are kept on this browser.')) return;
    setStarting(false); launcher.current?.focus();
  }
  function continueWizard() {
    if (choicePlan) setChoiceMode(true);
    showWizard(draft || choicePlan ? 'options' : 'describe');
  }
  function startWizard() {
    if (busyGuard.current) return;
    // An uncertain save keeps its original body/key until its result is checked.
    if (manualPending.current) { setNotice('Check your last draft save before starting another. Choose Continue unsaved draft, then retry the same save.'); return; }
    editorVersion.current++; recoveryEpoch.current++;
    hideRecoveredSuggestions(true);
    setObjective(''); setChoicePlan(null); setChoiceDraft(null); setDraft(null); setAiReview(null);
    setChoiceMode(false); setChoiceSaved(false); setChoiceConflict(null); setTitleEdited(false);
    setAnswers({}); answersByQuestion.current = {}; setRoster(null); setReviewed(false);
    setHelpOpen(false); setHelpGoal(''); setHelpFeedback('idle'); setExampleToApply(null);
    setDescriptionError(''); setNotice(''); setDirty(false);
    // Only clear public editor presentation; AI/save recovery references stay intact.
    try { sessionStorage.removeItem(editorKey); } catch { /* The blank in-memory editor remains usable. */ }
    onDirtyChange?.(false); showWizard('describe');
  }
  async function loadDraft(id: string) {
    if (dirty && !window.confirm('Open this saved draft and replace the unsaved edits in this window?')) return;
    const result = await request(`drafts/${id}`), saved = Groups.GroupDraft.parse(result.draft);
    hideRecoveredSuggestions(false); setAiReview(null); setHelpOpen(false);
    setDraft(saved); setObjective(saved.frame.objective);
    if (saved.choicePlan) { setChoicePlan(saved.choicePlan); setChoiceDraft(saved); setChoiceSaved(true); setChoiceMode(true); }
    else { setChoicePlan(null); setChoiceDraft(null); setChoiceMode(false); setChoiceSaved(false); }
    setChoiceConflict(null); setTitleEdited(true); setDirty(false); setRoster(null); setReviewed(false); showWizard('options');
  }
  async function deleteItem() {
    if (!deleteTarget || !group.isOrganizer) return;
    const selected = deleteTarget;
    const result = await request('remove', { kind: selected.kind, id: selected.id, version: group.version });
    const updated = Groups.GroupSnapshot.parse(result.group);
    if (updated.id !== group.id || (selected.kind === 'DRAFT' ? updated.drafts : updated.decisions).some(item => item.id === selected.id)) throw new Error('Deletion not confirmed');
    if (selected.kind === 'DECISION' && roster?.id === selected.id) setRoster(null);
    if (draft && (draft.id === selected.id || draft.createdDecisionId === selected.id) || choiceDraft?.id === selected.id) {
      setChoicePlan(null); setChoiceDraft(null); setChoiceMode(false);
      setDraft(null); setObjective(''); setAnswers({}); answersByQuestion.current = {};
      setDirty(false); setReviewed(false); setStep('describe'); setStarting(false);
    }
    if (aiReview?.draft.id === selected.id) setAiReview(null);
    setDeleteTarget(null);
    setNotice(selected.kind === 'DRAFT' ? 'Draft deleted.' : 'Decision deleted for everyone in this group.');
    await reload();
  }
  async function releaseRequest() {
    if (!pendingKey || !requestState?.canRelease) return;
    const result = await request(`draft-requests/${pendingKey}/release`, { revision: requestState.revision });
    const value = result.draftRequest as { state?: unknown; canRelease?: unknown } | undefined;
    if (!value || !value.canRelease || !['CANCELLED','FAILED','SAVED'].includes(String(value.state))) throw new Error('Release not confirmed');
    finishRequest(); setStep(draft || choicePlan ? 'options' : 'describe');
    setNotice('That attempt is closed. You can continue editing your draft.');
  }
  const descriptionReview = aiReview?.intent === 'description' ? aiReview : null;
  const descriptionSource = objective.trim() ? objective : helpGoal;
  const descriptionBlocked = busy || !!pendingKey || checkingRequest || !requestLookupAvailable || !descriptionSource.trim();
  const requestRecovery = pendingKey && !aiWorking && <details className="ke-creation-recovery"><summary>Check earlier suggestions</summary><p>{requestState?.state === 'UNKNOWN' ? 'We couldn’t confirm the result. Check this attempt before asking again. You can still edit your choices.' : 'Check the earlier attempt before asking again. Your draft stays unchanged.'}</p>
              <button type="button" className="secondary" disabled={busy || checkingRequest} onClick={() => void action(() => recoverRequest())}>Check progress</button>
              {requestState?.canRelease && <button type="button" className="ke-text-link" disabled={busy} onClick={() => void action(releaseRequest)}>Close attempt</button>}
            </details>;
  const lookupRecovery = !requestLookupAvailable && !checkingRequest && !pendingKey && (helpOpen || step === 'options') && <p className="ke-creation-hint">Suggestions are temporarily unavailable. You can add your own choices. <button type="button" className="ke-text-link" disabled={busy} onClick={() => { setCheckingRequest(true); setRecoveryGeneration(value => value + 1); }}>Check again</button></p>;
  function revealAssistance() {
    assistancePanel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function closeAssistance(discard = false) {
    setHelpOpen(false);
    if (discard) { setAiReview(current => current?.intent === 'description' ? null : current); setHelpGoal(''); setHelpFeedback('idle'); }
    requestAnimationFrame(() => helpToggle.current?.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (!starting || step !== 'describe' || !helpOpen) return;
    const frame = requestAnimationFrame(() => {
      const target = assistancePanel.current?.querySelector<HTMLTextAreaElement>('[data-description-suggestion]') ?? helpField.current ?? helpAction.current ?? assistancePanel.current;
      const focusTarget = target && 'disabled' in target && target.disabled ? assistancePanel.current : target;
      focusTarget?.focus({ preventScroll: true }); revealAssistance();
    });
    return () => cancelAnimationFrame(frame);
  }, [helpOpen, starting, step]);
  useEffect(() => {
    if (!starting || step !== 'describe' || !helpOpen || !descriptionReview || busy || aiWorking) return;
    const frame = requestAnimationFrame(() => {
      const panel = assistancePanel.current;
      if (!panel || document.activeElement !== document.body && !panel.contains(document.activeElement)) return;
      panel.querySelector<HTMLTextAreaElement>('[data-description-suggestion]')?.focus({ preventScroll: true }); revealAssistance();
    });
    return () => cancelAnimationFrame(frame);
  }, [descriptionReview?.draft.id, busy, aiWorking, starting, step, helpOpen]);
  useEffect(() => {
    if (!starting || step !== 'describe' || !helpOpen || busy || helpFeedback !== 'failed') return;
    const frame = requestAnimationFrame(() => {
      const panel = assistancePanel.current;
      if (!panel || document.activeElement !== document.body && !panel.contains(document.activeElement)) return;
      const target = pendingKey ? panel.querySelector<HTMLButtonElement>('.ke-creation-recovery button') : helpAction.current;
      (target && !target.disabled ? target : panel).focus({ preventScroll: true }); revealAssistance();
    });
    return () => cancelAnimationFrame(frame);
  }, [helpFeedback, busy, pendingKey, starting, step, helpOpen]);
  useEffect(() => {
    if (creationStep === 'options' && !objective.trim()) onOpenCreation?.('describe', true);
    else if (creationStep === 'options' && !choicePlan && !(draft && !draft.choicePlan)) {
      setChoicePlan(emptyChoicePlan(objective)); setChoiceMode(true);
    }
  }, [creationStep, objective, choicePlan, draft, onOpenCreation]);
  useEffect(() => {
    if (step !== 'options' || aiReview?.intent !== 'options' || busy) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== document.body && !(active instanceof HTMLElement && active.matches('[data-options-assist]'))) return;
      optionsPreview.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      optionsPreview.current?.querySelector<HTMLHeadingElement>('h3')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [step, aiReview?.draft.id, aiReview?.intent, busy]);
  const optionSuggestions = aiReview?.intent === 'options' ? <div ref={optionsPreview} className="ke-inline-options-suggestions"><CreationSuggestions key={aiReview.draft.id} review={aiReview} plan={choicePlan ?? { ...emptyChoicePlan(objective), title: draft?.frame.title ?? suggestedDecisionTitle(objective) }} busy={busy}
              onChange={setAiReview} onAdd={acceptOption} {...(choiceMode && choicePlan ? { onAddTopic: acceptTopic } : {})} onUseTitle={name => { if (choiceMode && choicePlan) changeChoices({ ...choicePlan, title: name }); else if (draft) changeFrame({ ...draft.frame, title: name }); }} onDismiss={() => setAiReview(null)} onUseDescription={() => { changeDescription(aiReview.description); setAiReview(null); setHelpOpen(false); }}
              onUseLegacyDraft={() => { setDraft(aiReview.draft); setObjective(aiReview.draft.frame.objective); setChoicePlan(null); setChoiceDraft(null); setChoiceMode(false); setAiReview(null); setDirty(false); setStep('options'); requestAnimationFrame(() => draftHeading.current?.focus()); }} onFollowUp={updateSuggestions} /></div> : null;
  const creationIssues: CreationIssue[] = choiceConflict ? [{ fieldId: 'creation-draft-conflict', message: 'Choose the saved draft or keep your edits before creating.' }]
    : choiceMode ? choicePlan ? choicePlanFeedback(choicePlan).issues : [{ fieldId: `decision-wizard-title-${group.id}`, message: 'Add a question and its choices.' }]
    : !draft ? [{ fieldId: `decision-wizard-title-${group.id}`, message: 'Add questions and choices before creating.' }]
    : draft.clarificationQuestions.map((_question, index) => ({ fieldId: `creation-legacy-clarification-${index}`, message: `Answer draft question ${index + 1}, save any edits, then choose Update suggestions.` }));
  function focusCreationIssue(fieldId: string) {
    const target = creationPage.current?.querySelector<HTMLElement>('#' + CSS.escape(fieldId)) ?? draftHeading.current;
    const disclosure = target?.closest('details');
    if (disclosure) disclosure.open = true;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function submitDecision() {
    if (busy) return;
    if (creationIssues.length) { focusCreationIssue(creationIssues[0]!.fieldId); return; }
    void action(choiceMode ? createChoices : createLegacyDraft);
  }
  const hasLocalDraft = !!objective.trim() || !!choicePlan || !!draft || !!aiReview || !!pendingKey || !!manualPending.current;
  const visibleDecisions = group.decisions.filter(decision => listStatuses[decision.id] !== null);
  const hasSavedDrafts = group.isOrganizer && group.drafts.some(draft => !draft.created);
  if (!starting && group.decisions.length > 0 && statusGroup !== group) {
    return <LoadingSkeleton kind="decisions" label="Loading decisions" className="ke-card ke-group-panel ke-decisions-panel" />;
  }
  return <section className={starting ? 'ke-workflow-content ke-creation-page-container' : 'ke-card ke-group-panel ke-decisions-panel'} aria-busy={busy} aria-labelledby={starting ? `decision-wizard-title-${group.id}` : `decisions-heading-${group.id}`}>
    {!starting && <>
    <header className="ke-panel-heading"><div><h2 id={`decisions-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span><span>Decisions</span></h2>
      <p className="ke-panel-subtitle">Choose an option that works for your group.</p></div>
      {group.isOrganizer && (visibleDecisions.length > 0 || hasSavedDrafts || hasLocalDraft) && <div className="ke-decision-create-actions">
        {hasLocalDraft && <button type="button" className="secondary" disabled={busy} onClick={continueWizard}>Continue unsaved draft</button>}
        <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />Start a decision</button>
      </div>}</header>
    {!visibleDecisions.length && !hasSavedDrafts && !hasLocalDraft && <div className="ke-decision-empty">
      <span className="ke-decision-empty-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span>
      <h3>What will you decide together?</h3><p>Describe a decision and bring your group together.</p>
      {group.isOrganizer ? <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />Start a decision</button>
        : <p>Your group organizer can start a decision.</p>}
    </div>}
    <div className="ke-decision-list">{visibleDecisions.map(decision => <DecisionRow key={decision.id} decision={decision} status={listStatuses[decision.id] ?? undefined} organizer={group.isOrganizer} busy={busy}
      onOpen={() => openDecision(decision.id)}
      onOutcome={() => openDecision(decision.id, 'outcome')}
      onReview={() => void action(async () => {
        const result = await request(`decisions/${decision.id}/review`);
        setDraft(null); setDirty(false); setRoster({ id: decision.id, frame: KE.PublicDecisionFrame.parse(result.frame), controlVersion: result.controlVersion as number,
          groupVersion: result.groupVersion as number, participants: result.participants as { id: string; displayName: string }[] }); setReviewed(false);
      })}
      onRename={async name => { await request('name', { version: group.version, name, previousName: decision.title ?? 'Untitled decision', decisionId: decision.id }); await reload(); }}
      onDelete={() => setDeleteTarget({ kind: 'DECISION', id: decision.id, title: decision.title ?? 'this decision' })} />)}</div>
    {group.isOrganizer && group.drafts.some(item => !item.created) && <div className="ke-wizard-saved-list">
      <h3>Your saved drafts</h3>{group.drafts.filter(item => !item.created).map(item => <div className="ke-decision-row" key={item.id}>
        <span className="ke-decision-row-title"><strong>{item.title}</strong><span className="ke-decision-status-chip" data-tone="muted">Draft</span></span><div className="ke-decision-row-actions">{item.current
          ? <button type="button" className="secondary" disabled={busy || !!pendingKey} onClick={() => void action(() => loadDraft(item.id))}>Continue draft</button>
          : <small>The group changed. Start a new draft for the current members.</small>}
          <button type="button" className="secondary ke-delete-action" disabled={busy}
            onClick={() => setDeleteTarget({ kind: 'DRAFT', id: item.id, title: item.title })}>Delete draft</button>
        </div>
      </div>)}
    </div>}
    </>}
    {group.isOrganizer && <Modal ref={deleteDialog} className="ke-delete-dialog" aria-labelledby={`delete-title-${group.id}`}
      aria-describedby={`delete-description-${group.id}`} onCancel={event => { event.preventDefault(); if (!busyGuard.current) setDeleteTarget(null); }}>
      <h2 id={`delete-title-${group.id}`}>Delete {deleteTarget?.kind === 'DRAFT' ? 'draft' : 'decision'}?</h2>
      <p id={`delete-description-${group.id}`}>{deleteTarget?.kind === 'DRAFT'
        ? `Delete “${deleteTarget.title}”? It will disappear from your saved drafts and cannot be reopened.`
        : 'This decision will be removed for everyone in the group. Existing links will stop working.'}</p>
      <p className="ke-delete-note">This cannot be undone. The item disappears from the group, but saved history is retained.</p>
      <div className="ke-wizard-actions">
        <button type="button" className="secondary" autoFocus disabled={busy} onClick={() => setDeleteTarget(null)}>Keep {deleteTarget?.kind === 'DRAFT' ? 'draft' : 'decision'}</button>
        <button type="button" className="ke-delete-confirm" disabled={busy || !deleteTarget} onClick={() => void action(deleteItem)}>{busy ? 'Deleting…' : deleteTarget?.kind === 'DRAFT' ? 'Delete draft' : 'Delete decision'}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </Modal>}
    {starting && group.isOrganizer && <section ref={creationPage} className="ke-creation-v2 ke-creation-page" aria-labelledby={`decision-wizard-title-${group.id}`} aria-describedby={`decision-wizard-subtitle-${group.id}`}>
      <a className="ke-workflow-back" href={appViewSearch({ kind: 'group', groupId: group.id })} onClick={event => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); closeWizard(); }
      }}><PageIcon name="ArrowLeft" />Back to group</a>
      <div className="ke-wizard-shell">
        <header className="ke-wizard-header"><div><span className="ke-wizard-eyebrow">New decision</span>
          <h1 id={`decision-wizard-title-${group.id}`} ref={draftHeading} tabIndex={-1}>{step === 'describe' ? 'What are we deciding?' : 'Review your choices'}</h1>
          <p id={`decision-wizard-subtitle-${group.id}`} className="ke-creation-subtitle">{step === 'describe' ? 'Describe the decision and any choices you’re considering.' : 'Give your decision a name, then choose what to ask your group.'}</p></div>
          {(objective.trim() || choicePlan) && <span className="ke-page-draft-state" role="status"><PageIcon name="Check" />{choiceSaved && !dirty ? 'Draft saved' : locallySaved ? 'Kept on this browser' : 'Not saved on this browser'}</span>}
        </header>
        <nav className="ke-creation-stepper" aria-label="Decision creation steps">
          <button type="button" disabled={busy && !aiWorking} aria-label="1. Describe" aria-current={step === 'describe' ? 'step' : undefined} data-complete={step === 'options'} onClick={() => setStep('describe')}>
            <span className="ke-creation-step-number" aria-hidden="true">{step === 'options' ? <PageIcon name="Check" /> : '1'}</span><span>Describe</span>
          </button>
          <span className="ke-creation-step-connector" aria-hidden="true" />
          <button type="button" disabled={!objective.trim() || busy && !aiWorking} aria-label="2. Choices" aria-current={step === 'options' ? 'step' : undefined} onClick={continueToOptions}>
            <span className="ke-creation-step-number" aria-hidden="true">2</span><span>Choices</span>
          </button>
        </nav>
        <div className="ke-wizard-body" aria-busy={busy && !aiWorking}>
          <div className="ke-creation-form">
            {step === 'describe' && <section className="ke-creation-describe" aria-label="Decision description">
              <label htmlFor={`group-objective-${group.id}`}>Describe the decision</label>
              <textarea ref={objectiveInput} id={`group-objective-${group.id}`} rows={4} value={objective} maxLength={2000}
                placeholder="e.g. We’re planning a weekend trip together and need to decide where to go."
                aria-invalid={!!descriptionError} aria-describedby={`description-help-${group.id}${descriptionError ? ` description-error-${group.id}` : ''}`}
                disabled={busy && !aiWorking} onChange={event => changeDescription(event.target.value)} />
              <div className="ke-description-meta"><p id={`description-help-${group.id}`} className="ke-creation-privacy"><PageIcon name="Lock" />Shared with your group. Keep personal preferences for your private answers.</p>
                <small>{objective.length.toLocaleString()} / 2,000</small></div>
              {descriptionError && <p id={`description-error-${group.id}`} className="ke-creation-error" role="alert">{descriptionError}</p>}
              <div className="ke-creation-starting-points" data-expanded={helpOpen}>
              <button ref={helpToggle} type="button" className="ke-text-link ke-icon-action ke-creation-assist" aria-expanded={helpOpen}
                aria-controls={`description-assistance-${group.id}`} data-active={helpOpen} disabled={busy && !aiWorking}
                onClick={() => { if (helpOpen) closeAssistance(); else { setExampleToApply(null); setHelpOpen(true); } }}>
                <PageIcon name="Sparkles" />Help me get started<span className="ke-assistance-chevron"><PageIcon name="ChevronRight" /></span>
              </button>
              {helpOpen && <section ref={assistancePanel} id={`description-assistance-${group.id}`} className="ke-description-assistance" aria-label="Description assistance" tabIndex={-1} aria-busy={aiWorking}>
                {aiWorking ? <><p className="ke-creation-assist-status" role="status"><PageIcon name="RefreshCw" />Writing a suggestion…</p>
                  <button type="button" className="ke-text-link" onClick={() => closeAssistance(true)}>Cancel</button></>
                  : descriptionReview ? <CreationSuggestions key={descriptionReview.draft.id} review={descriptionReview} plan={choicePlan ?? emptyChoicePlan(objective)} busy={busy}
                    onChange={setAiReview} onAdd={acceptOption} onDismiss={() => closeAssistance(true)}
                    onUseDescription={() => { changeDescription(descriptionReview.description); setAiReview(null); setHelpOpen(false); setHelpGoal(''); setHelpFeedback('idle'); requestAnimationFrame(() => { objectiveInput.current?.focus({ preventScroll: true }); objectiveInput.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); }); }}
                    onRetry={() => askForHelp('description', descriptionSource)} retryDisabled={descriptionBlocked}
                    onUseLegacyDraft={() => {}} onFollowUp={updateSuggestions} />
                  : <>
                    {objective.trim() ? <p className="ke-creation-hint">We’ll use the description above.</p> : <label htmlFor={`description-goal-${group.id}`}>What are you trying to decide?
                      <input ref={helpField} id={`description-goal-${group.id}`} value={helpGoal} maxLength={2000} disabled={busy} placeholder="For example, choose a place for our next trip" onChange={event => setHelpGoal(event.target.value)} /></label>}
                    <div className="ke-description-assistance-actions"><button ref={helpAction} type="button" className="ke-icon-action" disabled={descriptionBlocked} onClick={() => askForHelp('description', descriptionSource)}><PageIcon name="Sparkles" />{helpFeedback === 'failed' ? 'Try again' : 'Suggest description'}</button>
                      <button type="button" className="ke-text-link" onClick={() => closeAssistance(true)}>Cancel</button></div>
                  </>}
                {!aiWorking && notice && <p className="ke-assistance-feedback" role="status">{notice}</p>}
                {requestRecovery}{lookupRecovery}
                <p className="ke-assistance-privacy">Shared with your group. Use made-up details in this preview.</p>
              </section>}
              {!helpOpen && <div className="ke-creation-inspiration"><span>Or start with an example</span>{[
                ['Plan a trip', 'We want to plan a weekend trip together. We’re considering the coast, the mountains or a city break, and haven’t picked a date yet.'],
                ['Choose a restaurant', 'Our group is choosing a restaurant for Saturday dinner. We’re considering Cedar Kitchen, Moon Noodles and Garden Table.'],
                ['Compare a purchase', 'We want to buy something together and compare two shortlisted options. We need to decide which one best fits the group.'],
              ].map(([label, example]) => <button type="button" key={label} className="secondary" disabled={busy && !aiWorking} onClick={() => { if (objective.trim()) setExampleToApply(example!); else changeDescription(example!); }}>{label}</button>)}</div>}
              {!helpOpen && exampleToApply && <div className="ke-example-confirm" role="group" aria-label="Replace description with example"><p>Replace your description with this example? Your choices will stay.</p>
                <button type="button" className="secondary" onClick={() => { changeDescription(exampleToApply); setExampleToApply(null); }}>Use this example</button>
                <button type="button" className="ke-text-link" onClick={() => setExampleToApply(null)}>Keep my text</button></div>}
              </div>
            </section>}
            {step === 'options' && <section className="ke-creation-options" aria-label="Review your questions and choices">
              {choiceMode && choicePlan ? <>
                <ChoicePlanEditor plan={choicePlan} onChange={changeChoices} busy={busy && !aiWorking}
                  saveControls={<div className="ke-creation-save-state">{choiceSaved && <small role="status">Draft saved</small>}<button type="button" className="ke-text-link" disabled={busy || choiceSaved || !!choiceConflict} onClick={() => void action(saveChoices)}>Save draft</button></div>}
                  suggestionControls={<button type="button" data-options-assist data-loading={aiWorking} className="ke-text-link ke-icon-action" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onClick={() => askForHelp('options')}><PageIcon name={aiWorking ? 'RefreshCw' : 'Sparkles'} />{aiWorking ? 'Preparing suggestions…' : 'Suggest choices'}</button>}
                  suggestions={optionSuggestions} />
                {(choiceDraft?.aiAssisted || draft?.aiAssisted) && <p className="ke-creation-hint">This draft includes AI suggestions. Check names, dates and availability before creating it.</p>}
                {choiceConflict && <aside id="creation-draft-conflict" tabIndex={-1} className="ke-wizard-save" role="alert"><strong>A newer draft is saved. Your edits are kept here.</strong>
                  <details><summary>Review the latest saved choices</summary><h3>{choiceConflict.frame.title}</h3><p>{choiceConflict.frame.objective}</p><ul>{choiceConflict.frame.variables.map(variable => <li key={variable.id}>{variableText(variable, choiceConflict.frame)}</li>)}</ul></details>
                  {!choiceConflict.createdDecisionId && <button type="button" className="secondary" disabled={busy} onClick={() => { const latest = choiceConflict; if (!latest.choicePlan) return;
                    editorVersion.current++; setChoicePlan(latest.choicePlan); setTitleEdited(true); setObjective(latest.frame.objective); setChoiceDraft(latest); setDraft(latest); setChoiceSaved(true); setDirty(false); setChoiceConflict(null); setNotice('The latest saved draft is loaded.'); }}>Use latest saved draft</button>}
                  {!choiceConflict.createdDecisionId && <button type="button" className="secondary" disabled={busy} onClick={() => { editorVersion.current++; setChoiceDraft(choiceConflict); setChoiceConflict(null); setChoiceSaved(false); setDirty(true); setNotice('Your edits are ready to save over the version shown here.'); }}>Keep my edits</button>}
                  {choiceConflict.createdDecisionId && <button type="button" disabled={busy} onClick={() => { closeWizard(); openDecision(choiceConflict.createdDecisionId!); }}>Open created decision</button>}
                </aside>}
              </> : draft && <section className="ke-legacy-draft"><p className="ke-creation-hint">This saved draft keeps its original choices and group requirements.</p>
                <button type="button" className="ke-text-link ke-icon-action" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onClick={() => askForHelp('options')}><PageIcon name="Sparkles" />Suggest choices</button>
                <label>Decision name<input value={draft.frame.title} maxLength={160} disabled={busy} onChange={event => changeFrame({ ...draft.frame, title: event.target.value })} /></label>
                {draft.frame.variables.map((variable, index) => <fieldset key={variable.id}><legend>{variable.label}</legend><label>Question title<input value={variable.label} maxLength={160} disabled={busy} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((value, at) => at === index ? { ...value, label: event.target.value } : value) })} /></label>
                  {(variable.type === 'ENUM' || variable.type === 'ENUM_SET') ? variable.options.map((option, at) => <label key={option.id}>Choice {at + 1} for {variable.label}<input value={option.label} maxLength={120} disabled={busy} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, vi) => vi === index && (item.type === 'ENUM' || item.type === 'ENUM_SET') ? { ...item, options: item.options.map((value, oi) => oi === at ? { ...value, label: event.target.value } : value) } : item) })} /></label>) : <p>{publicChoiceValues(variable, draft.frame).join(' · ') || variableText(variable, draft.frame)}</p>}</fieldset>)}
                {!!draft.frame.rules.length && <details><summary>Group requirements</summary><ul>{draft.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, draft.frame.variables)}</li>)}</ul></details>}
                {draft.clarificationQuestions.map((question, index) => <label key={question}>{question}<textarea id={`creation-legacy-clarification-${index}`} rows={2} maxLength={500} disabled={busy || !!pendingKey} value={answers[index] ?? ''} onChange={event => { answersByQuestion.current[question] = event.target.value; setAnswers(current => ({ ...current, [index]: event.target.value })); }} /></label>)}
                {!!draft.clarificationQuestions.length && <button type="button" className="secondary" disabled={busy || dirty || !!pendingKey || !requestLookupAvailable || draft.clarificationQuestions.some((_q, i) => !answers[i]?.trim())} onClick={() => { aiIntent.current = 'options'; void action(() => draftObjective(draft.frame.objective, { draftId: draft.id, revision: draft.revision, answers: draft.clarificationQuestions.map((_q, i) => answers[i]!.trim()) })); }}>Update suggestions</button>}
                {dirty && <button type="button" className="ke-text-link" disabled={busy} onClick={() => void action(saveDraft)}>Save draft</button>}
              </section>}
              {!choiceMode && optionSuggestions}
              <p className="ke-creation-privacy"><PageIcon name="Lock" />These choices are shared. Everyone adds their own preferences privately after creation.</p>
            </section>}
            {aiWorking && (step !== 'describe' || !helpOpen) && <p className="ke-creation-assist-status" role="status"><PageIcon name="Sparkles" />Preparing suggestions. You can keep editing.</p>}
            {(step !== 'describe' || !helpOpen) && requestRecovery}
            {(step !== 'describe' || !helpOpen) && lookupRecovery}
            {!busy && notice && (step !== 'describe' || !helpOpen) && <div className="ke-wizard-notice" role="status">{notice}</div>}
            <details className="ke-creation-details ke-creation-privacy-details"><summary>Privacy in this preview</summary><p>Your group can see the description and choices. AI uses them when you ask for suggestions. Save personal limits for your private answers, and use made-up, non-sensitive information in this preview. Check suggested prices, dates and availability yourself. Keep the choices small: this preview can compare up to 64 possible outcomes across six questions, with up to sixteen choices per question. Creating a decision doesn’t approve a proposal or answer for anyone.</p></details>
          </div>
        </div>
        <footer className="ke-creation-footer" data-step={step}>
          {step === 'options' && <button type="button" className="secondary" disabled={busy && !aiWorking} onClick={() => setStep('describe')}><PageIcon name="ArrowLeft" />Back</button>}
          {step === 'options' && creationIssues.length > 0 && <div id="creation-validation-summary" className="ke-creation-validation-summary" role="status" aria-live="polite"><strong>Before creating, fix the following:</strong>
            <ul>{creationIssues.slice(0, 3).map(issue => <li key={issue.fieldId + issue.message}><button type="button" disabled={busy} onClick={() => focusCreationIssue(issue.fieldId)}>{issue.message}</button></li>)}</ul>
            {creationIssues.length > 3 && <details><summary>{creationIssues.length - 3} more {creationIssues.length - 3 === 1 ? 'item' : 'items'}</summary><ul>{creationIssues.slice(3).map(issue => <li key={issue.fieldId + issue.message}><button type="button" disabled={busy} onClick={() => focusCreationIssue(issue.fieldId)}>{issue.message}</button></li>)}</ul></details>}
          </div>}
          {step === 'options' && busy && !creationIssues.length && <p id="creation-busy-summary" className="ke-creation-validation-summary" role="status">{aiWorking ? 'Waiting for AI suggestions to finish…' : 'Finishing the current request…'}</p>}
          {step === 'describe' ? <button type="button" className="ke-icon-action ke-creation-primary" disabled={busy && !aiWorking} onClick={continueToOptions}>Continue<PageIcon name="ArrowRight" /></button>
            : <button type="button" className="ke-icon-action ke-creation-primary" disabled={busy} aria-disabled={busy || creationIssues.length > 0} aria-describedby={creationIssues.length ? 'creation-validation-summary' : busy ? 'creation-busy-summary' : undefined} onClick={submitDecision}>{busy && !aiWorking ? 'Creating…' : 'Create decision'}<PageIcon name="ArrowRight" /></button>}
        </footer>
      </div>
    </section>}
    {!starting && roster && <div className="local-note"><h4>Update who is taking part</h4><p>{roster.frame.objective}</p>
      <p>New members add their own answers. Finished decisions keep their original participants and outcome. Check who is taking part after removing someone or changing the options.</p>
      <ul>{roster.participants.map(member => <li key={member.id}>{member.displayName}</li>)}</ul>
      {roster.frame.variables.map(variable => <p key={variable.id}>{variableText(variable, roster.frame)}</p>)}
      <ul>{roster.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, roster.frame.variables)}</li>)}</ul>
      <p>Existing answers stay saved when someone joins. New members add their own answers. Each new proposal needs approval from all required participants.</p>
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I’ve checked who is taking part in this decision.</label>
      <button disabled={busy || !reviewed} onClick={() => void action(async () => {
        const result = await request(`decisions/${roster.id}/revise`, { controlVersion: roster.controlVersion, groupVersion: roster.groupVersion });
        const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); setRoster(null); setReviewed(false); await reload(); openDecision(snapshot.frame.decisionId);
      })}>Save participants</button>
    </div>}
    {starting && !group.isOrganizer && <section><h1 id={`decision-wizard-title-${group.id}`} tabIndex={-1}>New decision</h1><p>Only the group organizer can start a decision.</p><button type="button" onClick={closeWizard}>Back to group</button></section>}
    {!starting && !busy && notice && <p className="ke-wizard-help" role="status">{notice}</p>}
  </section>;
}
