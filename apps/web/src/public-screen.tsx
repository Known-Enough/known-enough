import { useEffect, useRef, useState } from 'react';
import type { PublicRoomSnapshot } from '@deal-table/contracts';
import { publicMockClient, type PublicMockScenario } from './mock-adapter';

type LoadState = { kind: 'loading' } | { kind: 'failure' } | { kind: 'loaded'; value: PublicRoomSnapshot | null; stale: boolean };

const statusText: Record<PublicRoomSnapshot['status'], string> = {
  COLLECTING: 'Collecting shared confirmations', READY: 'Ready to seek a plan', SOLVING: 'Checking the agreed options',
  PRIVATE_REVIEW: 'Private review in progress', PROPOSED: 'A plan is ready for separate acceptance',
  APPROVING: 'Waiting for matching acceptances', AGREED: 'Agreement recorded for this local example',
  NO_AGREEMENT: 'No agreement in this local example', SUPERSEDED: 'This local example was superseded', CLOSED: 'This local example is closed',
};

function time(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}

export function isPublicMockScenario(value: string | null): value is PublicMockScenario {
  return value === 'collecting' || value === 'empty' || value === 'failure' || value === 'stale' || value === 'blocked'
    || value === 'private-review' || value === 'proposed' || value === 'agreed' || value === 'superseded';
}

export function PublicScreen({ initialScenario }: { initialScenario: PublicMockScenario }) {
  const [scenario, setScenario] = useState(initialScenario);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const request = useRef(0);

  const load = (refresh = false, nextScenario = scenario) => {
    const requestId = ++request.current;
    setState({ kind: 'loading' });
    publicMockClient.readPublicRoom(nextScenario, { refresh }).then(result => {
      if (requestId === request.current) setState({ kind: 'loaded', value: result.value, stale: result.freshness === 'stale' });
    }).catch(() => { if (requestId === request.current) setState({ kind: 'failure' }); });
  };

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [initialScenario]);

  const retry = () => { setScenario('collecting'); load(false, 'collecting'); };
  const refresh = () => load(true);
  const room = state.kind === 'loaded' ? state.value : null;
  const stale = state.kind === 'loaded' && state.stale;

  return <main>
    <header className="masthead"><div><p className="eyebrow">TEAMTABLE · LAUNCH REHEARSAL</p><h1>Deal Table</h1></div><div className="header-actions"><span className="badge">Shared table · local demo</span><a className="quiet-link" href="?view=owner&owner=review">Open private owner demo</a></div></header>
    <p className="promise">Agree on the work without having to explain your life.</p>
    <p className="notice">Fictional data for an interface demo. This shared screen uses only public fields. Local examples are not authentication and do not change anyone’s permissions.</p>
    {state.kind === 'loading' && <p role="status" className="state-card">Loading shared local example…</p>}
    {state.kind === 'failure' && <section role="alert" className="state-card failure"><h2>Shared example unavailable</h2><p>The local fixture did not load. Retry uses the default successful example.</p><button type="button" onClick={retry}>Retry local example</button></section>}
    {stale && <section role="alert" className="stale-banner"><strong>This local snapshot is stale.</strong><span>Refresh before using any simulated control.</span><button type="button" onClick={refresh}>Refresh shared example</button></section>}
    {state.kind === 'loaded' && !room && <section role="status" className="state-card"><h2>No shared example selected</h2><p>This local scenario has no room snapshot.</p><button type="button" onClick={refresh}>Refresh shared example</button></section>}
    {room && <>
      <section aria-labelledby="people"><div className="section-heading"><h2 id="people">Around the table</h2><span className="status-pill">{statusText[room.status]}</span></div><ul className="participants">{room.roster.map(p => <li key={p.id}><span className="avatar" aria-hidden="true">{p.displayName[0]}</span><strong>{p.displayName}</strong><span>{p.submitted ? 'Shared confirmation recorded' : 'Awaiting shared confirmation'}</span></li>)}</ul></section>
      <section className="table" aria-labelledby="choices"><div className="section-heading"><div><p className="eyebrow">DECISION REVISION {room.decisionRevision}</p><h2 id="choices">One meeting. Two duties.</h2></div><span className="pending">{statusText[room.status]}</span></div>
        <p>Meeting choices · Thursday, October 8, 2026</p><p className="timezone">All times: {room.timezone}. Times are fixed to this decision timezone.</p>
        <ul className="slots" aria-label="Three meeting slots">{room.schedule.slots.map(s => <li key={s.id}><strong>{time(s.interval.startMinute)}–{time(s.interval.endMinute)}</strong><small>{s.interval.endMinute - s.interval.startMinute} minutes</small></li>)}</ul>
        <ul className="duties" aria-label="Weekend duties">{room.schedule.duties.map(d => { const assignee = room.proposal?.facts.plan.assignments.find(a => a.duty.id === d.id)?.participantId; return <li key={d.id}><div><h3>{d.label}</h3><p>{d.interval.date} · {time(d.interval.startMinute)}–{time(d.interval.endMinute)} · {d.loadPoints} agreed load point{d.loadPoints === 1 ? '' : 's'}</p></div><span className="pending">{room.roster.find(p => p.id === assignee)?.displayName ?? 'Unassigned'}</span></li>; })}</ul>
        <p className="policy">Agreed policy: <strong>{room.proposal?.policyLabel ?? (room.policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience')}</strong></p>
      </section>
      {room.proposal && <section className="proposal-card" aria-labelledby="proposal"><div className="section-heading"><h2 id="proposal">Current proposal</h2><span className="proposal-version">Version {room.proposal.facts.proposalVersion}</span></div><p>Meeting: Thursday, October 8 · {time(room.proposal.facts.plan.meeting.interval.startMinute)}–{time(room.proposal.facts.plan.meeting.interval.endMinute)} · {room.timezone}</p><ul>{room.proposal.facts.plan.assignments.map(a => <li key={a.duty.id}><strong>{a.duty.label}</strong><span>{room.roster.find(p => p.id === a.participantId)?.displayName ?? 'Participant'}</span></li>)}</ul><p className="approval-note">{room.approvedMemberIds.length} of {room.roster.length} separate acceptance{room.approvedMemberIds.length === 1 ? '' : 's'} recorded for this exact local proposal.</p></section>}
      <section className="consent-boundary" aria-labelledby="boundaries"><h2 id="boundaries">Three separate choices</h2><p>Changing an availability condition, allowing wording to be published, and accepting a final plan are separate permissions. This public view never identifies private conditions, exceptions, or refusals.</p></section>
      {room.publishedDisclosures.length > 0 && <section aria-labelledby="ledger"><h2 id="ledger">Published disclosure ledger</h2><ul className="ledger">{room.publishedDisclosures.map(item => <li key={`${item.text}-${item.publishedAt}`}><q>{item.text}</q><span>Audience: {item.audienceMemberIds.join(', ')} · {item.publishedAt}</span></li>)}</ul></section>}
      <p className="next">This shared local view cannot submit inputs, grant exceptions, disclose wording, or accept a plan for a participant.</p>
    </>}
    <footer>Fictional participants · October 2026 · No cloud services deployed</footer>
  </main>;
}
