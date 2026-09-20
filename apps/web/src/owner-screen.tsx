import { useEffect, useRef, useState } from 'react';
import type { OwnerSnapshot } from '@deal-table/contracts';
import { ownerMockClient, type OwnerMockScenario } from './owner-mock-adapter';

type LoadState = { kind: 'loading' } | { kind: 'failure' } | { kind: 'loaded'; value: OwnerSnapshot | null; stale: boolean };

function time(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}

function isOwnerMockScenario(value: string | null): value is OwnerMockScenario {
  return value === 'review' || value === 'draft' || value === 'approval' || value === 'empty' || value === 'failure' || value === 'stale';
}

const memberNames: Record<string, string> = { maya: 'Maya', leo: 'Leo', nina: 'Nina' };
const policyLabel = (policy: string) => policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience';
const nameList = (memberIds: string[]) => memberIds.map(id => memberNames[id] ?? id).join(', ');

export function OwnerScreen({ initialScenario }: { initialScenario: string | null }) {
  const initial = isOwnerMockScenario(initialScenario) ? initialScenario : 'review';
  const [scenario, setScenario] = useState<OwnerMockScenario>(initial);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [availability, setAvailability] = useState<'exception' | 'available'>('exception');
  const [cost, setCost] = useState('0');
  const [savedDraft, setSavedDraft] = useState<{ availability: string; cost: string } | null>(null);
  const [exceptionChoice, setExceptionChoice] = useState<string | null>(null);
  const [disclosureChoice, setDisclosureChoice] = useState<string | null>(null);
  const request = useRef(0);

  const load = (refresh = false, nextScenario = scenario) => {
    const requestId = ++request.current;
    setState({ kind: 'loading' });
    ownerMockClient.readOwnerRoom(nextScenario, { refresh }).then(result => {
      if (requestId === request.current) setState({ kind: 'loaded', value: result.value, stale: result.freshness === 'stale' });
    }).catch(() => { if (requestId === request.current) setState({ kind: 'failure' }); });
  };

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [initial]);

  const retry = () => { setScenario('review'); load(false, 'review'); };
  const room = state.kind === 'loaded' ? state.value : null;
  const stale = state.kind === 'loaded' && state.stale;
  const controlsDisabled = stale || state.kind !== 'loaded' || room === null;
  const inputValues = room?.draft?.values ?? room?.confirmedInputs?.values ?? null;
  const condition = inputValues?.conditions[0];
  const interval = condition?.kind === 'HARD_AVAILABILITY' ? condition.availableIntervals[0] : condition?.interval;

  useEffect(() => {
    if (!inputValues) return;
    setAvailability(condition?.kind === 'NEGOTIABLE_UNAVAILABLE' ? 'exception' : 'available');
    setCost(String(inputValues.dutyCosts.find(item => item.dutyId === 'followup')?.cost ?? 0));
  }, [condition?.kind, inputValues]);

  return <main className="owner-page">
    <header className="masthead"><div><p className="eyebrow">TEAMTABLE · PRIVATE DEMO</p><h1>Private owner screen · local demo</h1></div><div className="header-actions"><span className="badge">Fictional private example</span><a className="quiet-link" href="?public=collecting">Return to shared table</a></div></header>
    <p className="notice">This is a fixed, synthetic owner example for Nina. It is not an account, does not authenticate a person, and never changes a real permission or shared result.</p>
    {state.kind === 'loading' && <p role="status" className="state-card">Loading private local example…</p>}
    {state.kind === 'failure' && <section role="alert" className="state-card failure"><h2>Private example unavailable</h2><p>The local fixture did not load. Retry uses the default successful owner example.</p><button type="button" onClick={retry}>Retry private example</button></section>}
    {stale && <section role="alert" className="stale-banner"><strong>This private local snapshot is stale.</strong><span>Simulated choices are disabled until it is refreshed.</span><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {state.kind === 'loaded' && !room && <section role="status" className="state-card"><h2>No private example selected</h2><p>This local scenario has no owner snapshot.</p><button type="button" onClick={() => load(true)}>Refresh private example</button></section>}
    {room && <div className="owner-grid">
      <section className="owner-card" aria-labelledby="inputs"><p className="eyebrow">OWNER REVISION {room.ownerRevision}</p><h2 id="inputs">Your inputs</h2><p>Keep reasons private. Record a condition or preference without explaining why.</p><p className="timezone">{room.draft ? `Editing local draft revision ${room.draft.draftRevision}; confirmed inputs remain separate.` : `Showing confirmed inputs revision ${room.confirmedInputs?.inputRevision ?? '—'}.`}</p><fieldset disabled={controlsDisabled}><legend>Meeting availability</legend><label><input type="radio" name="availability" checked={availability === 'exception'} onChange={() => setAvailability('exception')} /> {interval ? `${interval.date} · ${time(interval.startMinute)}–${time(interval.endMinute)} · ${interval.timezone} is unavailable, but you may ask about a scoped exception.` : 'A scoped availability question is available.'}</label><label><input type="radio" name="availability" checked={availability === 'available'} onChange={() => setAvailability('available')} /> {interval ? `${interval.date} · ${time(interval.startMinute)}–${time(interval.endMinute)} · ${interval.timezone} is available.` : 'This exact interval is available.'}</label><label>Follow-up duty cost <select value={cost} onChange={event => setCost(event.target.value)}><option value="0">0 — no added inconvenience</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><button type="button" onClick={() => setSavedDraft({ availability, cost })}>Save local input draft</button></fieldset><p className="timezone">This control does not submit data.</p>{savedDraft && <p role="status" className="local-note">Saved local draft: the exact interval is {savedDraft.availability === 'available' ? 'available' : 'unavailable with a scoped question'}; follow-up cost {savedDraft.cost}. It has not changed your confirmed inputs.</p>}</section>
      <section className="owner-card" aria-labelledby="exception"><p className="eyebrow">CHANGE PERMISSION</p><h2 id="exception">Exception</h2>{room.pendingOffers.map(offer => <div key={offer.id} className="scope"><p>Would {offer.scope.meeting.interval.date} at {time(offer.scope.meeting.interval.startMinute)}–{time(offer.scope.meeting.interval.endMinute)} ({offer.scope.meeting.interval.timezone}) work only if you take neither weekend duty in this plan?</p><p>Scope: roster {nameList(offer.scope.rosterMemberIds)}, decision revision {offer.scope.decisionRevision}, policy {policyLabel(offer.scope.policy)}, exact dated interval, and expiry {offer.scope.expiresAt}.</p><div className="button-row"><button type="button" disabled={controlsDisabled} onClick={() => setExceptionChoice('Local-only example: scoped exception marked allowed. No permission was granted.')}>Allow scoped exception</button><button type="button" className="secondary" disabled={controlsDisabled} onClick={() => setExceptionChoice('Local-only example: exception marked declined. No permission was changed.')}>Decline exception</button></div></div>)}{exceptionChoice && <p role="status" className="local-note">{exceptionChoice}</p>}</section>
      <section className="owner-card" aria-labelledby="disclosure"><p className="eyebrow">DISCLOSURE PERMISSION</p><h2 id="disclosure">Disclosure</h2>{room.disclosurePreviews.map(preview => <div key={preview.id} className="scope"><p>May the shared table say:</p><blockquote>{preview.text}</blockquote><p>Audience: {nameList(preview.audienceMemberIds)}. Decision revision {preview.decisionRevision}; expires {preview.expiresAt}. {preview.inferenceWarning}</p><div className="button-row"><button type="button" disabled={controlsDisabled} onClick={() => setDisclosureChoice('Local-only example: wording marked allowed. This does not publish it.')}>Allow this wording</button><button type="button" className="secondary" disabled={controlsDisabled} onClick={() => setDisclosureChoice('Local-only example: use the exception without this announcement was selected.')}>Use exception without announcement</button></div></div>)}{disclosureChoice && <p role="status" className="local-note">{disclosureChoice}</p>}</section>
      <section className="owner-card" aria-labelledby="approval"><p className="eyebrow">FINAL ACCEPTANCE</p><h2 id="approval">Final plan acceptance</h2><p>Final acceptance is separate from both choices above. A real participant would review one exact plan, revision, and hash before accepting.</p>{room.ownApproval ? <p className="accepted">Synthetic local receipt: {room.ownApproval.proposalId}, version {room.ownApproval.proposalVersion}, hash {room.ownApproval.planHash}. It is not a real agreement.</p> : <><p>No exact shared proposal is available in this owner fixture, so acceptance remains unavailable.</p><button type="button" disabled>Await an exact shared proposal</button></>}</section>
    </div>}
    <footer>Private local demo · fictional data · no cloud services deployed</footer>
  </main>;
}
