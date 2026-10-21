import { useRef, type ReactNode } from 'react';
import { type ChoicePlan } from '@deal-table/contracts';
import { choicePlanFeedback } from './choice-plan-feedback';
import { PageIcon } from './app-chrome';

export function ChoicePlanEditor({ plan, onChange, busy, saveControls, suggestionControls, suggestions }: {
  plan: ChoicePlan; onChange: (plan: ChoicePlan) => void; busy: boolean;
  saveControls?: ReactNode; suggestionControls?: ReactNode; suggestions?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const feedback = choicePlanFeedback(plan);
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
  return <section ref={root} className="ke-choice-editor ke-options-editor ke-options-step-two" aria-label="Questions and choices">
    <div className="ke-options-name-heading"><label htmlFor="creation-decision-name">Decision name</label>{saveControls}</div>
    <input id="creation-decision-name" maxLength={80} value={plan.title} placeholder="Give this decision a short name" disabled={busy} aria-invalid={!!feedback.titleError} aria-describedby={feedback.titleError ? 'creation-name-error' : undefined} onChange={event => onChange({ ...plan, title: event.target.value })} />
    {feedback.titleError && <p id="creation-name-error" className="ke-choice-field-error">{feedback.titleError}</p>}
    <header className="ke-topics-heading"><div><h2>Questions and choices</h2><p>Give each question a title, then list the choices.</p></div>{suggestionControls}</header>
    {suggestions}
    <div className="ke-choice-topics">{plan.topics.map((topic, index) => {
      const errors = feedback.topics[index]!;
      return <fieldset key={index} disabled={busy} data-topic={index} className="ke-choice-topic ke-option-topic">
      <legend className="ke-sr-only">{topic.label || `Question ${index + 1}`}</legend>
      <div className="ke-option-topic-heading">
        <label htmlFor={`creation-topic-${index}`}><span>Question {index + 1}</span>
          <input id={`creation-topic-${index}`} data-topic-name maxLength={120} value={topic.label} placeholder="e.g. Where should we go?" aria-invalid={!!errors.labelError} aria-describedby={errors.labelError ? `creation-topic-error-${index}` : undefined} onChange={event => change(index, { label: event.target.value })} />
        </label>
        <button type="button" className="ke-text-link ke-topic-remove" title="Remove question" aria-label={`Remove question ${index + 1}${topic.label ? ': ' + topic.label : ''}`} onClick={() => onChange({ ...plan, topics: plan.topics.filter((_topic, at) => at !== index) })}><PageIcon name="X" /></button>
      </div>
      {errors.labelError && <p id={`creation-topic-error-${index}`} className="ke-choice-field-error">{errors.labelError}</p>}
      <span className="ke-topic-options-label">Choices</span>
      <div className="ke-option-list">{topic.options.map((option, at) => {
        const duplicate = errors.duplicates[at], error = errors.choiceErrors[at];
        const fieldId = `creation-option-${index}-${at}`;
        const describedBy = [error ? `${fieldId}-error` : '', duplicate ? `creation-duplicates-${index}` : ''].filter(Boolean).join(' ') || undefined;
        return <div key={at} className="ke-option-entry"><div className="ke-option-row" data-invalid={!!error || duplicate}>
          <label className="ke-sr-only" htmlFor={fieldId}>Choice {at + 1} for {topic.label || `question ${index + 1}`}</label>
          <input id={fieldId} data-option-input value={option} type={topic.kind === 'DATE' ? 'date' : 'text'} maxLength={100} aria-invalid={!!error || duplicate} aria-describedby={describedBy}
            placeholder={topic.kind === 'DATE' ? 'YYYY-MM-DD' : 'Enter a choice'} onChange={event => change(index, { options: topic.options.map((value, oi) => oi === at ? event.target.value : value) })} />
          <button type="button" className="ke-option-remove ke-text-link" title="Remove choice" aria-label={`Remove choice ${at + 1} for ${topic.label || `question ${index + 1}`}`} onClick={() => change(index, { options: topic.options.filter((_value, oi) => oi !== at) })}><PageIcon name="X" /></button>
        </div>{error && <p id={`${fieldId}-error`} className="ke-choice-field-error">{error}</p>}</div>;
      })}</div>
      {errors.duplicates.some(Boolean) && <p id={`creation-duplicates-${index}`} className="ke-choice-field-error">Each choice must be different. Edit or remove the highlighted repeats.</p>}
      {errors.choicesError && <p id={`creation-choices-error-${index}`} className="ke-choice-field-error">{errors.choicesError}</p>}
      <div className="ke-topic-tools"><button id={`creation-add-choice-${index}`} type="button" className="ke-add-option ke-text-link ke-icon-action" disabled={busy || topic.options.length >= 16} aria-describedby={errors.choicesError ? `creation-choices-error-${index}` : undefined} onClick={() => addOption(index)}><PageIcon name="Plus" />Add choice</button>
        <details className="ke-topic-settings"><summary>More settings</summary><div className="ke-choice-topic-fields">
          <label>Choice format<select value={topic.kind} onChange={event => change(index, { kind: event.target.value as 'CHOICE' | 'DATE' })}>
            <option value="CHOICE">Text choices</option><option value="DATE">Exact dates</option></select></label>
        </div></details>
      </div>
    </fieldset>; })}</div>
    <button id="creation-add-question" type="button" className="ke-add-topic secondary ke-icon-action" disabled={busy || plan.topics.length >= 6} onClick={addTopic}><PageIcon name="Plus" />Add question</button>
    <details className="ke-creation-details ke-options-description"><summary>Shared description</summary><label className="ke-sr-only" htmlFor="choice-description">Shared description</label>
      <textarea id="choice-description" rows={3} maxLength={1000} value={plan.description} disabled={busy} aria-invalid={!!feedback.descriptionError} aria-describedby={feedback.descriptionError ? 'creation-description-error' : undefined} onChange={event => onChange({ ...plan, description: event.target.value })} />
      {feedback.descriptionError && <p id="creation-description-error" className="ke-choice-field-error">{feedback.descriptionError}</p>}</details>
  </section>;
}
