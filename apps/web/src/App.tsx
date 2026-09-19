import { useEffect, useState } from 'react';
import type { PublicRoomSnapshot } from '@deal-table/contracts';
import { publicMockClient } from './mock-adapter';

function time(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}
export function App() {
  const [room, setRoom] = useState<PublicRoomSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    publicMockClient.getPublicRoom().then(value => { if (active) setRoom(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return <main>
    <header><p className="eyebrow">TEAMTABLE · LAUNCH REHEARSAL</p><span className="badge">Local mock · fictional data</span></header>
    <h1>Deal Table</h1><p className="promise">Agree on the work without having to explain your life.</p>
    <p className="notice">Runnable scaffold only. Mocked identities are not authentication. No live Alexa or AWS integration.</p>
    {!room && <p role={failed ? 'alert' : 'status'}>{failed ? 'The local example could not be loaded.' : 'Loading local example…'}</p>}
    {room && <>
      <section aria-labelledby="people"><h2 id="people">Around the table</h2><ul className="participants">{room.roster.map(p => <li key={p.id}><span className="avatar" aria-hidden="true">{p.displayName[0]}</span><strong>{p.displayName}</strong><span>Fictional participant</span></li>)}</ul></section>
      <section className="table" aria-labelledby="choices"><div className="section-heading"><h2 id="choices">One meeting. Two duties.</h2><span className="pending">No agreement yet · mock</span></div>
        <p>Meeting choices · Thursday, October 8, 2026</p><p className="timezone">All times: {room.timezone}</p>
        <ul className="slots" aria-label="Three meeting slots">{room.schedule.slots.map(s => <li key={s.id}>{time(s.interval.startMinute)}–{time(s.interval.endMinute)}<small>{s.interval.endMinute - s.interval.startMinute} minutes</small></li>)}</ul>
        <ul className="duties" aria-label="Two unassigned duties">{room.schedule.duties.map(d => <li key={d.id}><div><h3>{d.label}</h3><p>{d.interval.date} · {time(d.interval.startMinute)}–{time(d.interval.endMinute)}</p></div><span className="pending">Unassigned</span></li>)}</ul>
        <p className="policy">Fixture’s pre-agreed policy: <strong>Balance recent duty load</strong></p>
      </section>
      <p className="next">Personal inputs and negotiation arrive in later tasks. This page displays a public-only local example.</p>
    </>}
    <footer>Fictional participants · October 2026 · No cloud services deployed</footer>
  </main>;
}
