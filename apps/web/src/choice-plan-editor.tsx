import { useRef, type ReactNode } from 'react';
import { compileChoicePlan, type ChoicePlan } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';

export function ChoicePlanEditor({ plan, onChange, busy, saveControls, suggestionControls, suggestions }: {
  plan: ChoicePlan; onChange: (plan: ChoicePlan) => void; busy: boolean;
  saveControls?: ReactNode; suggestionControls?: ReactNode; suggestions?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const compiled = compileChoicePlan(plan);
  const change = (index: number, patch: Partial<ChoicePlan['topics'][number]>) => onChange({ ...plan,
    topics: plan.topics.map((topic, at) => at === index ? { ...topic, ...patch } : topic) });
  function addOption(index: number) {
    const topic = plan.topics[index]!;
    if (busy || topic.options.length >= 16) return;
    change(index, { options: [...topic.options, ''] });
    requestAnimationFrame(() => {
      const inputs = root.current?.querySelectorAll<HTMLInputElement>(`[data-topic="${index}"] [data-option-input]`);
      const input = inputs?.[inputs.length - 1]; input?.focus(); input?.scrollIntoView({ block: 'nearest' });
    });
  }
  function addTopic() {
    if (busy || plan.topics.length >= 6) return;
    onChange({ ...plan, topics: [...plan.topics, { label: '', kind: 'CHOICE', options: [] }] });
    requestAnimationFrame(() => {
      const input = root.current?.querySelector<HTMLInputElement>(`[data-topic="${plan.topics.length}"] [data-topic-name]`);
      input?.focus(); input?.scrollIntoView({ block: 'center' });
    });
  }
  const hasOptions = plan.topics.some(topic => topic.options.length);
  return <section ref={root} className="ke-choice-editor ke-options-editor ke-options-step-two" aria-label="Decision options">
    <div className="ke-options-name-heading"><label htmlFor="creation-decision-name">Decision name</label>{saveControls}</div>
    <input id="creation-decision-name" maxLength={80} value={plan.title} placeholder="Give this decision a short name" disabled={busy} onChange={event => onChange({ ...plan, title: event.target.value })} />
    <header className="ke-topics-heading"><div><h2>Topics</h2><p>What does your group need to decide? Add the options for each topic.</p></div>{suggestionControls}</header>
    {suggestions}
    <div className="ke-choice-topics">{plan.topics.map((topic, index) => <fieldset key={index} disabled={busy} data-topic={index} className="ke-choice-topic ke-option-topic">
      <legend className="ke-sr-only">{topic.label || `Topic ${index + 1}`}</legend>
      <div className="ke-option-topic-heading">
        <label htmlFor={`creation-topic-${index}`}><span>Topic name</span>
          <input id={`creation-topic-${index}`} data-topic-name maxLength={120} value={topic.label} placeholder="e.g. Place, day or budget" onChange={event => change(index, { label: event.target.value })} />
        </label>
        <button type="button" className="ke-text-link ke-topic-remove" title={`Remove topic${topic.label ? ': ' + topic.label : ''}`} aria-label="Remove topic" onClick={() => onChange({ ...plan, topics: plan.topics.filter((_topic, at) => at !== index) })}><PageIcon name="X" /></button>
      </div>
      <span className="ke-topic-options-label">Options</span>
      <div className="ke-option-list">{topic.options.map((option, at) => {
        const duplicate = !!option.trim() && topic.options.some((value, other) => other !== at && value.trim().toLocaleLowerCase() === option.trim().toLocaleLowerCase());
        const fieldId = `creation-option-${index}-${at}`;
        return <div key={at} className="ke-option-entry"><div className="ke-option-row">
          <label className="ke-sr-only" htmlFor={fieldId}>Option {at + 1} for {topic.label || `topic ${index + 1}`}</label>
          <input id={fieldId} data-option-input value={option} type={topic.kind === 'DATE' ? 'date' : 'text'} maxLength={100} aria-invalid={!option.trim() || duplicate}
            placeholder={topic.kind === 'DATE' ? 'YYYY-MM-DD' : 'Name this option'} onChange={event => change(index, { options: topic.options.map((value, oi) => oi === at ? event.target.value : value) })} />
          <button type="button" className="ke-option-remove ke-text-link" title="Remove option" aria-label={`Remove option ${at + 1} for ${topic.label}`} onClick={() => change(index, { options: topic.options.filter((_value, oi) => oi !== at) })}><PageIcon name="X" /><span className="ke-sr-only">Remove</span></button>
        </div>{duplicate && <small role="alert">This option is already listed.</small>}{!option.trim() && <small>Add a value for this option, or remove it.</small>}</div>;
      })}</div>
      <div className="ke-topic-tools"><button type="button" className="ke-add-option ke-text-link ke-icon-action" disabled={busy || topic.options.length >= 16} onClick={() => addOption(index)}><PageIcon name="Plus" />Add option</button>
        <details className="ke-topic-settings"><summary>More settings</summary><div className="ke-choice-topic-fields">
          <label>Options format<select value={topic.kind} onChange={event => change(index, { kind: event.target.value as 'CHOICE' | 'DATE' })}>
            <option value="CHOICE">Text options</option><option value="DATE">Exact dates</option></select></label>
        </div></details>
      </div>
    </fieldset>)}</div>
    <button type="button" className="ke-add-topic secondary ke-icon-action" disabled={busy || plan.topics.length >= 6} onClick={addTopic}><PageIcon name="Plus" />{plan.topics.length ? 'Add another topic' : 'Add a topic'}</button>
    {hasOptions && compiled.questions.length > 0 && <div className="ke-options-validation" role="status">{compiled.questions.map(question => <p key={question}>{question.includes('combinations') ? 'There are too many options to compare together. Remove some options or split this into separate decisions.' : question}</p>)}</div>}
    <details className="ke-creation-details ke-options-description"><summary>Shared description</summary><label className="ke-sr-only" htmlFor="choice-description">Shared description</label>
      <textarea id="choice-description" rows={3} maxLength={1000} value={plan.description} disabled={busy} onChange={event => onChange({ ...plan, description: event.target.value })} /></details>
  </section>;
}
