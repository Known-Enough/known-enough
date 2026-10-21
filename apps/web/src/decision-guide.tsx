import { useEffect, useRef, useState } from 'react';

/** Public instructional content only: no account data, server fixtures or model calls. */
export function DecisionGuide({ onReturn }: { onReturn: () => void }) {
  const [step, setStep] = useState(0);
  const [participant, setParticipant] = useState<'Alex' | 'Sam'>('Alex');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const steps = ['Describe', 'Options', 'Private answers', 'Automatic outcome', 'Approve together'];
  return <section className="ke-guide ke-guide-embedded" aria-label="Fictional decision example">
    <button type="button" className="secondary" onClick={onReturn}>Back to my draft</button>
    <section className="ke-guide-intro"><span className="ke-guide-badge">Made-up example</span><h3>Alex and Sam plan dinner.</h3>
      <p>Follow one decision from the first idea to an outcome they both approve.</p>
      <p className="ke-guide-disclaimer">Everything here is an example. Your draft stays as it is; these steps don’t save answers, call AI or change your group.</p>
      <p>In your own group, the organizer chooses <strong>Start a decision</strong>. Group members can then open the created decision from their own accounts.</p>
    </section>
    <nav aria-label="Example decision steps"><ol className="ke-guide-nav">{steps.map((label, index) => <li key={label}><button type="button" className="secondary" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span>{label}</button></li>)}</ol></nav>
    <article className="ke-guide-scene" aria-labelledby="guide-scene-title">
      <p className="ke-guide-step-count">Step {step + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} id="guide-scene-title">{steps[step]}</h2>
      {step === 0 && <>
        <p>On <strong>What are we deciding?</strong>, write the shared idea and the options you already have. Keep each person’s preferences for their private answers later.</p>
        <blockquote>“We want to have dinner together on 23 or 24 October 2026. We’re considering Olive Room, Noodle Corner and Garden Table. We need to choose a restaurant and a day.”</blockquote>
        <div className="ke-guide-note"><strong>Next: Continue</strong><p>This opens the Options page. You’ll check and add the actual topics and choices there.</p></div>
        <details><summary>Need help describing the idea?</summary><p>Open <strong>Help me get started</strong>, then choose <strong>Suggest description</strong>. It uses the text you’ve already entered, or asks for a short idea if the field is empty. Read the suggestion and choose <strong>Use this</strong>, <strong>Try again</strong> or <strong>Cancel</strong>. Your description changes only when you choose Use this.</p></details>
      </>}
      {step === 1 && <>
        <p>On <strong>Review your options</strong>, check the suggested <strong>Decision name</strong> or edit it. Then give each topic a clear name and add its options.</p>
        <p>A <strong>topic</strong> is one thing to choose, such as the restaurant. Its <strong>options</strong> are the alternatives, such as Olive Room or Noodle Corner.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Shared decision</span><h3>Dinner together</h3>
          <dl><div><dt>Restaurant</dt><dd>Olive Room · Noodle Corner · Garden Table</dd></div><div><dt>Date</dt><dd>23 October 2026 · 24 October 2026</dd></div><div><dt>People</dt><dd>Alex and Sam</dd></div></dl>
        </div>
        <p>Use <strong>Add option</strong> beneath a topic and <strong>Add another topic</strong> for a separate choice. Remove unwanted rows with the X. For calendar dates, open <strong>More settings</strong> and select <strong>Exact dates</strong>.</p>
        <details><summary>How do suggestions become actual options?</summary><p>Your description is the starting point. Enter the options yourself, or choose <strong>Suggest options</strong>. Suggestions appear separately: choose <strong>Add topic</strong>, <strong>Add options</strong> or <strong>Add</strong> beside an individual suggestion to include it. You can edit the choices before creating the decision. AI help is optional.</p></details>
        <div className="ke-guide-note"><strong>Next: Create decision</strong><p>Check the name, topics and options, then create the decision. Everyone in it adds their own private answers next.</p></div>
        <details><summary>Want to finish the draft later?</summary><p><strong>Save draft</strong> saves it to your group. <strong>Continue draft</strong> reopens a saved draft; <strong>Continue unsaved draft</strong> restores the form kept in this browser. <strong>Start a decision</strong> always opens a blank form. Previously saved drafts stay available.</p></details>
        <p className="ke-guide-disclaimer">These places and dates are made up. Check real prices, availability and other important details before relying on a proposal.</p>
      </>}
      {step === 2 && <>
        <p>Open the decision to see its summary and everyone’s progress. Under <strong>What works for you?</strong>, tick every option you’re happy with for each topic. You can choose several, use <strong>Select all</strong>, or choose <strong>None work for me</strong>.</p>
        <p>A <strong>Favorite</strong> is optional: it means you prefer that choice, while your other selected options still work. You can save your answers before anyone else.</p>
        <div className="ke-guide-personas" role="group" aria-label="View a fictional participant’s perspective">{(['Alex', 'Sam'] as const).map(name => <button key={name} type="button" className="secondary" aria-pressed={participant === name} onClick={() => setParticipant(name)}>See {name}’s answers</button>)}</div>
        <div className="ke-guide-sample ke-guide-private"><span className="ke-guide-view-label">Example private answers · {participant}</span>
          <dl><div><dt>Restaurant · Selected options</dt><dd>{participant === 'Alex' ? 'Olive Room and Noodle Corner' : 'Noodle Corner and Garden Table'}</dd></div>
            <div><dt>Date</dt><dd>{participant === 'Alex' ? '24 October 2026' : '23 and 24 October 2026'}</dd></div>
            <div><dt>Favorite · optional</dt><dd>Noodle Corner</dd></div></dl>
          <p>{participant} leaves extra notes empty, checks the preview data-use acknowledgment, then chooses <strong>Save answers</strong>. Their form collapses into <strong>Your answers</strong>; <strong>Edit answers</strong> lets them change these while the decision is unfinished.</p>
        </div>
        <details><summary>What if the options don’t cover my needs?</summary><p>For an extra requirement, open <strong>Add a requirement with AI · optional</strong>. Write a private note, agree to the preview data use, then choose <strong>Get AI suggestions</strong>. Review the suggested requirements before saving, or clear the note to save only your selected options. If you choose <strong>None work for me</strong>, the group needs other options before it can agree.</p></details>
        <div className="ke-guide-note"><strong>Answers first, approval later.</strong><p>Saving says which options work for you. You’ll approve a specific proposal in the final step.</p></div>
        <p className="ke-guide-disclaimer">Here you can view both example answers. In your own group, you can’t read other people’s private answers. A shared outcome can still hint at what people need.</p>
      </>}
      {step === 3 && <>
        <p>Once everyone required for the decision has saved usable answers, Known Enough starts finding an outcome automatically. There’s no button to press and you can leave the page and return later.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Example progress</span><dl>
          <div><dt>Alex has answered; Sam has not</dt><dd>Collecting answers · 1/2 responded</dd></div>
          <div><dt>Both have answered</dt><dd>Finding an outcome · 2/2 responded</dd></div>
          <div><dt>A proposal is prepared</dt><dd>Proposal ready · View proposal</dd></div>
        </dl></div>
        <p>The app compares their saved answers. Alex and Sam both selected <strong>Noodle Corner</strong> and <strong>24 October 2026</strong>, so that is a possible shared outcome in this example.</p>
        <p>The response count opens participant activity. It shows who has answered or approved, while their answers stay private. Use <strong>Refresh</strong> in the three-dot menu if you need to check the latest progress.</p>
        <details><summary>What if there’s no option that works for everyone?</summary><p>The app may ask for more detail or an optional adjustment, or the group may need different options. Each person decides whether to allow an adjustment or share a private detail. Those choices are separate from approving a proposal.</p></details>
      </>}
      {step === 4 && <>
        <p>Choose <strong>View proposal</strong> to review the specific outcome. Each required participant completes this step from their own account.</p>
        <div className="ke-guide-sample"><span className="ke-guide-view-label">Proposed outcome</span><h3>Dinner together</h3><dl>
          <div><dt>Restaurant</dt><dd>Noodle Corner</dd></div><div><dt>Date</dt><dd>24 October 2026</dd></div>
        </dl></div>
        <ol><li>Check the proposed choices and any details shown only to you.</li><li>Check the acknowledgment that you’ve reviewed this exact proposal.</li><li>Choose <strong>Approve proposal</strong> if you agree.</li></ol>
        <p>Until everyone required approves, the decision is waiting for approvals. After you approve, you’ll see your confirmation and a <strong>Withdraw approval</strong> action.</p>
        <div className="ke-guide-note"><strong>Decision agreed · 2 of 2 approved</strong><p>This is the result after Alex and Sam both approve the same proposal. They can return using <strong>View outcome</strong>. Any booking or purchase is still theirs to arrange.</p></div>
        <details><summary>What if people or answers change?</summary><p>New group members join unfinished decisions automatically and add their own answers; existing answers stay saved. Finished decisions keep their original participants and outcome. A changed proposal needs fresh approvals from everyone required.</p></details>
        <details><summary>Can we talk about it?</summary><p><strong>Chat</strong> opens separately. <strong>Decision chat</strong> is shared with people in this decision; <strong>Private assistant</strong> is for your own conversation. Chat messages don’t save your answers or approve a proposal.</p></details>
      </>}
      <footer className="ke-guide-controls"><button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Previous</button>{step < steps.length - 1 ? <button type="button" onClick={() => setStep(value => value + 1)}>Next: {steps[step + 1]}</button> : <button type="button" onClick={onReturn}>Back to my draft</button>}</footer>
    </article>
    <p className="ke-guide-return-note">Return to your draft whenever you’re ready. This example doesn’t submit anything.</p>
  </section>;
}
