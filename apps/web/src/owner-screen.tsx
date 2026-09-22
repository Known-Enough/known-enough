import { useEffect, useRef, useState } from 'react';
import type { CommandEnvelope, ExceptionOffer, InputValues, Interval, OwnerSnapshot, ProposalView, PublicRoomSnapshot } from '@deal-table/contracts';
import { acceptProposal, browserCommandTransport, confirmInputs, decideDisclosure, decideException, sendCommand, submitInputDraft, UnknownTransportError, withdrawApproval } from './command-client';
import { publicMockClient } from './mock-adapter';
import { ownerMockClient, type OwnerMockScenario } from './owner-mock-adapter';

type LoadState = { kind: 'loading' } | { kind: 'failure' } | { kind: 'loaded'; value: OwnerSnapshot | null; stale: boolean };
const names: Record<string, string> = { maya: 'Maya', leo: 'Leo', nina: 'Nina' };
const time = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
const isScenario = (value: string | null): value is OwnerMockScenario => ['review', 'draft', 'approval', 'empty', 'failure', 'stale'].includes(value ?? '');
const statusLabel = (status: string) => status[0] + status.slice(1).toLowerCase();
export const policyLabel = (policy: 'LOWEST_INCONVENIENCE' | 'BALANCE_RECENT_LOAD') => policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience';
const intervalKey = (interval: Interval) => `${interval.date}:${interval.timezone}:${interval.startMinute}:${interval.endMinute}`;
const intervalsFor = (values: InputValues): Interval[] => values.conditions.flatMap(condition => condition.kind === 'HARD_AVAILABILITY' ? condition.availableIntervals : [condition.interval]);
type AvailabilityTarget = { conditionId: string; interval: Interval };

export function proposalMatchesOwner(room: OwnerSnapshot, proposal: ProposalView | null): proposal is ProposalView {
  if (!proposal || proposal.facts.roomId !== room.roomId || proposal.facts.contextToken !== room.contextToken) return false;
  const receipt = room.ownApproval;
  return !receipt || (receipt.proposalId === proposal.id
    && receipt.proposalVersion === proposal.facts.proposalVersion
    && receipt.planHash === proposal.planHash
    && receipt.contextToken === proposal.facts.contextToken);
}

export function valuesForAvailability(values: InputValues, availability: 'exception' | 'available', target: AvailabilityTarget, interval: Interval, cost: number): InputValues {
  const selected = availability === 'available'
    ? { id: target.conditionId, kind: 'HARD_AVAILABILITY' as const, availableIntervals: [interval] }
    : { id: target.conditionId, kind: 'NEGOTIABLE_UNAVAILABLE' as const, interval, inviteException: true };
  const targetCondition = values.conditions.find(condition => condition.id === target.conditionId);
  if (!targetCondition) return { ...values, dutyCosts: values.dutyCosts.map(item => item.dutyId === 'followup' ? { ...item, cost } : { ...item }) };
  const conditions = targetCondition.kind === 'HARD_AVAILABILITY' && availability === 'exception'
    // A hard availability condition must not be discarded to create an exception request.
    // Keep it intact and add a separately identified negotiable condition for the selected interval.
    ? [...values.conditions.map(item => item.kind === 'HARD_AVAILABILITY' ? { ...item, availableIntervals: item.availableIntervals.map(value => ({ ...value })) } : { ...item, interval: { ...item.interval } }), { ...selected, id: `${target.conditionId}-exception` }]
    : values.conditions.map(item => {
      if (item.id !== target.conditionId) return item.kind === 'HARD_AVAILABILITY' ? { ...item, availableIntervals: item.availableIntervals.map(value => ({ ...value })) } : { ...item, interval: { ...item.interval } };
      if (item.kind === 'HARD_AVAILABILITY') return { ...item, availableIntervals: item.availableIntervals.map(value => intervalKey(value) === intervalKey(target.interval) ? interval : { ...value }) };
      return selected;
    });
  return {
    ...values,
    conditions,
    dutyCosts: values.dutyCosts.map(item => item.dutyId === 'followup' ? { ...item, cost } : { ...item }),
  };
}

export function exceptionScopeSummary(scope: ExceptionOffer['scope']): string {
  return `Scope: roster ${scope.rosterMemberIds.map(id => names[id] ?? id).join(', ')}, policy ${policyLabel(scope.policy)}, decision revision ${scope.decisionRevision}, exact dated interval, and expiry ${scope.expiresAt}.`;
}

