import { useEffect, useRef, useState } from 'react';

/** Public instructional content only: no account data, server fixtures or model calls. */
export function DecisionGuide({ onReturn }: { onReturn: () => void }) {
  const [step, setStep] = useState(0);
  const [participant, setParticipant] = useState<'Alex' | 'Sam'>('Alex');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const steps = ['Describe your idea', 'Create the decision', 'What works for you?', 'Review the proposal'];
  return <section className="ke-guide ke-guide-embedded" aria-label="Fictional decision example">
    <button type="button" className="secondary" onClick={onReturn}>Back to my decision draft</button>
    <section className="ke-guide-intro"><span className="ke-guide-badge">Fictional example · read-only</span><h3>From an idea to a decision.</h3>
      <p>Follow Alex and Sam from a shared idea to private selections and independent proposal approvals.</p>
      <p className="ke-guide-disclaimer">This is an illustrated walkthrough, not a live decision or AI result. People, places and choices are fictional. Nothing here creates an account, calls AI or changes a group.</p>
    </section>
    <nav aria-label="Example decision steps"><ol className="ke-guide-nav">{steps.map((label, index) => <li key={label}><button type="button" className="secondary" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span>{label}</button></li>)}</ol></nav>
    <article className="ke-guide-scene" aria-labelledby="guide-scene-title">
      <p className="ke-guide-step-count">Step {step + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} id="guide-scene-title">{steps[step]}</h2>
      {step === 0 && <>
        <p>Describe the decision naturally. Include options you already know and anything still undecided.</p>
        <blockquote>“Choose our group dinner: Olive Room, Noodle Corner or Garden Table, on 16 October 2026 or 17 October 2026. We don’t know which works best for everyone.”</blockquote>
        <div className="ke-guide-note"><strong>A little detail helps.</strong><p>List the shared alternatives, without choosing for anyone else. Choose Continue to review your options. This does not call AI or create a decision.</p></div>
        <details><summary>What if I only know the basic idea?</summary><p>Use <strong>Help me get started</strong> for optional writing assistance. Your text stays unchanged until you choose Use this description. On Options, add your own alternatives or use <strong>Suggest options</strong> and add only the suggestions you want. You can complete the decision without AI.</p></details>
      </>}
      {step === 1 && <>
        <p>Review your options in the second step. Add, rename or remove individual options, and edit the Decision name—for example, “Group dinner plan”—without changing its stable link.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Shared draft · organizer review</span><h3>Group dinner plan</h3>
          <dl><div><dt>Restaurant</dt><dd>Olive Room · Noodle Corner · Garden Table</dd></div><div><dt>Date</dt><dd>16 October 2026 · 17 October 2026</dd></div><div><dt>People</dt><dd>Alex and Sam</dd></div></dl>
        </div>
        <p>Edit the topic names and option rows, fill any missing details, then choose <strong>Create decision</strong>. The app constructs the decision from these choices. Each participant adds their own private answers; there is no separate shared-choice confirmation step.</p>
        <p className="ke-guide-disclaimer">This example supplies only restaurants and dates. It does not establish prices, availability or dietary suitability. Keep the choices manageable; suggestions still need your review.</p>
      </>}
      {step === 2 && <>
        <p><strong>Open decision</strong> opens the decision modal with its summary, everyone’s progress and <strong>What works for you?</strong> directly available. Choose and save your private answers without waiting for others. Listed options are saved directly without AI interpretation.</p>
        <div className="ke-guide-personas" role="group" aria-label="View a fictional participant’s perspective">{(['Alex', 'Sam'] as const).map(name => <button key={name} type="button" className="secondary" aria-pressed={participant === name} onClick={() => setParticipant(name)}>Example: {name}’s own view</button>)}</div>
        <div className="ke-guide-sample ke-guide-private"><span className="ke-guide-view-label">Fictional private view · {participant}</span>
          <dl><div><dt>Restaurant · Only the options I select work</dt><dd>{participant === 'Alex' ? 'Olive Room and Noodle Corner' : 'Noodle Corner and Garden Table'}</dd></div>
            <div><dt>Date</dt><dd>{participant === 'Alex' ? 'Only the options I select work: 17 October 2026' : 'Any listed option works for me: 16 or 17 October 2026'}</dd></div>
            <div><dt>My first choice — optional</dt><dd>Noodle Corner</dd></div></dl>
          <p>{participant} leaves Extra notes empty, ticks the fictional-data processing consent, then chooses <strong>Save my answers</strong>. There is no extra private-answer review wizard.</p>
        </div>
        <details><summary>What about extra notes or an option that doesn’t work?</summary><p>Extra notes are optional. <strong>Use AI help for these notes</strong> requires processing consent, and its suggestions need your review; it cannot change your direct selections. Unresolved needs require clarification. Choosing <strong>None of these options work</strong> saves that problem instead of inventing agreement.</p></details>
        <p className="ke-guide-disclaimer">You can switch perspectives in this fictional example. In the real app, participants see their own private inputs; the shared view contains only permitted shared facts and disclosures. An outcome may still imply information.</p>
      </>}
      {step === 3 && <>
        <p>The overview shows your own private summary and everyone’s progress, without anyone else’s selections or notes. When all required answers are ready, <strong>Continue</strong> opens the next step; <strong>Explore proposals</strong> is available when the decision is ready.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Illustrative shared proposal</span><h3>Noodle Corner · 17 October 2026</h3><p>This illustrative combination fits both fictional acceptable sets. It is an example, not a generated result or a guarantee of the best outcome.</p></div>
        <p>Each person opens <strong>Review proposal</strong>, checks the shared outcome and their private part, ticks the review confirmation, then chooses <strong>Approve this exact proposal</strong> only if they agree. The decision reaches agreement only when every required participant approves that same proposal. Approval does not make a booking or purchase.</p>
        <details><summary>What if someone joins or the proposal changes?</summary><p>Joining the group alone does not enroll someone in existing decisions. The organizer can use <strong>Update decision participants</strong> to include a newcomer in an ongoing decision. Earlier answers and shared-choice confirmations stay saved; the newcomer supplies their own. An unfinished proposal needs fresh approval after inclusion. A finished decision keeps its recorded participants and outcome. Changing shared choices or confirmed answers still follows the app’s existing review rules.</p></details>
        <div className="ke-guide-note"><strong>Agreement is never automatic.</strong><p>Missing facts or incompatible needs may require clarification or new options. Permission to adjust or disclose a private detail is separate from approving the final proposal.</p></div>
      </>}
      <footer className="ke-guide-controls"><button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Previous example step</button>{step < steps.length - 1 ? <button type="button" onClick={() => setStep(value => value + 1)}>Next example step</button> : <button type="button" onClick={onReturn}>Back to my decision draft</button>}</footer>
    </article>
    <p className="ke-guide-return-note">Your creation form and saved request are kept in this modal. Viewing this fictional guidance does not submit anything.</p>
  </section>;
}
