import { useEffect, useRef, useState } from 'react';
import type { CommandEnvelope, ExceptionOffer, InputValues, Interval, OwnerSnapshot, ProposalView, PublicRoomSnapshot } from '@deal-table/contracts';
import { acceptContext, acceptProposal, browserCommandTransport, commandTransport, confirmInputs, decideDisclosure, decideException, requestSolve, sendCommand, submitInputDraft, UnknownTransportError, withdrawApproval } from './command-client';
import { publicMockClient } from './mock-adapter';
import { ownerMockClient, type OwnerMockScenario } from './owner-mock-adapter';
import { LocalApiClient, type LocalIdentity } from './local-api-client';

type LoadState = { kind: 'loading' } | { kind: 'failure' } | { kind: 'loaded'; value: OwnerSnapshot | null; stale: boolean };
const names: Record<string, string> = { maya: 'Maya', leo: 'Leo', nina: 'Nina' };
const time = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
const isScenario = (value: string | null): value is OwnerMockScenario => ['review', 'draft', 'hard-first-draft', 'approval', 'empty', 'failure', 'stale'].includes(value ?? '');
const statusLabel = (status: string) => status[0] + status.slice(1).toLowerCase();
export const policyLabel = (policy: 'LOWEST_INCONVENIENCE' | 'BALANCE_RECENT_LOAD') => policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience';
const intervalKey = (interval: Interval) => `${interval.date}:${interval.timezone}:${interval.startMinute}:${interval.endMinute}`;
const intervalsFor = (values: InputValues): Interval[] => {
  const seen = new Set<string>();
  return values.conditions.flatMap(condition => condition.kind === 'HARD_AVAILABILITY' ? condition.availableIntervals : [condition.interval])
    .filter(interval => !seen.has(intervalKey(interval)) && (seen.add(intervalKey(interval)), true));
};
export function reviewIntervalsFor(values: InputValues, publicRoom: PublicRoomSnapshot): Interval[] {
  const seen = new Set<string>();
  return [...intervalsFor(values), ...publicRoom.schedule.slots.map(slot => slot.interval), ...publicRoom.schedule.duties.map(duty => duty.interval)]
    .filter(interval => !seen.has(intervalKey(interval)) && (seen.add(intervalKey(interval)), true));
}
type AvailabilityTarget = { conditionId: string; interval: Interval };

export function editableAvailabilityFor(values: InputValues): AvailabilityTarget & { availability: 'exception' | 'available' } | null {
  const condition = values.conditions.find(item => item.kind === 'NEGOTIABLE_UNAVAILABLE') ?? values.conditions[0];
  if (!condition) return null;
  return condition.kind === 'HARD_AVAILABILITY'
    ? { conditionId: condition.id, interval: condition.availableIntervals[0]!, availability: 'available' }
    : { conditionId: condition.id, interval: condition.interval, availability: 'exception' };
}

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

function initialValues(room: OwnerSnapshot, publicRoom: PublicRoomSnapshot, availability: 'exception' | 'available', target: AvailabilityTarget, cost: number): InputValues {
  // A local participant must explicitly choose this broad synthetic coverage in
  // the browser; it is never derived from a private server fixture.
  // Keep the fictional local roster aligned with the solver fixture: Maya can
  // use 11:00/14:00, Leo can use 10:00/11:00, and Nina can use all slots but
  // marks 11:00 as negotiably unavailable. This leaves 11:00 as the only
  // shared meeting that requires Nina's scoped exception.
  const meetingCoverage = room.ownerMemberId === 'maya'
    ? publicRoom.schedule.slots.slice(1)
    : room.ownerMemberId === 'leo'
      ? publicRoom.schedule.slots.slice(0, 2)
      : publicRoom.schedule.slots;
  const coverage = [...meetingCoverage.map(slot => slot.interval), ...publicRoom.schedule.duties.map(duty => duty.interval)]
    .map(interval => ({ ...interval }));
  const conditions: InputValues['conditions'] = [{ id: `${room.ownerMemberId}-local-coverage`, kind: 'HARD_AVAILABILITY', availableIntervals: coverage }];
  if (availability === 'exception') conditions.push({ id: `${room.ownerMemberId}-local-exception`, kind: 'NEGOTIABLE_UNAVAILABLE', interval: { ...target.interval }, inviteException: true });
  return { conditions, dutyCosts: publicRoom.schedule.duties.map(duty => ({ dutyId: duty.id, cost: duty.id === 'followup' ? cost : 0 })) };
}

export function exceptionScopeSummary(scope: ExceptionOffer['scope']): string {
  return `Scope: roster ${scope.rosterMemberIds.map(id => names[id] ?? id).join(', ')}, policy ${policyLabel(scope.policy)}, decision revision ${scope.decisionRevision}, exact dated interval, and expiry ${scope.expiresAt}.`;
}

