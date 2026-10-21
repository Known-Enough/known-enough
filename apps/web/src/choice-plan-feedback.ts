import { ChoicePlan, compileChoicePlan, KnownEnough as KE } from '@deal-table/contracts';

export type CreationIssue = { fieldId: string; message: string };
export function choicePlanFeedback(plan: ChoicePlan) {
  const issues: CreationIssue[] = [];
  const titleError = plan.title.length > 80 ? 'Use 80 characters or fewer.' : undefined;
  const descriptionError = plan.description.length > 1000 ? 'Keep the shared description within 1,000 characters.' : undefined;
  if (titleError) issues.push({ fieldId: 'creation-decision-name', message: `Decision name: ${titleError}` });
  if (!plan.topics.length) issues.push({ fieldId: 'creation-add-question', message: 'Add a question and at least one choice.' });
  if (plan.topics.length > 6) issues.push({ fieldId: 'creation-topic-6', message: 'Keep this decision to six questions or fewer.' });
  const topics = plan.topics.map((topic, index) => {
    const context = `Question ${index + 1}`;
    const labelError = !topic.label.trim() ? 'Enter a question title.' : topic.label.length > 120 ? 'Use 120 characters or fewer.' : undefined;
    if (labelError) issues.push({ fieldId: `creation-topic-${index}`, message: `${context}: ${labelError}` });
    const choicesError = !topic.options.length ? 'Add at least one choice.' : topic.options.length > 16 ? 'Keep this question to 16 choices or fewer.' : undefined;
    if (choicesError) issues.push({ fieldId: topic.options.length > 16 ? `creation-option-${index}-16` : `creation-add-choice-${index}`, message: `${context}: ${choicesError}` });
    // Match the shared compiler's trimming, case handling and date validation.
    const values = topic.options.map(option => option.trim().toLowerCase());
    const duplicates = values.map((value, at) => !!value && values.some((other, oi) => oi !== at && other === value));
    const choiceErrors = topic.options.map((option, at) => {
      const message = !option.trim() ? 'Enter a choice or remove this row.' : option.length > 100 ? 'Use 100 characters or fewer.'
        : topic.kind === 'DATE' && !KE.DecisionValue.safeParse({ type: 'DATE', date: option.trim() }).success ? 'Choose a valid calendar date.' : undefined;
      if (message) issues.push({ fieldId: `creation-option-${index}-${at}`, message: `${context}, choice ${at + 1}: ${message}` });
      return message;
    });
    if (duplicates.some(Boolean)) issues.push({ fieldId: `creation-option-${index}-${duplicates.indexOf(true)}`, message: `${context}: edit or remove the repeated choices.` });
    return { labelError, choicesError, choiceErrors, duplicates };
  });
  if (descriptionError) issues.push({ fieldId: 'choice-description', message: descriptionError });
  const compiled = compileChoicePlan(plan), schema = ChoicePlan.safeParse(plan);
  if (compiled.combinations > 64) issues.push({ fieldId: 'creation-topic-0', message: 'There are too many choices to compare together. Remove some choices or split this into separate decisions.' });
  if ((!schema.success || compiled.questions.length > 0) && !issues.length) issues.push({ fieldId: 'creation-decision-name', message: 'Check the highlighted questions and choices before creating the decision.' });
  return { issues, topics, titleError, descriptionError, valid: schema.success && compiled.questions.length === 0 && issues.length === 0 };
}
