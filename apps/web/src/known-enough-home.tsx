import { useState, type FormEvent } from 'react';
import type { KnownEnough } from '@deal-table/contracts';

type LocalDecision = { id: number; objective: string; status: KnownEnough.PublicDecisionSnapshot['status'] };
type DecisionView = 'overview' | 'private' | 'proposal';

const privacyPromise = 'Your private inputs are processed by Known Enough to help the group reach a decision. Other participants do not receive those inputs unless you explicitly approve a disclosure or the final agreed outcome inherently reveals something.';

export function KnownEnoughHome() {
  const [objective, setObjective] = useState('');
  const [decision, setDecision] = useState<LocalDecision | null>(null);
  const [view, setView] = useState<DecisionView>('overview');

  const createDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = objective.trim();
    if (!value) return;
    setDecision({ id: Date.now(), objective: value, status: 'CREATING' });
    setView('overview');
    setObjective('');
  };

  return <main className="ke-home">
    <header className="masthead ke-masthead">
      <div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div>
      <span className="badge">Local prototype · nothing is shared</span>
    </header>

    <section className="ke-hero" aria-labelledby="create-heading">
      <p className="eyebrow">A SHARED DECISION SPACE</p>
      <h2 id="create-heading">What are you trying to decide?</h2>
      <p>Start with the question. The group can clarify what matters before anyone commits to an outcome.</p>
      <form className="ke-create" onSubmit={createDraft}>
        <label htmlFor="decision-objective">Describe the decision</label>
        <textarea id="decision-objective" value={objective} onChange={event => setObjective(event.target.value)} maxLength={2000} required placeholder="For example: Where should our family go on holiday?" />
        <button type="submit">Preview a local draft</button>
      </form>
    </section>

    <p className="notice ke-privacy"><strong>Known Enough product privacy promise for the connected service:</strong> “{privacyPromise}” This browser-only prototype has no sign-in or private-input form, does not contact a server, and forgets drafts when you leave or reload.</p>

    {decision ? <section className="ke-workspace" aria-labelledby="decision-heading">
      <div className="ke-card ke-decision-heading">
        <div><p className="eyebrow">YOUR DECISION</p><h2 id="decision-heading">{decision.objective}</h2></div>
        <span role="status" className="status-pill">{decision.status === 'CREATING' ? 'Draft' : 'In progress'} · this browser only</span>
      </div>
      <nav className="ke-tabs" aria-label="Decision views">
        {(['overview', 'private', 'proposal'] as const).map(item => <button key={item} type="button" className={view === item ? '' : 'secondary'} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'overview' ? 'Shared overview' : item === 'private' ? 'Your private space' : 'Proposal'}</button>)}
      </nav>
      {view === 'overview' && <section className="ke-card" aria-labelledby="overview-heading">
        <div className="section-heading"><h3 id="overview-heading">Decision status</h3><span className="status-pill">Draft</span></div>
        <p>This draft exists only in this browser. There are no invited or verified participants yet.</p>
        <h3>Participants</h3>
        <ul className="ke-participant-list" aria-label="Participants"><li>No participants invited yet. Invitations need connected sign-in and shared sessions.</li></ul>
        <p className="ke-next">Next: clarify the shared question, then invite participants to confirm it.</p>
      </section>}
      {view === 'private' && <section className="ke-card" aria-labelledby="private-heading">
        <h3 id="private-heading">Your private space</h3>
        <p>Private inputs and permission controls are not connected in this prototype. Do not enter personal or sensitive information here.</p>
        <p>In the working product, your conditions stay private unless you separately approve a disclosure or approve an outcome that reveals them.</p>
        <p><a href="?view=owner&owner=approval">See the retained fictional private-receipts and permissions demo</a></p>
      </section>}
      {view === 'proposal' && <section className="ke-card" aria-labelledby="proposal-heading">
        <h3 id="proposal-heading">Proposal</h3>
        <p>No proposal yet. A proposal can be shown only after the required participants confirm the shared frame and provide their own inputs.</p>
        <p>Nothing is being generated or mechanically checked in this prototype.</p>
      </section>}
    </section> : <section className="ke-card ke-empty" aria-labelledby="your-decisions-heading">
      <p className="eyebrow">YOUR DECISIONS</p><h2 id="your-decisions-heading">Nothing here yet</h2>
      <p>Your first draft will appear here. A draft in this preview stays in this browser and is not shared with anyone.</p>
    </section>}

    <footer className="ke-footer">This preview uses no authenticated identity or live AI. <a href="?legacy=teamtable">Open the retained TeamTable regression demo</a>.</footer>
  </main>;
}