export function OwnerScreen({ initialScenario, localIdentity = null }: { initialScenario: string | null; localIdentity?: Exclude<LocalIdentity, 'display'> | null }) {
  const initial = isScenario(initialScenario) ? initialScenario : 'review';
  const [scenario, setScenario] = useState<OwnerMockScenario>(initial);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [availability, setAvailability] = useState<'exception' | 'available'>('exception');
  const [cost, setCost] = useState('0');
  const [duration, setDuration] = useState('30');
  const [reviewedIntervals, setReviewedIntervals] = useState<string[]>([]);
  const [draftReviewInvalidated, setDraftReviewInvalidated] = useState(false);
  const [publicRoom, setPublicRoom] = useState<PublicRoomSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryCommand, setRetryCommand] = useState<CommandEnvelope | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const localClient = localIdentity ? new LocalApiClient(localIdentity) : null;
  const load = (refresh = false, nextScenario = scenario) => {
    const id = ++request.current;
    setState({ kind: 'loading' });
    const reads = localClient
      ? Promise.all([localClient.ownerRoom().then(value => ({ value, freshness: 'fresh' as const })), localClient.publicRoom().then(value => ({ value, freshness: 'fresh' as const }))])
      : Promise.all([ownerMockClient.readOwnerRoom(nextScenario, { refresh }), publicMockClient.readPublicRoom('proposed', { refresh })]);
    void reads.then(([owner, publicSnapshot]) => {
      if (id === request.current) {
        setState({ kind: 'loaded', value: owner.value, stale: owner.freshness === 'stale' });
        setPublicRoom(publicSnapshot.value);
        const values = owner.value?.draft?.values ?? owner.value?.confirmedInputs?.values;
        const target = values ? editableAvailabilityFor(values) : null;
        setAvailability(target?.availability ?? 'exception');
        setCost(String(values?.dutyCosts.find(item => item.dutyId === 'followup')?.cost ?? 0));
        if (target) setDuration(String(target.interval.endMinute - target.interval.startMinute));
        setReviewedIntervals([]);
        setDraftReviewInvalidated(false);
      }
    }).catch(() => { if (id === request.current) setState({ kind: 'failure' }); });
  };
  useEffect(() => { load(); return () => { request.current += 1; }; }, [initial, localIdentity]);
  const room = state.kind === 'loaded' ? state.value : null;
  const stale = state.kind === 'loaded' && state.stale;
  const currentContext = room && publicRoom && room.roomId === publicRoom.roomId && room.contextToken === publicRoom.contextToken
    ? { decisionRevision: publicRoom.decisionRevision }
    : null;
  const disabled = stale || !room || pending || !currentContext;
  const inputValues = room?.draft?.values ?? room?.confirmedInputs?.values ?? null;
  // The same explicit target drives initialization, display and serialization.
  const initialTarget = room && publicRoom ? { conditionId: `${room.ownerMemberId}-local-exception`, interval: publicRoom.schedule.slots[1]!.interval } : null;
  const availabilityTarget = inputValues ? editableAvailabilityFor(inputValues) : initialTarget && { ...initialTarget, availability: 'exception' as const };
  const run = async (command: CommandEnvelope) => {
    setPending(true); setNotice(null); setRetryCommand(null);
    try {
      const result = await sendCommand(localClient ? commandTransport((path, body) => localClient.command(body)) : browserCommandTransport(), command);
      if (result.ok) {
        setNotice(localClient ? 'Command applied by the loopback local API. The current private and public snapshots were refreshed.' : 'Command accepted by the transport. Refresh the private snapshot to see any server-authorized change.');
        if (localClient) load(true);
      }
      else if (result.error.code === 'STALE_CONTEXT' || result.error.code === 'STALE_PROPOSAL') {
        setNotice('This command is stale. The snapshot was refreshed; review the current terms and explicitly submit a new command if you still agree.');
        load(true);
      } else setNotice(`The command was not applied (${result.error.code}).`);
    } catch (error) {
      if (error instanceof UnknownTransportError) { setRetryCommand(error.command); setNotice('The transport outcome is unknown. You may retry this exact unchanged request.'); }
      else setNotice('The command could not be prepared or sent.');
    } finally { setPending(false); }
  };
  const runCurrent = (build: (current: NonNullable<typeof context>) => CommandEnvelope) => {
    if (context) void run(build(context));
  };
  const selectedInterval = availabilityTarget && { ...availabilityTarget.interval, endMinute: availabilityTarget.interval.startMinute + Number(duration) };
  const values = (): InputValues | null => {
    if (!room || !publicRoom || !availabilityTarget || !selectedInterval) return null;
    return inputValues
      ? valuesForAvailability(inputValues, availability, availabilityTarget, selectedInterval, Number(cost))
      : initialValues(room, publicRoom, availability, { conditionId: availabilityTarget.conditionId, interval: selectedInterval }, Number(cost));
  };
  const draftIntervals = room?.draft
    ? localIdentity && publicRoom ? reviewIntervalsFor(room.draft.values, publicRoom) : intervalsFor(room.draft.values)
    : [];
  const candidateProposal = publicRoom?.proposal ?? null;
  const currentProposal = room && proposalMatchesOwner(room, candidateProposal) ? candidateProposal : null;
  // Owner DTOs intentionally exclude decision revisions. Commands bind the
  // revision from the concurrently refreshed public allowlist snapshot.
  const context = currentContext;
  return <main className="owner-page">
    <header className="masthead"><div><p className="eyebrow">TEAMTABLE · PRIVATE DEMO</p><h1>Private owner screen · local demo</h1></div><div className="header-actions"><span className="badge">{localIdentity ? `NON_PRODUCTION ${localIdentity}` : 'Fictional private example'}</span><a className="quiet-link" href={localIdentity ? '?local=display' : '?public=collecting'}>Return to shared table</a></div></header>
    <p className="notice">{localIdentity ? `This browser uses the fixed loopback label NON_PRODUCTION ${localIdentity}. It is explicit local test identity only, not production authentication.` : 'This is a fixed, synthetic owner example for Nina. It is not an account, does not authenticate a person, and never changes a real permission or shared result.'}</p>
    {state.kind === 'loading' && <p role="status" className="state-card">Loading private local example…</p>}
    {state.kind === 'failure' && <section role="alert" className="state-card failure"><h2>Private example unavailable</h2><p>The local fixture did not load. Retry uses the default successful owner example.</p><button type="button" onClick={() => { setScenario('review'); load(false, 'review'); }}>Retry private example</button></section>}
    {stale && <section role="alert" className="stale-banner"><strong>This private local snapshot is stale.</strong><span>Commands are disabled until it is refreshed.</span><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {state.kind === 'loaded' && !room && <section role="status" className="state-card"><h2>No private example selected</h2><p>This local scenario has no owner snapshot.</p><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {room && <div className="owner-grid">
      <section className="owner-card" aria-labelledby="inputs"><p className="eyebrow">OWNER REVISION {room.ownerRevision}</p><h2 id="inputs">Your inputs</h2><p>Keep reasons private. Record a condition or preference without explaining why.</p><fieldset disabled={disabled}><legend>Meeting availability</legend><label><input type="radio" name="availability" checked={availability === 'exception'} onChange={() => { setAvailability('exception'); setReviewedIntervals([]); setDraftReviewInvalidated(true); }} /> {selectedInterval ? `${selectedInterval.date} · ${time(selectedInterval.startMinute)}–${time(selectedInterval.endMinute)} · ${selectedInterval.timezone} is unavailable, but you may ask about a scoped exception.` : 'A scoped availability question is available.'}</label><label><input type="radio" name="availability" checked={availability === 'available'} onChange={() => { setAvailability('available'); setReviewedIntervals([]); setDraftReviewInvalidated(true); }} /> {selectedInterval ? `${selectedInterval.date} · ${time(selectedInterval.startMinute)}–${time(selectedInterval.endMinute)} · ${selectedInterval.timezone} is available.` : 'This exact interval is available.'}</label><label>Meeting duration <select value={duration} onChange={event => { setDuration(event.target.value); setReviewedIntervals([]); setDraftReviewInvalidated(true); }}><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label><label>Follow-up duty cost <select value={cost} onChange={event => { setCost(event.target.value); setReviewedIntervals([]); setDraftReviewInvalidated(true); }}><option value="0">0 — no added inconvenience</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><button type="button" onClick={() => { const next = values(); if (next && context) { setReviewedIntervals([]); setDraftReviewInvalidated(true); void run(submitInputDraft(room, context, next)); } }}>Submit input draft</button></fieldset><p className="timezone">Submitting creates a versioned private draft; it does not grant an exception, authorize disclosure, or accept a plan.</p></section>
      {room.draft && <section className="owner-card" aria-labelledby="confirm-inputs"><p className="eyebrow">DRAFT REVIEW</p><h2 id="confirm-inputs">Confirm reviewed inputs</h2><p>Review the exact dated intervals in draft {room.draft.draftId}, revision {room.draft.draftRevision}. {draftReviewInvalidated ? 'A draft submission or edit has not been returned as a current private snapshot, so it cannot be confirmed yet.' : 'Changing any input requires a fresh current draft review.'}</p>{draftIntervals.map(value => <label key={intervalKey(value)}><input type="checkbox" disabled={draftReviewInvalidated} checked={reviewedIntervals.includes(intervalKey(value))} onChange={event => setReviewedIntervals(current => event.target.checked ? [...current, intervalKey(value)] : current.filter(key => key !== intervalKey(value)))} /> I reviewed {value.date} · {time(value.startMinute)}–{time(value.endMinute)} · {value.timezone}.</label>)}<div className="button-row"><button type="button" disabled={disabled || draftReviewInvalidated || reviewedIntervals.length !== draftIntervals.length} onClick={() => { if (context) void run(confirmInputs(room, context, room.draft!, draftIntervals.filter(value => reviewedIntervals.includes(intervalKey(value))))); }}>Confirm these reviewed intervals</button></div></section>}
      <section className="owner-card" aria-labelledby="context-consent"><p className="eyebrow">SHARED CONTEXT</p><h2 id="context-consent">Confirm current setup</h2><p>Confirming the displayed policy and schedule is separate from input confirmation, exception permission, disclosure, and final acceptance.</p><div className="button-row"><button type="button" disabled={disabled || !room.confirmedInputs} onClick={() => { if (context && publicRoom) void run(acceptContext(room, context, publicRoom.policy)); }}>Confirm current setup</button><button type="button" disabled={disabled || publicRoom?.status !== 'READY'} onClick={() => { if (context) void run(requestSolve(room, context)); }}>Request local plan</button></div></section>
      <section className="owner-card" aria-labelledby="exception"><p className="eyebrow">CHANGE PERMISSION</p><h2 id="exception">Exception</h2>{room.pendingOffers.map(offer => <div key={offer.id} className="scope"><p>Would {offer.scope.meeting.interval.date} at {time(offer.scope.meeting.interval.startMinute)}–{time(offer.scope.meeting.interval.endMinute)} ({offer.scope.meeting.interval.timezone}) work only if you take neither weekend duty in this plan?</p><p>{exceptionScopeSummary(offer.scope)}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => runCurrent(current => decideException(room, current, offer, 'ALLOW'))}>Allow scoped exception</button><button type="button" className="secondary" disabled={disabled} onClick={() => runCurrent(current => decideException(room, current, offer, 'DECLINE'))}>Decline exception</button></div></div>)}</section>
      <section className="owner-card" aria-labelledby="disclosure"><p className="eyebrow">DISCLOSURE PERMISSION</p><h2 id="disclosure">Disclosure</h2>{room.disclosurePreviews.map(preview => <div key={preview.id} className="scope"><p>May the shared table say:</p><blockquote>{preview.text}</blockquote><p>Audience: {preview.audienceMemberIds.map(id => names[id] ?? id).join(', ')}. Decision revision {preview.decisionRevision}; expires {preview.expiresAt}. {preview.inferenceWarning}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => runCurrent(current => decideDisclosure(room, current, preview, 'ALLOW'))}>Allow this wording</button><button type="button" className="secondary" disabled={disabled} onClick={() => runCurrent(current => decideDisclosure(room, current, preview, 'DECLINE'))}>Use exception without announcement</button></div></div>)}</section>
      <section className="owner-card" aria-labelledby="approval"><p className="eyebrow">FINAL ACCEPTANCE</p><h2 id="approval">Final plan acceptance</h2><p>Final acceptance is separate from both choices above. Review the current public proposal before accepting.</p>{currentProposal ? <><p>Proposal {currentProposal.id}, version {currentProposal.facts.proposalVersion}; {currentProposal.policyLabel}; valid until {currentProposal.validUntil}.</p><p>Meeting: {currentProposal.facts.plan.meeting.interval.date} · {time(currentProposal.facts.plan.meeting.interval.startMinute)}–{time(currentProposal.facts.plan.meeting.interval.endMinute)} · {currentProposal.facts.plan.meeting.interval.timezone}.</p><ul>{currentProposal.facts.plan.assignments.map(assignment => <li key={assignment.duty.id}>{assignment.duty.label}: {names[assignment.participantId] ?? assignment.participantId}, {assignment.duty.interval.date} {time(assignment.duty.interval.startMinute)}–{time(assignment.duty.interval.endMinute)}.</li>)}</ul><p>Plan hash: {currentProposal.planHash}</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => runCurrent(current => acceptProposal(room, current, currentProposal))}>Accept reviewed current proposal</button>{room.ownApproval && <button type="button" className="secondary" disabled={disabled} onClick={() => runCurrent(current => withdrawApproval(room, current, room.ownApproval!))}>Withdraw recorded approval</button>}</div></> : <><p>No matching current proposal is available. A receipt is history only and cannot enable acceptance.</p><button type="button" disabled>Await an exact shared proposal</button>{room.ownApproval && <button type="button" className="secondary" disabled={disabled} onClick={() => runCurrent(current => withdrawApproval(room, current, room.ownApproval!))}>Withdraw recorded approval</button>}</>}</section>
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