export function OwnerScreen({ initialScenario }: { initialScenario: string | null }) {
  const initial = isScenario(initialScenario) ? initialScenario : 'review';
  const [scenario, setScenario] = useState<OwnerMockScenario>(initial);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [availability, setAvailability] = useState<'exception' | 'available'>('exception');
  const [cost, setCost] = useState('0');
  const [duration, setDuration] = useState('30');
  const [reviewedIntervals, setReviewedIntervals] = useState<string[]>([]);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [publicRoom, setPublicRoom] = useState<PublicRoomSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryCommand, setRetryCommand] = useState<CommandEnvelope | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const load = (refresh = false, nextScenario = scenario) => {
    const id = ++request.current;
    setState({ kind: 'loading' });
    void Promise.all([ownerMockClient.readOwnerRoom(nextScenario, { refresh }), publicMockClient.readPublicRoom('proposed', { refresh })]).then(([owner, publicSnapshot]) => {
      if (id === request.current) {
        setState({ kind: 'loaded', value: owner.value, stale: owner.freshness === 'stale' });
        setPublicRoom(publicSnapshot.value);
        const values = owner.value?.draft?.values ?? owner.value?.confirmedInputs?.values;
        const first = values?.conditions[0];
        const initialInterval = first?.kind === 'HARD_AVAILABILITY' ? first.availableIntervals[0] : first?.interval;
        setAvailability(first?.kind === 'NEGOTIABLE_UNAVAILABLE' ? 'exception' : 'available');
        setCost(String(values?.dutyCosts.find(item => item.dutyId === 'followup')?.cost ?? 0));
        if (initialInterval) setDuration(String(initialInterval.endMinute - initialInterval.startMinute));
        setReviewedIntervals([]);
        setHasUnsavedEdits(false);
      }
    }).catch(() => { if (id === request.current) setState({ kind: 'failure' }); });
  };
  useEffect(() => { load(); return () => { request.current += 1; }; }, [initial]);
  const room = state.kind === 'loaded' ? state.value : null;
  const stale = state.kind === 'loaded' && state.stale;
  const disabled = stale || !room || pending;
  const inputValues = room?.draft?.values ?? room?.confirmedInputs?.values ?? null;
  // The explicitly editable condition is a negotiable condition when one exists;
  // hard availability conditions are retained rather than being used as a disposable slot.
  const condition = inputValues?.conditions.find(item => item.kind === 'NEGOTIABLE_UNAVAILABLE') ?? inputValues?.conditions[0];
  const interval = condition?.kind === 'HARD_AVAILABILITY' ? condition.availableIntervals[0] : condition?.interval;
  const run = async (command: CommandEnvelope) => {
    setPending(true); setNotice(null); setRetryCommand(null);
    try {
      const result = await sendCommand(browserCommandTransport(), command);
      if (result.ok) setNotice('Command accepted by the transport. Refresh the private snapshot to see any server-authorized change.');
      else if (result.error.code === 'STALE_CONTEXT' || result.error.code === 'STALE_PROPOSAL') {
        setNotice('This command is stale. The snapshot was refreshed; review the current terms and explicitly submit a new command if you still agree.');
        load(true);
      } else setNotice(`The command was not applied (${result.error.code}).`);
    } catch (error) {
      if (error instanceof UnknownTransportError) { setRetryCommand(error.command); setNotice('The transport outcome is unknown. You may retry this exact unchanged request.'); }
      else setNotice('The command could not be prepared or sent.');
    } finally { setPending(false); }
  };
  const selectedInterval = interval && { ...interval, endMinute: interval.startMinute + Number(duration) };
  const values = (): InputValues | null => inputValues && condition && interval && selectedInterval ? valuesForAvailability(inputValues, availability, { conditionId: condition.id, interval }, selectedInterval, Number(cost)) : null;
  const draftIntervals = room?.draft ? intervalsFor(room.draft.values) : [];
  const candidateProposal = publicRoom?.proposal ?? null;
  const currentProposal = room && proposalMatchesOwner(room, candidateProposal) ? candidateProposal : null;
  // Owner DTOs intentionally exclude public decision revisions; A02 injects the synthetic public context.
  const context = { decisionRevision: 1 };
  return <main className="owner-page">
    <header className="masthead"><div><p className="eyebrow">TEAMTABLE · PRIVATE DEMO</p><h1>Private owner screen · local demo</h1></div><div className="header-actions"><span className="badge">Fictional private example</span><a className="quiet-link" href="?public=collecting">Return to shared table</a></div></header>
    <p className="notice">This is a fixed, synthetic owner example for Nina. It is not an account, does not authenticate a person, and never changes a real permission or shared result.</p>
    {state.kind === 'loading' && <p role="status" className="state-card">Loading private local example…</p>}
    {state.kind === 'failure' && <section role="alert" className="state-card failure"><h2>Private example unavailable</h2><p>The local fixture did not load. Retry uses the default successful owner example.</p><button type="button" onClick={() => { setScenario('review'); load(false, 'review'); }}>Retry private example</button></section>}
    {stale && <section role="alert" className="stale-banner"><strong>This private local snapshot is stale.</strong><span>Commands are disabled until it is refreshed.</span><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {state.kind === 'loaded' && !room && <section role="status" className="state-card"><h2>No private example selected</h2><p>This local scenario has no owner snapshot.</p><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {room && <div className="owner-grid">
      <section className="owner-card" aria-labelledby="inputs"><p className="eyebrow">OWNER REVISION {room.ownerRevision}</p><h2 id="inputs">Your inputs</h2><p>Keep reasons private. Record a condition or preference without explaining why.</p><fieldset disabled={disabled}><legend>Meeting availability</legend><label><input type="radio" name="availability" checked={availability === 'exception'} onChange={() => { setAvailability('exception'); setReviewedIntervals([]); setHasUnsavedEdits(true); }} /> {selectedInterval ? `${selectedInterval.date} · ${time(selectedInterval.startMinute)}–${time(selectedInterval.endMinute)} · ${selectedInterval.timezone} is unavailable, but you may ask about a scoped exception.` : 'A scoped availability question is available.'}</label><label><input type="radio" name="availability" checked={availability === 'available'} onChange={() => { setAvailability('available'); setReviewedIntervals([]); setHasUnsavedEdits(true); }} /> {selectedInterval ? `${selectedInterval.date} · ${time(selectedInterval.startMinute)}–${time(selectedInterval.endMinute)} · ${selectedInterval.timezone} is available.` : 'This exact interval is available.'}</label><label>Meeting duration <select value={duration} onChange={event => { setDuration(event.target.value); setReviewedIntervals([]); setHasUnsavedEdits(true); }}><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label><label>Follow-up duty cost <select value={cost} onChange={event => { setCost(event.target.value); setReviewedIntervals([]); setHasUnsavedEdits(true); }}><option value="0">0 — no added inconvenience</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><button type="button" onClick={() => { const next = values(); if (next) void run(submitInputDraft(room, context, next)); }}>Submit input draft</button></fieldset><p className="timezone">Submitting creates a versioned private draft; it does not grant an exception, authorize disclosure, or accept a plan.</p></section>
      {room.draft && <section className="owner-card" aria-labelledby="confirm-inputs"><p className="eyebrow">DRAFT REVIEW</p><h2 id="confirm-inputs">Confirm reviewed inputs</h2><p>Review the exact dated intervals in draft {room.draft.draftId}, revision {room.draft.draftRevision}. {hasUnsavedEdits ? 'Your edited draft has not been returned as a current private snapshot, so it cannot be confirmed yet.' : 'Changing any input requires a fresh current draft review.'}</p>{draftIntervals.map(value => <label key={intervalKey(value)}><input type="checkbox" disabled={hasUnsavedEdits} checked={reviewedIntervals.includes(intervalKey(value))} onChange={event => setReviewedIntervals(current => event.target.checked ? [...current, intervalKey(value)] : current.filter(key => key !== intervalKey(value)))} /> I reviewed {value.date} · {time(value.startMinute)}–{time(value.endMinute)} · {value.timezone}.</label>)}<div className="button-row"><button type="button" disabled={disabled || hasUnsavedEdits || reviewedIntervals.length !== draftIntervals.length} onClick={() => void run(confirmInputs(room, context, room.draft!, draftIntervals.filter(value => reviewedIntervals.includes(intervalKey(value))))) }>Confirm these reviewed intervals</button></div></section>}
      <section className="owner-card" aria-labelledby="exception"><p className="eyebrow">CHANGE PERMISSION</p><h2 id="exception">Exception</h2>{room.pendingOffers.map(offer => <div key={offer.id} className="scope"><p>Would {offer.scope.meeting.interval.date} at {time(offer.scope.meeting.interval.startMinute)}–{time(offer.scope.meeting.interval.endMinute)} ({offer.scope.meeting.interval.timezone}) work only if you take neither weekend duty in this plan?</p><p>{exceptionScopeSummary(offer.scope)}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => void run(decideException(room, context, offer, 'ALLOW'))}>Allow scoped exception</button><button type="button" className="secondary" disabled={disabled} onClick={() => void run(decideException(room, context, offer, 'DECLINE'))}>Decline exception</button></div></div>)}</section>
      <section className="owner-card" aria-labelledby="disclosure"><p className="eyebrow">DISCLOSURE PERMISSION</p><h2 id="disclosure">Disclosure</h2>{room.disclosurePreviews.map(preview => <div key={preview.id} className="scope"><p>May the shared table say:</p><blockquote>{preview.text}</blockquote><p>Audience: {preview.audienceMemberIds.map(id => names[id] ?? id).join(', ')}. Decision revision {preview.decisionRevision}; expires {preview.expiresAt}. {preview.inferenceWarning}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => void run(decideDisclosure(room, context, preview, 'ALLOW'))}>Allow this wording</button><button type="button" className="secondary" disabled={disabled} onClick={() => void run(decideDisclosure(room, context, preview, 'DECLINE'))}>Use exception without announcement</button></div></div>)}</section>
      <section className="owner-card" aria-labelledby="approval"><p className="eyebrow">FINAL ACCEPTANCE</p><h2 id="approval">Final plan acceptance</h2><p>Final acceptance is separate from both choices above. Review the current public proposal before accepting.</p>{currentProposal ? <><p>Proposal {currentProposal.id}, version {currentProposal.facts.proposalVersion}; {currentProposal.policyLabel}; valid until {currentProposal.validUntil}.</p><p>Meeting: {currentProposal.facts.plan.meeting.interval.date} · {time(currentProposal.facts.plan.meeting.interval.startMinute)}–{time(currentProposal.facts.plan.meeting.interval.endMinute)} · {currentProposal.facts.plan.meeting.interval.timezone}.</p><ul>{currentProposal.facts.plan.assignments.map(assignment => <li key={assignment.duty.id}>{assignment.duty.label}: {names[assignment.participantId] ?? assignment.participantId}, {assignment.duty.interval.date} {time(assignment.duty.interval.startMinute)}–{time(assignment.duty.interval.endMinute)}.</li>)}</ul><p>Plan hash: {currentProposal.planHash}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => void run(acceptProposal(room, context, currentProposal))}>Accept reviewed current proposal</button>{room.ownApproval && <button type="button" className="secondary" disabled={disabled} onClick={() => void run(withdrawApproval(room, context, room.ownApproval!))}>Withdraw recorded approval</button>}</div></> : <><p>No matching current proposal is available. A receipt is history only and cannot enable acceptance.</p><button type="button" disabled>Await an exact shared proposal</button>{room.ownApproval && <button type="button" className="secondary" disabled={disabled} onClick={() => void run(withdrawApproval(room, context, room.ownApproval!))}>Withdraw recorded approval</button>}</>}</section>
      <section className="owner-card receipts" aria-labelledby="receipts"><p className="eyebrow">PRIVATE HISTORY</p><h2 id="receipts">Your private receipts</h2><p>Only this private owner example can see these permission records. They do not publish a reason, grant access to another person, or change the shared table by themselves.</p><div className="receipt-grid">
        <article className="receipt" aria-label="Exception receipt"><p className="receipt-title">Exception permission</p>{room.exceptionGrants.length ? room.exceptionGrants.map(grant => <p key={grant.id} className="receipt-status"><span className={`status-pill status-${grant.status.toLowerCase()}`}>{statusLabel(grant.status)}</span><span>Version {grant.version} · expires {grant.scope.expiresAt}</span></p>) : <p className="receipt-empty">No exception receipt recorded.</p>}</article>
        <article className="receipt" aria-label="Disclosure receipt"><p className="receipt-title">Disclosure permission</p>{room.disclosureGrants.length ? room.disclosureGrants.map(grant => <div key={grant.id}><p className="receipt-status"><span className={`status-pill status-${grant.status.toLowerCase()}`}>{statusLabel(grant.status)}</span><span>Version {grant.version}{grant.publishedAt ? ` · published ${grant.publishedAt}` : ' · not published'}</span></p><blockquote>{grant.preview.text}</blockquote></div>) : <p className="receipt-empty">No disclosure receipt recorded.</p>}</article>
        <article className="receipt" aria-label="Final approval receipt"><p className="receipt-title">Final plan approval</p>{room.ownApproval ? <p className="receipt-status"><span className="status-pill status-active">Recorded</span><span>Proposal {room.ownApproval.proposalId} · version {room.ownApproval.proposalVersion}</span></p> : <p className="receipt-empty">No final approval receipt recorded.</p>}</article>
      </div></section>
      {notice && <section role="status" className="local-note"><p>{notice}</p>{retryCommand && <button type="button" onClick={() => void run(retryCommand)}>Retry unchanged request</button>}</section>}
    </div>}
    <footer>Private local demo · fictional data · no cloud services deployed</footer>
  </main>;
}
