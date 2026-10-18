import { useRef } from 'react';
import { compileChoicePlan, type ChoicePlan } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';

export function ChoicePlanEditor({ plan, onChange, busy }: {
  plan: ChoicePlan; onChange: (plan: ChoicePlan) => void; busy: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const compiled = compileChoicePlan(plan);
  const change = (index: number, patch: Partial<ChoicePlan['topics'][number]>) => onChange({ ...plan,
    topics: plan.topics.map((topic, at) => at === index ? { ...topic, ...patch } : topic) });
  function addOption(index: number) {
    const topic = plan.topics[index]!;
    change(index, { options: [...topic.options, ''] });
    requestAnimationFrame(() => {
      const inputs = root.current?.querySelectorAll<HTMLInputElement>(`[data-topic="${index}"] [data-option-input]`);
      inputs?.[inputs.length - 1]?.focus();
    });
  }
  const hasOptions = plan.topics.some(topic => topic.options.length);
  return <section ref={root} className="ke-choice-editor ke-options-editor" aria-label="Decision options">
    <label>Decision name<input maxLength={80} value={plan.title} disabled={busy} onChange={event => onChange({ ...plan, title: event.target.value })} /></label>
    <details className="ke-creation-details"><summary>Shared description</summary><label className="ke-sr-only" htmlFor="choice-description">Shared description</label>
      <textarea id="choice-description" rows={3} maxLength={1000} value={plan.description} disabled={busy} onChange={event => onChange({ ...plan, description: event.target.value })} /></details>
    {!hasOptions && <div className="ke-options-empty"><h3>No options added yet</h3><p>Add your own options or get suggestions to explore what’s possible.</p></div>}
    <div className="ke-choice-topics">{plan.topics.map((topic, index) => <fieldset key={index} disabled={busy} data-topic={index} className="ke-choice-topic ke-option-topic">
      <legend className="ke-sr-only">{topic.label || `Topic ${index + 1}`}</legend>
      <div className="ke-option-topic-heading"><h3>{topic.label || 'New topic'}</h3>
        <details><summary>Topic details</summary><div className="ke-choice-topic-fields">
          <label>Topic name<input maxLength={120} value={topic.label} onChange={event => change(index, { label: event.target.value })} /></label>
          <label>Options format<select value={topic.kind} onChange={event => change(index, { kind: event.target.value as 'CHOICE' | 'DATE' })}>
            <option value="CHOICE">Names</option><option value="DATE">Exact dates</option></select></label>
          <button type="button" className="ke-text-link" onClick={() => onChange({ ...plan, topics: plan.topics.filter((_topic, at) => at !== index) })}>Remove topic</button>
        </div></details>
      </div>
      <div className="ke-option-list">{topic.options.map((option, at) => {
        const duplicate = !!option.trim() && topic.options.some((value, other) => other !== at && value.trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase());
        const fieldId = `creation-option-${index}-${at}`;
        return <div key={at} className="ke-option-entry"><div className="ke-option-row">
          <label className="ke-sr-only" htmlFor={fieldId}>Option {at + 1} for {topic.label || `topic ${index + 1}`}</label>
          <input id={fieldId} data-option-input value={option} type={topic.kind === 'DATE' ? 'date' : 'text'} maxLength={100} aria-invalid={!option.trim() || duplicate}
            placeholder={topic.kind === 'DATE' ? 'YYYY-MM-DD' : 'Name this option'} onChange={event => change(index, { options: topic.options.map((value, oi) => oi === at ? event.target.value : value) })} />
          <button type="button" className="ke-option-edit ke-text-link" aria-label={`Edit option ${at + 1} for ${topic.label}`} onClick={() => { const input = document.getElementById(fieldId) as HTMLInputElement | null; input?.focus(); if (topic.kind !== 'DATE') input?.select(); }}><PageIcon name="Pencil" /><span>Edit</span></button>
          <button type="button" className="ke-option-remove ke-text-link" aria-label={`Remove option ${at + 1} for ${topic.label}`} onClick={() => change(index, { options: topic.options.filter((_value, oi) => oi !== at) })}><PageIcon name="X" /><span className="ke-sr-only">Remove</span></button>
        </div>{duplicate && <small role="alert">This option is already listed.</small>}{!option.trim() && <small>Name this option or remove it.</small>}</div>;
      })}</div>
      {topic.kind === 'DATE' && <small>Choose the dates your group will consider.</small>}
      <button type="button" className="ke-text-link ke-icon-action" disabled={busy || topic.options.length >= 16} onClick={() => addOption(index)}><PageIcon name="Plus" />Add option</button>
    </fieldset>)}</div>
    <button type="button" className="ke-text-link" disabled={busy || plan.topics.length >= 6} onClick={() => onChange({ ...plan,
      topics: [...plan.topics, { label: 'Another topic', kind: 'CHOICE', options: [] }] })}>{plan.topics.length ? 'Add another topic' : 'Add a topic'}</button>
    {hasOptions && compiled.questions.length > 0 && <div className="ke-options-validation" role="status">{compiled.questions.map(question => <p key={question}>{question.includes('combinations') ? 'There are too many options to compare together. Remove some options or split this into separate decisions.' : question}</p>)}</div>}
  </section>;
}
