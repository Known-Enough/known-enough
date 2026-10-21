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
    <button type="button" className="secondary" onClick={onReturn}>Back to my draft</button>
    <section className="ke-guide-intro"><span className="ke-guide-badge">Made-up example</span><h3>From an idea to a decision.</h3>
      <p>See how Alex and Sam choose an option that works for both of them.</p>
      <p className="ke-guide-disclaimer">This example uses made-up people, places and choices. Exploring it won’t change your draft or group.</p>
    </section>
    <nav aria-label="Example decision steps"><ol className="ke-guide-nav">{steps.map((label, index) => <li key={label}><button type="button" className="secondary" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span>{label}</button></li>)}</ol></nav>
    <article className="ke-guide-scene" aria-labelledby="guide-scene-title">
      <p className="ke-guide-step-count">Step {step + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} id="guide-scene-title">{steps[step]}</h2>
      {step === 0 && <>
        <p>Describe the decision naturally. Include options you already know and anything still undecided.</p>
        <blockquote>“Choose our group dinner: Olive Room, Noodle Corner or Garden Table, on 23 October 2026 or 24 October 2026. We don’t know which works best for everyone.”</blockquote>
        <div className="ke-guide-note"><strong>A little detail helps.</strong><p>List the options your group is considering. Choose Continue to edit them before creating the decision.</p></div>
        <details><summary>What if I only know the basic idea?</summary><p>Use <strong>Help me get started</strong> for optional writing assistance. You choose whether to use a suggested description. In Options, add your own alternatives or choose <strong>Suggest options</strong> and add only the suggestions you want. You can complete the decision without AI.</p></details>
      </>}
      {step === 1 && <>
        <p>Check your options in the second step. Add, rename or remove options, and give the decision a short name, such as “Group dinner plan”.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Options everyone will see</span><h3>Group dinner plan</h3>
          <dl><div><dt>Restaurant</dt><dd>Olive Room · Noodle Corner · Garden Table</dd></div><div><dt>Date</dt><dd>23 October 2026 · 24 October 2026</dd></div><div><dt>People</dt><dd>Alex and Sam</dd></div></dl>
        </div>
        <p>Edit the topic names and options, then choose <strong>Create decision</strong>. Everyone then adds their answers privately.</p>
        <p className="ke-guide-disclaimer">These restaurants and dates are made up. In your own decision, check prices, availability and any other important details.</p>
      </>}
      {step === 2 && <>
        <p><strong>Opening a decision</strong> shows its summary, everyone’s progress and <strong>What works for you?</strong> Tick every option that works for you, or choose Select all or None work for me. You can save without waiting for anyone else. Saving selected options doesn’t use AI.</p>
        <div className="ke-guide-personas" role="group" aria-label="View a fictional participant’s perspective">{(['Alex', 'Sam'] as const).map(name => <button key={name} type="button" className="secondary" aria-pressed={participant === name} onClick={() => setParticipant(name)}>See {name}’s answers</button>)}</div>
        <div className="ke-guide-sample ke-guide-private"><span className="ke-guide-view-label">Example private answers · {participant}</span>
          <dl><div><dt>Restaurant · Selected options</dt><dd>{participant === 'Alex' ? 'Olive Room and Noodle Corner' : 'Noodle Corner and Garden Table'}</dd></div>
            <div><dt>Date</dt><dd>{participant === 'Alex' ? '24 October 2026' : '23 and 24 October 2026'}</dd></div>
            <div><dt>Favorite · optional</dt><dd>Noodle Corner</dd></div></dl>
          <p>{participant} leaves extra notes empty, agrees to the preview data use, then chooses <strong>Save answers</strong>. The answers are then saved.</p>
        </div>
        <details><summary>What about extra notes or an option that doesn’t work?</summary><p>You can add an extra requirement if the options don’t cover it. <strong>Get AI suggestions</strong> uses AI with your consent. Review its suggestions before saving; your selected options stay unchanged. If you choose <strong>None work for me</strong>, the group needs other options before it can agree.</p></details>
        <p className="ke-guide-disclaimer">Here you can view both example answers. In your own group, you can’t read other people’s private answers. A shared outcome can still hint at what people need.</p>
      </>}
      {step === 3 && <>
        <p>The overview shows your saved answers and everyone’s progress, without revealing anyone else’s answers. An outcome is prepared automatically once the required answers are ready. Choose <strong>View proposal</strong> when it is ready to review.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Example proposal</span><h3>Noodle Corner · 24 October 2026</h3><p>This option works for both Alex and Sam in our made-up example.</p></div>
        <p>Each person opens <strong>View proposal</strong>, checks the proposal and any details shown only to them, confirms they have reviewed it, then chooses <strong>Approve proposal</strong> only if they agree. The decision reaches agreement only when every required participant approves that same proposal. Approval does not make a booking or purchase.</p>
        <details><summary>What if someone joins or the proposal changes?</summary><p>When someone joins, <strong>unfinished decisions include them automatically</strong>. They add their own answers, and existing answers stay saved. An updated proposal needs new approvals. Finished decisions keep their original participants and outcome. Changing the options or saved requirements can also require a new proposal.</p></details>
        <div className="ke-guide-note"><strong>Agreement is never automatic.</strong><p>If no option works for everyone, the group may need more details or new options. Agreeing to a private adjustment or sharing a detail does not approve the final proposal.</p></div>
      </>}
      <footer className="ke-guide-controls"><button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Previous</button>{step < steps.length - 1 ? <button type="button" onClick={() => setStep(value => value + 1)}>Next</button> : <button type="button" onClick={onReturn}>Back to my draft</button>}</footer>
    </article>
    <p className="ke-guide-return-note">Return to your draft whenever you’re ready. This example doesn’t submit anything.</p>
  </section>;
}
