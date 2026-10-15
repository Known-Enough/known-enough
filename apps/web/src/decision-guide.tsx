import { useEffect, useRef, useState } from 'react';
import { Brand, PrivacyBar, ThemeToggle } from './app-chrome';

/** Public instructional content only: no account data, server fixtures or model calls. */
export function DecisionGuide() {
  const [step, setStep] = useState(0);
  const [participant, setParticipant] = useState<'Alex' | 'Sam'>('Alex');
  const [copyNotice, setCopyNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step]);
  const steps = ['Describe your idea', 'Review the choices', 'Share needs privately', 'Decide together'];
  const url = window.location.origin + '/?guide=decision';
  async function copyLink() {
    try { await navigator.clipboard.writeText(url); setCopyNotice('Example link copied.'); }
    catch { setCopyNotice('Copy the example link shown below.'); }
  }
  return <main className="ke-home ke-guide">
    <header className="ke-masthead"><Brand /><div className="ke-header-actions"><ThemeToggle /><a className="ke-guide-app-link" href="/">Open the app</a></div></header>
    <section className="ke-guide-intro"><span className="ke-guide-badge">Fictional example · no sign-in needed</span><h1>From an idea to a decision.</h1>
      <p>See how a group can shape the choices, share needs privately, and review a proposal together.</p>
      <p className="ke-guide-disclaimer">This is an illustrated walkthrough, not a live decision or AI result. Names, places and prices are fictional. Nothing here creates an account, calls AI or changes a group.</p>
    </section>
    <nav aria-label="Example decision steps"><ol className="ke-guide-nav">{steps.map((label, index) => <li key={label}><button type="button" className="secondary" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span>{label}</button></li>)}</ol></nav>
    <article className="ke-guide-scene" aria-labelledby="guide-scene-title">
      <p className="ke-guide-step-count">Step {step + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} id="guide-scene-title">{steps[step]}</h2>
      {step === 0 && <>
        <p>Describe the decision naturally. Include options you already know and anything still undecided.</p>
        <blockquote>“Let’s have dinner together. We’re considering Olive Room, Noodle Corner or Garden Table, on Friday or Saturday. We don’t know which works best for everyone.”</blockquote>
        <div className="ke-guide-note"><strong>A little detail helps.</strong><p>You don’t need everyone’s preferences or personal budget. Each person supplies those privately later.</p></div>
        <details><summary>What if I only know the basic idea?</summary><p>You can start with “Let’s go to a restaurant.” Choose <strong>Help me describe my idea</strong>, or ask AI to suggest a small starting set of choices. Suggestions need your review; they are not confirmed facts.</p></details>
      </>}
      {step === 1 && <>
        <p>AI helps turn your description into choices. You review its understanding before creating the decision.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Shared draft · organizer review</span><h3>Choose our group dinner</h3>
          <dl><div><dt>Restaurant</dt><dd>Olive Room · Noodle Corner · Garden Table</dd></div><div><dt>Day</dt><dd>Friday · Saturday</dd></div><div><dt>People</dt><dd>Alex and Sam</dd></div></dl>
        </div>
        <p>If something is missing or wrong, add that detail or adjust the draft. Creating it starts everyone’s review; it does not confirm their needs or approve an outcome.</p>
        <p className="ke-guide-disclaimer">For the later illustration, assume the group supplied fictional per-person estimates: Olive Room $18, Noodle Corner $22, Garden Table $32. AI must not invent real prices or opening times.</p>
      </>}
      {step === 2 && <>
        <p>Everyone first reviews the same shared choices. Then each person describes and confirms their own needs in their private conversation.</p>
        <div className="ke-guide-personas" role="group" aria-label="View a fictional participant’s perspective">{(['Alex', 'Sam'] as const).map(name => <button key={name} type="button" className="secondary" aria-pressed={participant === name} onClick={() => setParticipant(name)}>Example: {name}’s own view</button>)}</div>
        <div className="ke-guide-sample ke-guide-private"><span className="ke-guide-view-label">Fictional private view · {participant}</span>
          <blockquote>{participant === 'Alex' ? '“I can only do Saturday, I’d like to stay under $25, and I prefer Noodle Corner. Olive Room is okay too.”' : '“Friday or Saturday works. Noodle Corner or Garden Table would be good. I’d like to spend at most $30.”'}</blockquote>
          <p><strong>AI helps interpret the message.</strong> {participant === 'Alex' ? 'Saturday is required; Noodle Corner is preferred and Olive Room is acceptable.' : 'Either day is possible; Noodle Corner and Garden Table are preferred.'} {participant} checks the interpretation before confirming it.</p>
        </div>
        <p className="ke-guide-disclaimer">You can switch perspectives in this fictional example. In the real app, participants see their own private inputs; the shared view contains only permitted shared facts and disclosures. An outcome may still imply information.</p>
      </>}
      {step === 3 && <>
        <p>With usable choices and confirmed needs, the app helps compare a proposal. Missing facts or incompatible needs need clarification; AI must not announce false agreement.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Illustrative shared proposal</span><h3>Noodle Corner · Saturday</h3><p>Fictional estimate: $22 per person, supplied for this example. Actual prices and availability would need checking before booking.</p></div>
        <p>Each person independently reviews the proposal and either approves it or asks for a change. AI does not approve for anyone or reveal their private reasons automatically.</p>
        <div className="ke-guide-note"><strong>The same flow works for other choices.</strong><p>For a trip, compare destinations and dates. For a shared purchase, compare products. Each person’s limits still belong in their own private conversation.</p></div>
      </>}
      <footer className="ke-guide-controls"><button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Previous example step</button>{step < steps.length - 1 ? <button type="button" onClick={() => setStep(value => value + 1)}>Next example step</button> : <a className="ke-guide-start" href="/">Open Known Enough</a>}</footer>
    </article>
    <section className="ke-guide-share" aria-label="Share this example"><div><h2>Show someone how it works.</h2><a href="/?guide=decision">{url}</a></div><button type="button" className="secondary" onClick={() => void copyLink()}>Copy example link</button>{copyNotice && <p role="status">{copyNotice}</p>}</section>
    <p className="ke-guide-return-note">Opened this from a draft? Return to your original browser tab to continue it. This example does not change your draft.</p>
    <PrivacyBar />
  </main>;
}
