import { useState } from 'react';
import { type ChoicePlan } from '@deal-table/contracts';
import { addSuggestedOption, type CreationSuggestion } from './creation-options';
import { PageIcon } from './app-chrome';

export function CreationSuggestions({ review, plan, busy, onChange, onAdd, onUseDescription, onUseLegacyDraft, onDismiss, onFollowUp }: {
  review: CreationSuggestion; plan: ChoicePlan; busy: boolean;
  onChange: (review: CreationSuggestion) => void;
  onAdd: (topic: ChoicePlan['topics'][number], option: string) => void;
  onUseDescription: () => void; onUseLegacyDraft: () => void; onDismiss: () => void; onFollowUp: (answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const questions = review.draft.clarificationQuestions;
  return <section className="ke-creation-suggestions" aria-label={review.intent === 'description' ? 'Suggested description' : 'Suggested options'}>
    <header><h3><PageIcon name="Sparkles" />{review.intent === 'description' ? 'A starting point' : 'Suggestions to consider'}</h3>
      <button type="button" className="ke-text-link" disabled={busy} onClick={onDismiss}>Dismiss suggestions</button></header>
    <p className="ke-creation-hint">Suggested by AI. Check names, dates and availability before using them.</p>
    {!review.draft.choicePlan && review.intent === 'options' && <div className="ke-legacy-suggestion"><p className="ke-creation-hint">This saved draft keeps its options and group requirements together.</p><button type="button" className="secondary" disabled={busy} onClick={onUseLegacyDraft}>Use this saved draft</button></div>}
    {review.intent === 'description' ? <>
      <label>Suggested description<textarea rows={4} maxLength={2000} value={review.description} disabled={busy}
        onChange={event => onChange({ ...review, description: event.target.value })} /></label>
      <button type="button" className="secondary" disabled={busy || !review.description.trim()} onClick={onUseDescription}>Use this description</button>
    </> : review.plan.topics.map((topic, index) => <section key={index} className="ke-suggestion-topic" aria-label={`Suggestions for ${topic.label || 'your decision'}`}>
      <h4>{topic.label || 'Options'}</h4>
      {topic.options.map((option, at) => <div className="ke-suggestion-row" key={at}>
        <label className="ke-sr-only" htmlFor={`suggestion-${index}-${at}`}>Suggested option {at + 1} for {topic.label}</label>
        <input id={`suggestion-${index}-${at}`} maxLength={100} value={option} disabled={busy} onChange={event => onChange({ ...review,
          plan: { ...review.plan, topics: review.plan.topics.map((item, ti) => ti === index ? { ...item, options: item.options.map((value, oi) => oi === at ? event.target.value : value) } : item) } })} />
        <button type="button" className="ke-text-link" disabled={busy || !addSuggestedOption(plan, topic, option)} onClick={() => onAdd(topic, option)} aria-label={`Add suggestion ${option}`}>Add</button>
        <button type="button" className="ke-text-link" disabled={busy} aria-label={`Dismiss suggestion ${option}`} onClick={() => onChange({ ...review,
          plan: { ...review.plan, topics: review.plan.topics.map((item, ti) => ti === index ? { ...item, options: item.options.filter((_value, oi) => oi !== at) } : item) } })}>Dismiss</button>
      </div>)}
      {!topic.options.length && <p className="ke-creation-hint">No more suggestions for this topic. You can add your own options above.</p>}
    </section>)}
    {!!questions.length && <details className="ke-creation-details"><summary>A few details are missing</summary>
      <p className="ke-creation-hint">Answer what you know, or edit your options directly. Keep personal preferences for later.</p>
      {questions.map((question, index) => <label key={question}>{question}<textarea rows={2} maxLength={500} disabled={busy} value={answers[index] ?? ''}
        onChange={event => setAnswers(current => ({ ...current, [index]: event.target.value }))} /></label>)}
      <button type="button" className="secondary" disabled={busy || questions.some((_q, i) => !answers[i]?.trim())} onClick={() => onFollowUp(questions.map((_q, i) => answers[i]!.trim()))}>Update suggestions</button>
    </details>}
  </section>;
}
