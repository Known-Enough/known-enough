import { useState } from 'react';
import { type ChoicePlan } from '@deal-table/contracts';
import { addSuggestedOption, addSuggestedTopic, suggestedDecisionTitle, type CreationSuggestion } from './creation-options';
import { PageIcon } from './app-chrome';

export function CreationSuggestions({ review, plan, busy, onChange, onAdd, onAddTopic, onUseTitle, onUseDescription, onUseLegacyDraft, onDismiss, onFollowUp, onRetry, retryDisabled = false }: {
  review: CreationSuggestion; plan: ChoicePlan; busy: boolean;
  onChange: (review: CreationSuggestion) => void;
  onRetry?: () => void; retryDisabled?: boolean;
  onAdd: (topic: ChoicePlan['topics'][number], option: string) => void;
  onAddTopic?: (topic: ChoicePlan['topics'][number]) => void; onUseTitle?: (title: string) => void;
  onUseDescription: () => void; onUseLegacyDraft: () => void; onDismiss: () => void; onFollowUp: (answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const questions = review.draft.clarificationQuestions;
  const suggestedTitle = suggestedDecisionTitle(review.plan.title || review.draft.frame.title);
  const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  return <section className="ke-creation-suggestions" data-intent={review.intent} aria-label={review.intent === 'description' ? 'Suggested description' : 'Suggested questions and choices'}>
    <header><h3 tabIndex={-1}><PageIcon name="Sparkles" />{review.intent === 'description' ? 'Suggested description' : 'Suggested questions and choices'}</h3>
      {review.intent !== 'description' && <button type="button" className="ke-text-link" disabled={busy} onClick={onDismiss}>Dismiss suggestions</button>}</header>
    {review.intent !== 'description' && <p className="ke-creation-hint">Add the questions or choices you want to use. Your work stays in place.</p>}
    {review.intent === 'options' && onUseTitle && suggestedTitle !== 'New decision' && suggestedTitle !== plan.title && <div className="ke-suggestion-name"><span><small>Suggested name</small><strong>{suggestedTitle}</strong></span>
      <button type="button" className="secondary" disabled={busy} onClick={() => onUseTitle(suggestedTitle)}>Use name</button></div>}
    {!review.draft.choicePlan && review.intent === 'options' && <div className="ke-legacy-suggestion"><p className="ke-creation-hint">This saved draft keeps its choices and group requirements together.</p><button type="button" className="secondary" disabled={busy} onClick={onUseLegacyDraft}>Use this saved draft</button></div>}
    {review.intent === 'description' ? <>
      <label className="ke-description-result-label">Edit the suggestion if you like<textarea data-description-suggestion rows={3} maxLength={2000} value={review.description} disabled={busy}
        onChange={event => onChange({ ...review, description: event.target.value })} /></label>
      <div className="ke-description-assistance-actions"><button type="button" disabled={busy || !review.description.trim()} onClick={onUseDescription}>Use this</button>
        {onRetry && <button type="button" className="secondary" disabled={busy || retryDisabled} onClick={onRetry}>Try again</button>}
        <button type="button" className="ke-text-link" disabled={busy} onClick={onDismiss}>Cancel</button></div>
    </> : review.plan.topics.map((topic, index) => {
      const savedTopic = plan.topics.find(item => normalized(item.label) === normalized(topic.label) && item.kind === topic.kind);
      const choiceAdded = (option: string) => !!option.trim() && !!savedTopic?.options.some(saved => normalized(saved) === normalized(option));
      const allAdded = topic.options.length > 0 && topic.options.every(choiceAdded);
      return <section key={index} className="ke-suggestion-topic" aria-label={`Suggestions for ${topic.label || 'your decision'}`}>
      <div className="ke-suggestion-topic-heading"><h4>{topic.label || 'Choices'}</h4>
        {onAddTopic && <button type="button" className="secondary" disabled={busy || !addSuggestedTopic(plan, topic)} aria-label={`${allAdded ? 'Added' : 'Add'} suggested question and choices: ${topic.label}`} onClick={() => onAddTopic(topic)}><PageIcon name={allAdded ? 'Check' : 'Plus'} />{allAdded ? 'Added' : savedTopic ? 'Add choices' : 'Add question'}</button>}
      </div>
      {topic.options.map((option, at) => <div className="ke-suggestion-row" key={at}>
        <label className="ke-sr-only" htmlFor={`suggestion-${index}-${at}`}>Suggested choice {at + 1} for {topic.label}</label>
        <input id={`suggestion-${index}-${at}`} maxLength={100} value={option} disabled={busy} onChange={event => onChange({ ...review,
          plan: { ...review.plan, topics: review.plan.topics.map((item, ti) => ti === index ? { ...item, options: item.options.map((value, oi) => oi === at ? event.target.value : value) } : item) } })} />
        <button type="button" className="ke-text-link" disabled={busy || !addSuggestedOption(plan, topic, option)} onClick={() => onAdd(topic, option)} aria-label={`${choiceAdded(option) ? 'Added' : 'Add'} suggested choice: ${option}`}>{choiceAdded(option) ? 'Added' : 'Add choice'}</button>
        <button type="button" className="ke-text-link ke-suggestion-dismiss" disabled={busy} title="Dismiss choice" aria-label={`Dismiss suggestion ${option}`} onClick={() => onChange({ ...review,
          plan: { ...review.plan, topics: review.plan.topics.map((item, ti) => ti === index ? { ...item, options: item.options.filter((_value, oi) => oi !== at) } : item) } })}><PageIcon name="X" /></button>
      </div>)}
      {!topic.options.length && <p className="ke-creation-hint">No choices suggested for this question yet. You can add your own below.</p>}
    </section>; })}
    {review.intent === 'options' && !review.plan.topics.length && <p className="ke-creation-hint">No questions or choices were suggested. You can add your own below.</p>}
    {!!questions.length && <details className="ke-creation-details" open={review.plan.topics.every(topic => !topic.options.length) || undefined}><summary>A few details are missing</summary>
      <p className="ke-creation-hint">Answer what you know, or edit your choices directly. Keep personal preferences for later.</p>
      {questions.map((question, index) => <label key={question}>{question}<textarea rows={2} maxLength={500} disabled={busy} value={answers[index] ?? ''}
        onChange={event => setAnswers(current => ({ ...current, [index]: event.target.value }))} /></label>)}
      <button type="button" className="secondary" disabled={busy || questions.some((_q, i) => !answers[i]?.trim())} onClick={() => onFollowUp(questions.map((_q, i) => answers[i]!.trim()))}>Update suggestions</button>
    </details>}
  </section>;
}
