import { compileChoicePlan, type ChoicePlan } from '@deal-table/contracts';
export function ChoicePlanEditor({ plan, onChange, busy }: {
  plan: ChoicePlan; onChange: (plan: ChoicePlan) => void; busy: boolean;
}) {
  const compiled = compileChoicePlan(plan);
  const change = (index: number, patch: Partial<ChoicePlan['topics'][number]>) => onChange({ ...plan,
    topics: plan.topics.map((topic, at) => at === index ? { ...topic, ...patch } : topic) });
  return <section className="ke-choice-editor" aria-labelledby="choice-editor-title">
    <h3 id="choice-editor-title" className="ke-sr-only">Your decision choices</h3>
    <label>Decision name<input maxLength={80} value={plan.title} disabled={busy} onChange={event => onChange({ ...plan, title: event.target.value })} /></label>
    <details><summary>Shared description</summary><textarea maxLength={1000} value={plan.description} disabled={busy} onChange={event => onChange({ ...plan, description: event.target.value })} /></details>
    <div className="ke-choice-topics">{plan.topics.map((topic, index) => <fieldset key={index} disabled={busy} className="ke-choice-topic">
      <legend>Choice {index + 1}</legend>
      <div className="ke-choice-topic-fields">
      <label>What are you choosing?<input maxLength={120} value={topic.label} onChange={event => change(index, { label: event.target.value })} placeholder="For example: destination, date, activity or product" /></label>
      <label>Type<select value={topic.kind} onChange={event => change(index, { kind: event.target.value as 'CHOICE' | 'DATE' })}>
        <option value="CHOICE">Named options</option><option value="DATE">Exact dates</option></select></label>
      </div>
      <label>Which options are you considering? One per line<textarea maxLength={1616} value={topic.options.join('\n')} onChange={event => change(index, { options: event.target.value.split('\n') })}
        placeholder={topic.kind === 'DATE' ? '2026-10-23\n2026-10-24' : 'First option\nSecond option\nAnother option'} /></label>
      <small>{topic.kind === 'DATE' ? 'Use YYYY-MM-DD. If the date is uncertain, use named options instead.' : 'Use up to 16 options, each up to 100 characters. People give their preferences privately later.'}</small>
      <button type="button" className="ke-text-link" onClick={() => onChange({ ...plan, topics: plan.topics.filter((_topic, at) => at !== index) })}>Remove this choice</button>
    </fieldset>)}</div>
    <button type="button" className="secondary" disabled={busy || plan.topics.length >= 6} onClick={() => onChange({ ...plan, topics: [...plan.topics, { label: '', kind: 'CHOICE', options: [] }] })}>Add a choice</button>
    {!!compiled.questions.length && <aside className="ke-wizard-save" role="status"><strong>Let’s fill in these details</strong><ul>{compiled.questions.map(question => <li key={question}>{question}</li>)}</ul><p>Answer by editing the fields above. Your draft stays here.</p></aside>}
    {!compiled.questions.length && <p className="ke-wizard-help">Your choices are ready. Everyone adds their answers privately after creation.</p>}
  </section>;
}

export function ChoicePlanActions({ busy, saved, ready, onSave, onCreate, onAI, onBack }: {
  busy: boolean; saved: boolean; ready: boolean; onSave: () => void; onCreate: () => void; onAI?: () => void; onBack: () => void;
}) {
  return <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy} onClick={onBack}>Back to my idea</button>
      <button type="button" className="secondary" disabled={busy || saved} onClick={onSave}>Save draft</button>
      <button type="button" disabled={busy || !ready} onClick={onCreate}>Create decision</button>
      {onAI && <button type="button" className="ke-text-link" disabled={busy} onClick={onAI}>Ask AI to help with missing details</button>}
    </div>;
}
