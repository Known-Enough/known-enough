import { useEffect, useRef, useState } from 'react';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { ruleText, variableText } from './connected-decision';
class UserFlowError extends Error {}
export function GroupDecisions({ group, api, reload, openDecision }: { group: Groups.GroupSnapshot;
  api: (path: string, init?: RequestInit) => Promise<Response>; reload: () => Promise<void>; openDecision: (id: string) => void }) {
  const [objective, setObjective] = useState(''); const [draft, setDraft] = useState<Groups.GroupDraft | null>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { draftHeading.current?.focus(); }, [draft?.id, draft?.revision]);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const pending = useRef<{ objective: string; idempotencyKey: string } | null>(null);
  const [roster, setRoster] = useState<{ id: string; frame: KE.PublicDecisionFrame; controlVersion: number; groupVersion: number;
    participants: { id: string; displayName: string }[] } | null>(null);
  async function request(path: string, body?: unknown) {
    const response = await api(`/groups/${group.id}/${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new UserFlowError(response.status === 409 ? 'The group or draft changed. Refresh and review the current terms.'
      : response.status === 422 ? 'This draft needs supported public choices or clarification before it can continue.'
      : 'This action is unavailable. Check your account and organizer access.');
    return response.json() as Promise<Record<string, unknown>>;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await work(); } catch (error) { setNotice(error instanceof UserFlowError ? error.message : 'The result is unknown. Refresh before retrying.'); }
    finally { setBusy(false); }
  }
  function changeFrame(frame: KE.PublicDecisionFrame) {
    if (draft) setDraft({ ...draft, frame }); setReviewed(false); setDirty(true);
  }
  return <section aria-busy={busy}><h4>Decisions for {group.name}</h4>
    {group.decisions.map(decision => <div key={decision.id}>{decision.current
      ? <button disabled={busy} onClick={() => openDecision(decision.id)}>Open decision</button>
      : <><p>Membership changed. This decision is paused so old confirmations cannot apply to a new group.</p>
        {group.isOrganizer && <button disabled={busy} onClick={() => void action(async () => {
          const result = await request(`decisions/${decision.id}/review`);
          setDraft(null); setDirty(false); setRoster({ id: decision.id, frame: KE.PublicDecisionFrame.parse(result.frame), controlVersion: result.controlVersion as number,
            groupVersion: result.groupVersion as number, participants: result.participants as { id: string; displayName: string }[] }); setReviewed(false);
        })}>Review changed roster</button>}</>}
    </div>)}
    {group.isOrganizer && <>
      <label htmlFor={`group-objective-${group.id}`}>What should this group decide?</label>
      <textarea id={`group-objective-${group.id}`} value={objective} maxLength={2000} disabled={busy || !!pending.current}
        onChange={event => { setObjective(event.target.value); setReviewed(false); }} />
      <p>This objective is shared. Describe the public choices; add your private limits later in your own conversation.</p>
      <button disabled={busy || !objective.trim()} onClick={() => void action(async () => {
        pending.current ??= { objective, idempotencyKey: crypto.randomUUID() };
        const result = await request('drafts', pending.current); setDraft(Groups.GroupDraft.parse(result.draft)); setDirty(false); setRoster(null);
        pending.current = null; setReviewed(false); await reload();
      })}>{pending.current ? 'Retry the same draft request' : 'Draft a new decision'}</button>
      {pending.current && !busy && <button className="secondary" onClick={() => { pending.current = null; setNotice('Refresh saved drafts before starting a different request.'); }}>Release this draft request for editing</button>}
      {group.drafts.map(item => <p key={item.id}>{item.current ? <button disabled={busy} onClick={() => void action(async () => {
        const result = await request(`drafts/${item.id}`); setDraft(Groups.GroupDraft.parse(result.draft)); setDirty(false); setRoster(null); setReviewed(false);
      })}>{item.created ? 'Open or retry decision' : 'Review draft'}: {item.title}</button> : 'An earlier draft needs a new request because group membership changed.'}</p>)}
    </>}
    {draft && <div className="local-note"><h4 tabIndex={-1} ref={draftHeading}>Review the public draft</h4>
      <label htmlFor={`draft-title-${group.id}`}>Decision title</label><input id={`draft-title-${group.id}`} value={draft.frame.title} maxLength={160} disabled={busy || !!draft.createdDecisionId} onChange={event => changeFrame({ ...draft.frame, title: event.target.value })} />
      <p>{draft.frame.objective}</p><p>{draft.frame.description}</p>
      <h5>Everyone required to approve</h5><ul>{draft.frame.participants.map(member => <li key={member.id}>{member.displayName}</li>)}</ul>
      <h5>Public choices and limits</h5>{draft.frame.variables.map((variable, index) => <div key={variable.id}>
        <p>{variableText(variable, draft.frame)}</p>
        <label htmlFor={`draft-label-${group.id}-${index}`}>Choice name {index + 1}</label><input id={`draft-label-${group.id}-${index}`} value={variable.label} disabled={busy || !!draft.createdDecisionId} maxLength={160} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })} />
        {(variable.type === 'ENUM' || variable.type === 'ENUM_SET') && variable.options.map((option, at) => <label key={option.id}>Option {at + 1} for {variable.label}
          <input value={option.label} maxLength={120} disabled={busy || !!draft.createdDecisionId} onChange={event => changeFrame({ ...draft.frame, variables: draft.frame.variables.map((item, vi) => vi === index && (item.type === 'ENUM' || item.type === 'ENUM_SET') ? { ...item, options: item.options.map((value, oi) => oi === at ? { ...value, label: event.target.value } : value) } : item) })} /></label>)}
      </div>)}
      <h5>Shared rules</h5><ul>{draft.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, draft.frame.variables)}</li>)}</ul>
      {!draft.frame.rules.length && <p>No extra shared rules. Your private confirmed needs still apply.</p>}
      {draft.clarificationQuestions.map((question, index) => <p key={index} role="status">{question}</p>)}
      <p>For different public terms, describe them above and request a new draft. Unsupported or unbounded choices need clarification.</p>
      {!draft.createdDecisionId && <button disabled={busy} onClick={() => void action(async () => {
        const result = await request(`drafts/${draft.id}`, { revision: draft.revision, title: draft.frame.title, objective: draft.frame.objective, variables: draft.frame.variables, rules: draft.frame.rules });
        setDraft(Groups.GroupDraft.parse(result.draft)); setDirty(false); setRoster(null); setReviewed(false); await reload();
      })}>Save draft edits</button>}
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this public draft and the required approvers</label>
      {dirty && <p>Save these edits before creating the decision.</p>}
      <p>Creating starts frame review for every group member. It does not confirm anyone's needs or approve an outcome.</p>
      <button disabled={busy || !reviewed || dirty || draft.clarificationQuestions.length > 0} onClick={() => void action(async () => {
        const result = await request(`drafts/${draft.id}/create`, { revision: draft.revision });
        const snapshot = KE.PublicDecisionSnapshot.parse(result.snapshot); await reload(); setDraft(null); openDecision(snapshot.frame.decisionId);
      })}>{draft.createdDecisionId ? 'Open or retry this decision' : 'Create decision for group review'}</button>
    </div>}
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
    {(busy || notice) && <p role="status">{busy ? 'Preparing or saving your decision…' : notice}</p>}
  </section>;
}
