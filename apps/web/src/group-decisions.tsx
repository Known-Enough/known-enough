import { ChoicePlanEditor } from './choice-plan-editor';
import { addSuggestedOption, emptyChoicePlan, suggestedChoices, type CreationSuggestion } from './creation-options';
import { CreationSuggestions } from './creation-suggestions';
import { DecisionGuide } from './decision-guide';
import { RenameAction } from './rename-action';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChoicePlan, compileChoicePlan, Groups, KnownEnough as KE } from '@deal-table/contracts';
import { ruleText, variableText, valueText } from './connected-decision';
import { readDraftRequest,saveDraftRequest,draftFailureMessage } from './draft-request-state';
import { PageIcon } from './app-chrome';
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
type DecisionListStatus = { label: string; tone: 'action' | 'waiting' | 'agreed' | 'muted'; detail?: string };
function decisionListStatus(owner: KE.OwnerDecisionSnapshot): DecisionListStatus {
  const snapshot = owner.publicSnapshot;
  const answered = snapshot.participantProgress ? `${snapshot.participantProgress.filter(item => item.answersSaved).length} of ${snapshot.frame.participants.length} answered` : undefined;
  if (snapshot.status === 'AGREED') return { label: 'Decision agreed', tone: 'agreed' };
  if (snapshot.status === 'CLOSED') return { label: 'Decision closed', tone: 'muted' };
  if (['CREATING', 'DEFINING'].includes(snapshot.status)) return { label: 'Draft', tone: 'muted' };
  if (owner.pendingQuestions.some(question => question.status === 'PENDING') || owner.disclosurePermissions.some(permission => permission.status === 'PENDING'))
    return { label: 'Needs your answer', tone: 'action', detail: 'Private follow-up' };
  if (snapshot.currentProposal) return owner.ownApproval
    ? { label: 'Waiting for approvals', tone: 'waiting', detail: `${snapshot.frame.requiredParticipantIds.filter(id => snapshot.approvedParticipantIds.includes(id)).length} of ${snapshot.frame.requiredParticipantIds.length} approved` }
    : { label: 'Ready for approval', tone: 'action', detail: 'Outcome proposed' };
  if (owner.ownInputReadiness !== 'READY') return { label: 'Needs your answer', tone: 'action', detail: answered };
  if (['READY', 'SUPERSEDED', 'NO_AGREEMENT'].includes(snapshot.status)) return { label: 'Ready for outcome', tone: 'action', detail: answered };
  return { label: 'Waiting for others', tone: 'waiting', detail: snapshot.status === 'REASONING' ? 'Finding an outcome' : answered };
}
function DecisionRow({ decision, status, organizer, busy, onOpen, onReview, onRename, onDelete }: {
  decision: Groups.GroupSnapshot['decisions'][number]; status?: DecisionListStatus; organizer: boolean; busy: boolean;
  onOpen: () => void; onReview: () => void; onRename: (name: string) => Promise<void>; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const name = decision.title ?? 'Untitled decision';
  const currentStatus: DecisionListStatus = decision.current ? status ?? { label: 'Loading status', tone: 'muted' } : { label: 'Needs review', tone: 'action' };
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  return <article ref={root} className="ke-decision-row ke-clickable-decision-row">
    <button type="button" className="ke-decision-row-open" disabled={busy || (!decision.current && !organizer)}
      onClick={decision.current ? onOpen : onReview}>
      <span className="ke-decision-row-content"><span className="ke-decision-row-title"><strong>{name}</strong><span className="ke-decision-status-chip" data-tone={currentStatus.tone}>{currentStatus.label}</span></span>
        {!decision.current ? <small>{organizer ? 'Resolve membership change' : 'The organizer needs to resolve a membership change.'}</small> : currentStatus.detail && <small>{currentStatus.detail}</small>}</span>
      <PageIcon name="ChevronRight" />
    </button>
    {organizer && <div className="ke-decision-menu-wrap" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); trigger.current?.focus(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}>
      <RenameAction name={name} save={onRename} renderTrigger={rename => <>
        <button ref={trigger} type="button" className="ke-group-menu-trigger" disabled={busy}
          aria-label={`Actions for ${name}`} aria-expanded={menuOpen} aria-controls={`decision-actions-${decision.id}`}
          onClick={() => setMenuOpen(current => !current)}><PageIcon name="Ellipsis" /></button>
        <div id={`decision-actions-${decision.id}`} className="ke-decision-actions-menu" hidden={!menuOpen}>
          <button type="button" disabled={busy} onClick={() => { setMenuOpen(false); rename(); }}><PageIcon name="Pencil" />Rename</button>
          <button type="button" className="ke-decision-menu-delete" disabled={busy} onClick={() => { setMenuOpen(false); onDelete(); }}><PageIcon name="X" />Delete decision</button>
        </div>
      </>} />
    </div>}
  </article>;
}
export function GroupDecisions({ group, api, reload, openDecision, onDirtyChange }: { group: Groups.GroupSnapshot;
  api: (path: string, init?: RequestInit) => Promise<Response>; reload: () => Promise<void>; openDecision: (id: string) => void; startCollapsed?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [listStatuses, setListStatuses] = useState<Record<string, DecisionListStatus>>({});
  const statusApi = useRef(api); statusApi.current = api;
  useEffect(() => {
    const controller = new AbortController();
    let active = true, index = 0;
    const decisions = group.decisions.filter(decision => decision.current);
    setListStatuses({});
    async function worker() {
      while (active && index < decisions.length) {
        const decision = decisions[index++]!;
        try {
          // Project immediately; private answers never enter list state or browser storage.
          const response = await statusApi.current(`/decisions/${decision.id}/me`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
          if (!response.ok) throw new Error('Status unavailable');
          const owner = KE.OwnerDecisionSnapshot.parse(await response.json());
          if (owner.publicSnapshot.frame.decisionId !== decision.id) throw new Error('Wrong decision');
          const status = decisionListStatus(owner);
          if (active) setListStatuses(current => ({ ...current, [decision.id]: status }));
        } catch {
          if (active) setListStatuses(current => ({ ...current, [decision.id]: { label: 'Status unavailable', tone: 'muted' } }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, decisions.length) }, () => worker()));
    return () => { active = false; controller.abort(); };
  }, [group]);
  const [showExample, setShowExample] = useState(false);
  const exampleTrigger = useRef<HTMLButtonElement>(null);
  const returnFromExample = () => { setShowExample(false); requestAnimationFrame(() => exampleTrigger.current?.focus()); };
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState<'describe' | 'options'>('describe');
  const [aiWorking, setAiWorking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const wizardBody = useRef<HTMLDivElement>(null);
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpGoal, setHelpGoal] = useState('');
  const [descriptionError, setDescriptionError] = useState('');
  const [exampleToApply, setExampleToApply] = useState<string | null>(null);
  const aiIntent = useRef<'description' | 'options'>((() => {
    try { return sessionStorage.getItem('ke-creation-assist-intent:' + group.id) === 'description' ? 'description' : 'options'; } catch { return 'options'; }
  })());
  const editorKey = 'ke-public-choice-editor:' + group.id;
  const [choicePlan, setChoicePlan] = useState<ChoicePlan | null>(() => {
    try { const cached = JSON.parse(sessionStorage.getItem(editorKey) ?? 'null'); const parsed = ChoicePlan.safeParse(cached?.plan ?? cached); return parsed.success ? parsed.data : null; } catch { return null; }
  });
  const [choiceMode, setChoiceMode] = useState(false), [choiceSaved, setChoiceSaved] = useState(false);
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
  function changeChoices(plan: ChoicePlan) { editorVersion.current++; setChoicePlan(plan); setChoiceSaved(false); setDirty(true); }
  function openChoices() {
    editorVersion.current++;
    if (!choicePlan && draft?.choicePlan) { setChoicePlan(draft.choicePlan); setChoiceDraft(draft); setChoiceSaved(true); }
    else if (!choicePlan) setChoicePlan(emptyChoicePlan(objective));
    setChoiceMode(true); setStep('options'); setStarting(true);
  }
  async function saveChoices() {
    if (choiceConflict) throw new UserFlowError('Choose how to resolve the newer saved draft before saving your edits.');
    if (!choicePlan || !objective.trim()) throw new UserFlowError('Describe the decision first. Your choices are kept.');
    const parsed = ChoicePlan.safeParse(choicePlan);
    if (!parsed.success) throw new UserFlowError('Check the choice names and option lengths. Your draft is kept.');
    let saved: Groups.GroupDraft;
    if (choiceDraft) {
      const compiled = compileChoicePlan(parsed.data);
      const body = { revision: choiceDraft.revision,
        title: parsed.data.title.trim() || objective.trim().split(/\s+/).slice(0,3).join(' '), objective,
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
      setChoiceSaved(false); throw new UserFlowError('The earlier save is recovered. Your newer edits are kept; save them before creating the decision.');
    }
    setChoicePlan(saved.choicePlan ?? parsed.data);
    setChoiceSaved(true); setDirty(false); setNotice('Draft saved.');
    await reload().catch(() => setNotice('Your draft is saved. The group list could not refresh, but you can continue here.')); return saved;
  }
  async function createChoices() {
    if (!choicePlan || choiceConflict || compileChoicePlan(choicePlan).questions.length) return;
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
    setDirty(false); setChoiceMode(false); setChoiceDraft(null); setChoicePlan(null); setDraft(null); setObjective(''); setAiReview(null);
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
  useEffect(() => {
    try {
      if (choicePlan || objective || aiReview || draft) sessionStorage.setItem(editorKey, JSON.stringify({ plan: choicePlan, objective, draft: choiceDraft, suggestion: aiReview, legacyDraft: draft && !draft.choicePlan ? draft : null }));
      else sessionStorage.removeItem(editorKey);
    } catch { /* Keep in-memory work when browser storage is unavailable. */ }
  }, [choicePlan, objective, choiceDraft, aiReview, draft, editorKey]);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!starting) return;
    wizardBody.current?.scrollTo({ top: 0 });
    if (dialog.current?.open) { if (step === 'describe') objectiveInput.current?.focus({ preventScroll: true }); else draftHeading.current?.focus({ preventScroll: true }); }
  }, [starting, step, choiceMode]);
  useEffect(() => {
    const element = dialog.current;
    if (starting && group.isOrganizer) { if (element && !element.open) element.showModal(); if (step === 'describe') objectiveInput.current?.focus(); else draftHeading.current?.focus(); }
    else element?.close();
    if (!starting || !group.isOrganizer) return;
    const prior = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prior; };
  }, [starting, group.isOrganizer]);
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
      reviewSuggestions(Groups.GroupDraft.parse(state.draft)); finishRequest();
      setNotice('Your suggestions are ready. Your current draft is unchanged.'); await reload(); return 'SAVED';
    }
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
  async function request(path: string, body?: unknown, manual = false) {
    const response = await api(`/groups/${group.id}/${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let result: unknown; try { result = await response.json(); } catch { throw new UserFlowError(manual ? 'We could not read the save result. Your choices are kept; retry the same save to check it.' : draftFailureMessage(response.status,null), response.status); }
    if (!response.ok) {
      const reference = result && typeof result === 'object' && 'requestId' in result && typeof result.requestId === 'string'
        && /^[A-Za-z0-9_-]{1,100}$/.test(result.requestId) ? ` Reference: ${result.requestId}.` : '';
      throw new UserFlowError((manual ? response.status === 409 ? 'The group or draft changed. Your edits are kept. Check the latest saved draft before trying again.' : response.status === 403 ? 'Only the current group organizer can save or create this decision.' : response.status >= 500 ? 'The save result is not confirmed. Your choices are kept; retry the same save.' : 'These choices could not be saved. Check the names, options and your session; your edits are kept.' : draftFailureMessage(response.status,result)) + reference, response.status);
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
  async function draftObjective(value: string, followUp?: { draftId: string; revision: number; answers: string[] }, choiceContext?: ChoicePlan) {
    if (!pending.current) { const key = crypto.randomUUID(); pending.current = { objective: value, ...(followUp ? { followUp } : {}), ...(choiceContext ? { choiceContext } : {}), idempotencyKey: key }; saveDraftRequest(group.id,key); setPendingKey(key); }
    if (!pending.current.objective) { await recoverRequest(pending.current.idempotencyKey); return; }
    const startedVersion = editorVersion.current;
    setAiWorking(true);
    try {
      const result = await request('drafts', pending.current);
      const prepared = Groups.GroupDraft.parse(result.draft);
      reviewSuggestions(prepared); finishRequest();
      setNotice(editorVersion.current !== startedVersion ? 'These suggestions use your earlier description. Your newer edits are kept.' : 'Suggestions are ready. Add only what you want to use.');
      await reload().catch(() => {});
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
      setNotice((error instanceof UserFlowError ? error.message : 'We couldn’t prepare suggestions.') + ' You can add choices below without another AI call. The original AI request status is retained.');
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
    setAiReview({ draft: prepared, plan: suggestedChoices(prepared), intent: aiIntent.current,
      description: prepared.choicePlan?.description.trim() || prepared.frame.description.trim() || prepared.frame.objective });
  }
  function askForHelp(intent: 'description' | 'options', value = objective) {
    if (!value.trim() || pendingKey || !requestLookupAvailable || checkingRequest || busyGuard.current) return;
    aiIntent.current = intent;
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
  function updateSuggestions(values: string[]) {
    if (!aiReview || !requestLookupAvailable || pendingKey) return;
    if (aiReview.draft.clarificationQuestions.every((question, index) => guidanceText(savedPublicAnswer(aiReview.draft, question) ?? '') === guidanceText(values[index] ?? ''))) {
      setNotice('Add a little more detail, or edit your options directly.'); return;
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
    setDraft(null); setObjective(''); setChoicePlan(null); setAiReview(null); setDirty(false); setStarting(false);
    sessionStorage.removeItem(editorKey); onDirtyChange?.(false); openDecision(snapshot.frame.decisionId);
  }
  function closeWizard() {
    if (busyGuard.current) return;
    if (dirty && !window.confirm('Close this decision? Your unfinished draft will stay in this browser.')) return;
    dialog.current?.close(); setStarting(false); launcher.current?.focus();
  }
  function keepWizardFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const element = event.currentTarget;
    const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')]
      .filter(control => control.getClientRects().length > 0 && !control.closest('[hidden]') && getComputedStyle(control).visibility !== 'hidden');
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first || !last) { event.preventDefault(); draftHeading.current?.focus(); return; }
    if (!controls.includes(active as HTMLElement) || event.shiftKey && active === first || !event.shiftKey && active === last) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }
  function startWizard() {
    setStep(draft || choicePlan ? 'options' : 'describe');
    if (choicePlan) setChoiceMode(true);
    setStarting(true);
  }
  async function loadDraft(id: string) {
    if (dirty && !window.confirm('Open this saved draft and replace the unsaved edits in this window?')) return;
    const result = await request(`drafts/${id}`), saved = Groups.GroupDraft.parse(result.draft);
    setDraft(saved); setObjective(saved.frame.objective); setStep('options');
    if (saved.choicePlan) { setChoicePlan(saved.choicePlan); setChoiceDraft(saved); setChoiceSaved(true); setChoiceMode(true); }
    else { setChoicePlan(null); setChoiceDraft(null); setChoiceMode(false); setChoiceSaved(false); }
    setChoiceConflict(null); setDirty(false); setRoster(null); setReviewed(false); setStarting(true);
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
    setNotice('The previous request is closed. Your saved draft and any answers in this window are kept. You can continue editing.');
  }
  return <section className="ke-card ke-group-panel ke-decisions-panel" aria-busy={busy} aria-labelledby={`decisions-heading-${group.id}`}>
    <header className="ke-panel-heading"><div><h2 id={`decisions-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span><span>Decisions</span></h2>
      <p className="ke-panel-subtitle">Organize your options, then hear from everyone privately.</p></div>
      {group.isOrganizer && (group.decisions.length > 0 || group.drafts.length > 0 || pendingKey)
        && <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />{draft || pendingKey ? 'Continue your draft' : 'Start a decision'}</button>}</header>
    {!group.decisions.length && !group.drafts.length && !pendingKey && <div className="ke-decision-empty">
      <span className="ke-decision-empty-icon" aria-hidden="true"><PageIcon name="ListChecks" /></span>
      <h3>What will you decide together?</h3><p>Describe a decision and bring your group together.</p>
      {group.isOrganizer ? <button ref={launcher} type="button" className="ke-start-decision ke-icon-action" disabled={busy} onClick={startWizard}><PageIcon name="Plus" />Start a decision</button>
        : <p>Your group organizer can start a decision.</p>}
    </div>}
    <div className="ke-decision-list">{group.decisions.map(decision => <DecisionRow key={decision.id} decision={decision} status={listStatuses[decision.id]} organizer={group.isOrganizer} busy={busy}
      onOpen={() => openDecision(decision.id)}
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
    {group.isOrganizer && <dialog ref={dialog} className="ke-decision-wizard ke-create-decision-dialog ke-creation-v2" aria-labelledby={`decision-wizard-title-${group.id}`}
      aria-describedby={`decision-wizard-subtitle-${group.id}`} onKeyDown={keepWizardFocus} onCancel={event => { event.preventDefault(); closeWizard(); }} onClick={event => { if (event.target === dialog.current) closeWizard(); }}>
      <div className="ke-wizard-shell">
        <header className="ke-wizard-header"><div><span className="ke-wizard-eyebrow">New decision</span>
          <h2 id={`decision-wizard-title-${group.id}`} ref={draftHeading} tabIndex={-1}>{showExample ? 'A decision, step by step' : step === 'describe' ? 'What are we deciding?' : 'Review your options'}</h2>
          <p id={`decision-wizard-subtitle-${group.id}`} className="ke-creation-subtitle">{step === 'describe' ? 'Describe the decision in your own words. Include any options you’re already considering.' : 'Add, remove, or adjust the options your group will consider.'}</p></div>
          <button type="button" className="secondary ke-wizard-close" aria-label="Close new decision" disabled={busy} onClick={closeWizard}><PageIcon name="X" /></button>
        </header>
        <nav className="ke-creation-stepper" aria-label="Decision creation steps">
          <button type="button" disabled={busy && !aiWorking} aria-current={step === 'describe' ? 'step' : undefined} onClick={() => { setShowExample(false); setStep('describe'); }}>1. Describe</button>
          <PageIcon name="ArrowRight" /><button type="button" disabled={!objective.trim() || busy && !aiWorking} aria-current={step === 'options' ? 'step' : undefined} onClick={() => { setShowExample(false); continueToOptions(); }}>2. Options</button>
        </nav>
        <div ref={wizardBody} className="ke-wizard-body" aria-busy={busy && !aiWorking}>
          {showExample && <DecisionGuide onReturn={returnFromExample} />}
          <div className="ke-creation-form" hidden={showExample}>
            {step === 'describe' && <section className="ke-creation-describe" aria-label="Decision description">
              <label htmlFor={`group-objective-${group.id}`}>Describe the decision</label>
              <textarea ref={objectiveInput} id={`group-objective-${group.id}`} rows={6} value={objective} maxLength={2000}
                placeholder="e.g. We’re planning a weekend trip together and need to decide where to go."
                aria-invalid={!!descriptionError} aria-describedby={`description-help-${group.id}${descriptionError ? ` description-error-${group.id}` : ''}`}
                disabled={busy && !aiWorking} onChange={event => changeDescription(event.target.value)} />
              <div className="ke-description-meta"><p id={`description-help-${group.id}`} className="ke-creation-privacy"><PageIcon name="Lock" />Your description and options will be shared with the group. Personal preferences come later.</p>
                <small>{objective.length.toLocaleString()} / 2,000</small></div>
              {descriptionError && <p id={`description-error-${group.id}`} className="ke-creation-error" role="alert">{descriptionError}</p>}
              <div className="ke-creation-inspiration"><span>Need inspiration?</span>{[
                ['Plan a trip', 'We want to plan a weekend trip together. We’re considering the coast, the mountains or a city break, and haven’t picked a date yet.'],
                ['Choose a restaurant', 'Our group is choosing a restaurant for Saturday dinner. We’re considering Cedar Kitchen, Moon Noodles and Garden Table.'],
                ['Compare a purchase', 'We want to buy something together and compare two shortlisted options. We need to decide which one best fits the group.'],
              ].map(([label, example]) => <button type="button" key={label} className="secondary" disabled={busy && !aiWorking} onClick={() => { if (objective.trim()) setExampleToApply(example!); else changeDescription(example!); }}>{label}</button>)}</div>
              {exampleToApply && <div className="ke-example-confirm" role="group" aria-label="Replace description with example"><p>Replace your description with this example? Your options will stay.</p>
                <button type="button" className="secondary" onClick={() => { changeDescription(exampleToApply); setExampleToApply(null); }}>Use this example</button>
                <button type="button" className="ke-text-link" onClick={() => setExampleToApply(null)}>Keep my text</button></div>}
              <button type="button" className="ke-text-link ke-icon-action ke-creation-assist" aria-expanded={helpOpen} disabled={busy} onClick={() => { setHelpGoal(objective); setHelpOpen(value => !value); }}><PageIcon name="Sparkles" />Help me get started</button>
              {helpOpen && <section className="ke-description-assistance" aria-label="Writing assistance"><label>A few words about the decision<input value={helpGoal} maxLength={2000} disabled={busy} placeholder="e.g. Choose a holiday destination" onChange={event => setHelpGoal(event.target.value)} /></label>
                <p className="ke-creation-hint">AI will use this shared text and your current options. Your description stays unchanged until you accept a suggestion.</p>
                <button type="button" className="secondary ke-icon-action" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable || !helpGoal.trim()} onClick={() => askForHelp('description', helpGoal)}><PageIcon name="Sparkles" />Suggest a description</button></section>}
            </section>}
            {step === 'options' && <section className="ke-creation-options" aria-label="Review your options">
              {choiceMode && choicePlan ? <>
                <div className="ke-options-toolbar"><button type="button" className="ke-text-link ke-icon-action" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onClick={() => askForHelp('options')}><PageIcon name="Sparkles" />Suggest options</button>
                  <div className="ke-creation-save-state">{choiceSaved && <small role="status">Draft saved</small>}<button type="button" className="ke-text-link" disabled={busy || choiceSaved || !!choiceConflict} onClick={() => void action(saveChoices)}>Save draft</button></div></div>
                <ChoicePlanEditor plan={choicePlan} onChange={changeChoices} busy={busy && !aiWorking} />
                {(choiceDraft?.aiAssisted || draft?.aiAssisted) && <p className="ke-creation-hint">This draft includes AI suggestions. Check names, dates and availability before creating it.</p>}
                {choiceConflict && <aside className="ke-wizard-save" role="alert"><strong>A newer draft is saved. Your edits are kept here.</strong>
                  <details><summary>Review the latest saved choices</summary><h3>{choiceConflict.frame.title}</h3><p>{choiceConflict.frame.objective}</p><ul>{choiceConflict.frame.variables.map(variable => <li key={variable.id}>{variableText(variable, choiceConflict.frame)}</li>)}</ul></details>
                  {!choiceConflict.createdDecisionId && <button type="button" className="secondary" disabled={busy} onClick={() => { const latest = choiceConflict; if (!latest.choicePlan) return;
                    editorVersion.current++; setChoicePlan(latest.choicePlan); setObjective(latest.frame.objective); setChoiceDraft(latest); setDraft(latest); setChoiceSaved(true); setDirty(false); setChoiceConflict(null); setNotice('The latest saved draft is loaded.'); }}>Use latest saved draft</button>}
                  {!choiceConflict.createdDecisionId && <button type="button" className="secondary" disabled={busy} onClick={() => { editorVersion.current++; setChoiceDraft(choiceConflict); setChoiceConflict(null); setChoiceSaved(false); setDirty(true); setNotice('Your edits are kept. Save them to replace the reviewed saved draft.'); }}>Keep my edits</button>}
                  {choiceConflict.createdDecisionId && <button type="button" disabled={busy} onClick={() => { closeWizard(); openDecision(choiceConflict.createdDecisionId!); }}>Open created decision</button>}
                </aside>}
              </> : draft && <section className="ke-legacy-draft"><p className="ke-creation-hint">This saved draft keeps its original options and shared rules.</p>
                <button type="button" className="ke-text-link ke-icon-action" disabled={busy || !!pendingKey || checkingRequest || !requestLookupAvailable} onClick={() => askForHelp('options')}><PageIcon name="Sparkles" />Suggest options</button>
                <label>Decision name<input value={draft.frame.title} maxLength={160} disabled={busy} onChange={event => changeFrame({ ...draft.frame, title: event.target.value })} /></label>
                {draft.frame.variables.map((variable, index) => <fieldset key={variable.id}><legend>{variable.label}</legend><label>Topic name<input value={variable.label} maxLength={160} disabled={busy} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((value, at) => at === index ? { ...value, label: event.target.value } : value) })} /></label>
                  {(variable.type === 'ENUM' || variable.type === 'ENUM_SET') ? variable.options.map((option, at) => <label key={option.id}>Option {at + 1} for {variable.label}<input value={option.label} maxLength={120} disabled={busy} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, vi) => vi === index && (item.type === 'ENUM' || item.type === 'ENUM_SET') ? { ...item, options: item.options.map((value, oi) => oi === at ? { ...value, label: event.target.value } : value) } : item) })} /></label>) : <p>{publicChoiceValues(variable, draft.frame).join(' · ') || variableText(variable, draft.frame)}</p>}</fieldset>)}
                {!!draft.frame.rules.length && <details><summary>Shared rules</summary><ul>{draft.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, draft.frame.variables)}</li>)}</ul></details>}
                {draft.clarificationQuestions.map((question, index) => <label key={question}>{question}<textarea rows={2} maxLength={500} disabled={busy || !!pendingKey} value={answers[index] ?? ''} onChange={event => { answersByQuestion.current[question] = event.target.value; setAnswers(current => ({ ...current, [index]: event.target.value })); }} /></label>)}
                {!!draft.clarificationQuestions.length && <button type="button" className="secondary" disabled={busy || dirty || !!pendingKey || !requestLookupAvailable || draft.clarificationQuestions.some((_q, i) => !answers[i]?.trim())} onClick={() => { aiIntent.current = 'options'; void action(() => draftObjective(draft.frame.objective, { draftId: draft.id, revision: draft.revision, answers: draft.clarificationQuestions.map((_q, i) => answers[i]!.trim()) })); }}>Update suggestions</button>}
                {dirty && <button type="button" className="ke-text-link" disabled={busy} onClick={() => void action(saveDraft)}>Save draft</button>}
              </section>}
              <p className="ke-creation-privacy"><PageIcon name="Lock" />These options are shared. Everyone adds their own preferences privately after creation.</p>
            </section>}
            {aiWorking && <p className="ke-creation-assist-status" role="status"><PageIcon name="Sparkles" />Preparing suggestions. You can keep editing.</p>}
            {aiReview && ((step === 'describe' && aiReview.intent === 'description') || (step === 'options' && aiReview.intent === 'options')) && <CreationSuggestions key={aiReview.draft.id} review={aiReview} plan={choicePlan ?? emptyChoicePlan(objective)} busy={busy}
              onChange={setAiReview} onAdd={acceptOption} onDismiss={() => setAiReview(null)} onUseDescription={() => { changeDescription(aiReview.description); setAiReview(null); setHelpOpen(false); }}
              onUseLegacyDraft={() => { setDraft(aiReview.draft); setObjective(aiReview.draft.frame.objective); setChoicePlan(null); setChoiceDraft(null); setChoiceMode(false); setAiReview(null); setDirty(false); setStep('options'); requestAnimationFrame(() => draftHeading.current?.focus()); }} onFollowUp={updateSuggestions} />}
            {pendingKey && !aiWorking && <details className="ke-creation-recovery"><summary>Previous suggestions need a check</summary><p>{requestState?.state === 'UNKNOWN' ? 'The result hasn’t been confirmed. Check this request before asking for more suggestions. You can still work on your own options.' : 'Check the earlier request before asking for more suggestions. Your current draft is kept.'}</p>
              <button type="button" className="secondary" disabled={busy || checkingRequest} onClick={() => void action(() => recoverRequest())}>Check progress</button>
              {requestState?.canRelease && <button type="button" className="ke-text-link" disabled={busy} onClick={() => void action(releaseRequest)}>Close unfinished request</button>}
            </details>}
            {!requestLookupAvailable && !checkingRequest && !pendingKey && (helpOpen || step === 'options') && <p className="ke-creation-hint">Suggestions are temporarily unavailable. You can add your own options. <button type="button" className="ke-text-link" disabled={busy} onClick={() => { setCheckingRequest(true); setRecoveryGeneration(value => value + 1); }}>Check again</button></p>}
            {!busy && notice && <div className="ke-wizard-notice" role="status">{notice}</div>}
            <details className="ke-creation-details ke-creation-privacy-details"><summary>Privacy and preview limits</summary><p>Your description and options are shared with your group. AI processes this public draft when you request assistance. Keep personal limits for your private answers later, and use fictional, non-sensitive data in this preview. Suggestions do not verify real-world prices or availability. The preview supports up to six topics, sixteen options per topic and 64 combinations. Creating a decision does not confirm anyone’s preferences or approve a final proposal.</p></details>
            {step === 'describe' && <button ref={exampleTrigger} type="button" className="ke-text-link ke-creation-example-link" onClick={() => setShowExample(true)}>How decisions work</button>}
          </div>
        </div>
        {!showExample && <footer className="ke-creation-footer">
          {step === 'options' && <button type="button" className="secondary" disabled={busy && !aiWorking} onClick={() => setStep('describe')}><PageIcon name="ArrowLeft" />Back</button>}
          {step === 'describe' ? <button type="button" className="ke-icon-action ke-creation-primary" disabled={busy && !aiWorking} onClick={continueToOptions}>Continue<PageIcon name="ArrowRight" /></button>
            : <button type="button" className="ke-icon-action ke-creation-primary" disabled={busy || !!choiceConflict || (choiceMode ? !choicePlan || !!compileChoicePlan(choicePlan).questions.length : !draft || !!draft.clarificationQuestions.length)} onClick={() => void action(choiceMode ? createChoices : createLegacyDraft)}>{busy && !aiWorking ? 'Creating…' : 'Create decision'}<PageIcon name="ArrowRight" /></button>}
        </footer>}
      </div>
    </dialog>}
    {roster && <div className="local-note"><h4>Resolve membership change</h4><p>{roster.frame.objective}</p>
      <p>New participants provide their own answers. A finished decision keeps its recorded outcome and participants. Removing people or changing shared choices still needs the existing review.</p>
      <ul>{roster.participants.map(member => <li key={member.id}>{member.displayName}</li>)}</ul>
      {roster.frame.variables.map(variable => <p key={variable.id}>{variableText(variable, roster.frame)}</p>)}
      <ul>{roster.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, roster.frame.variables)}</li>)}</ul>
      <p>Adding members preserves existing answers and confirmations. New participants supply their own answers. Any new proposal needs explicit approval from everyone included in the decision.</p>
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I have reviewed who remains in this decision after the membership change.</label>
      <button disabled={busy || !reviewed} onClick={() => void action(async () => {
        const result = await request(`decisions/${roster.id}/revise`, { controlVersion: roster.controlVersion, groupVersion: roster.groupVersion });
        const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); setRoster(null); setReviewed(false); await reload(); openDecision(snapshot.frame.decisionId);
      })}>Save membership change</button>
    </div>}
    {!starting && !busy && notice && <p className="ke-wizard-help" role="status">{notice}</p>}
  </section>;
}
