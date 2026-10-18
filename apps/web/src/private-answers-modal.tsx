import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KnownEnough as KE, publicChoiceOptions } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';

type Answer = { mode: KE.PrivateChoiceAnswer['mode'] | ''; acceptable: number[]; preferred: string };
type Payload = Extract<KE.DecisionCommand, { type: 'CONFIRM_PRIVATE_ANSWERS' }>['payload'];
type Condition = KE.AIConstraintDraft['proposedConstraints'][number];
const direct = (id: string) => id.startsWith('answer-');
export function PrivateAnswersModal({ open, owner, busy, blocked, saveBlocked, notesLocked, notes, consent, notice, recovery,
  onClose, onNotes, onConsent, onInterpret, onSave, onDirty, describeValue, describeCondition, embedded = false }: {
  embedded?: boolean; open: boolean; owner: KE.OwnerDecisionSnapshot; busy: boolean; blocked: boolean; saveBlocked: boolean; notesLocked: boolean;
  notes: string; consent: boolean; notice: string; recovery: ReactNode;
  onClose: () => void; onNotes: (value: string) => void; onConsent: (value: boolean) => void;
  onInterpret: () => Promise<void>; onSave: (payload: Payload) => Promise<boolean>;
  onDirty: (value: boolean) => void;
  describeValue: (value: KE.DecisionValue, variable: KE.PublicDecisionFrame['variables'][number]) => string;
  describeCondition: (condition: Condition) => string;
}) {
  const frame = owner.publicSnapshot.frame;
  const choiceFrameKey = frame.contextToken + ':' + frame.frameVersion;
  const questions = useMemo(() => frame.variables.filter(variable => variable.visibility === 'PUBLIC').flatMap(variable => {
    const options = publicChoiceOptions(frame, variable);
    return options ? [{ variable, options }] : [];
  }), [frame]);
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [retained, setRetained] = useState<string[]>([]);
  const [included, setIncluded] = useState<string[]>([]);
  const [replaceDraft, setReplaceDraft] = useState(false);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveGuard = useRef(false);
  const [frameChanged, setFrameChanged] = useState(false);
  const boundContext = useRef(choiceFrameKey);
  const draftExtras = owner.draft?.proposedConstraints.filter(item => !direct(item.constraintId)) ?? [];
  const unresolvedExtras = owner.draft?.unsupportedConditions.filter(item => !direct(item.id)) ?? [];
  const onlyDirectDraft = !!owner.draft && !draftExtras.length && !unresolvedExtras.length;
  const extras = owner.confirmedConstraints.filter(item => item.status === 'ACTIVE' && !direct(item.constraintId));
  useEffect(() => {
    const active = [...owner.confirmedConstraints.filter(item => item.status === 'ACTIVE' && direct(item.constraintId)),
      ...(owner.draft?.proposedConstraints.filter(item => direct(item.constraintId)) ?? [])];
    const next: Record<string, Answer> = {};
    for (const { variable, options } of questions) {
      const limit = active.find(item => item.kind !== 'PREFERENCE' && item.rule.operator === 'IN' && item.rule.variableId === variable.id);
      const favourite = active.find(item => item.kind === 'PREFERENCE' && item.preference.variableId === variable.id);
      const acceptable = limit && limit.kind !== 'PREFERENCE' && limit.rule.operator === 'IN'
        ? options.flatMap((option, index) => limit.rule.operator === 'IN' && limit.rule.values.some(value => JSON.stringify(value) === JSON.stringify(option)) ? [index] : []) : [];
      const preferred = favourite?.kind === 'PREFERENCE' ? options.findIndex(option => JSON.stringify(option) === JSON.stringify(favourite.preference.value)) : -1;
      const noneSaved = owner.draft?.unsupportedConditions.some(item => direct(item.id)
        && item.clarificationQuestion === `None of the listed options for ${variable.label} work. Additional shared options are needed.`);
      next[variable.id] = { mode: noneSaved ? 'NONE' : limit ? 'SELECTED' : favourite || owner.ownInputReadiness === 'READY' ? 'ANY' : '', acceptable,
        preferred: preferred >= 0 ? String(preferred) : '' };
    }
    setAnswers(next); setRetained(owner.confirmedConstraints.filter(item => item.status === 'ACTIVE' && !direct(item.constraintId)).map(item => item.constraintId));

    if (boundContext.current !== choiceFrameKey) { setFrameChanged(true); boundContext.current = choiceFrameKey; }
    // Bind indices to this exact frame; a refreshed AI draft must not reset direct answers.
  }, [choiceFrameKey]);
  useEffect(() => { setIncluded([]); setReplaceDraft(false);  }, [owner.draft?.draftId]);
  useEffect(() => { onDirty(changed || !!notes.trim()); }, [changed, notes, onDirty]);
  useEffect(() => {
    if (embedded) return;
    const element = dialog.current;
    if (!open) { element?.close(); return; }
    const previous = document.activeElement;
    if (element && !element.open) element.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; heading.current?.focus();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open, embedded]);
  function update(id: string, next: Answer) { setAnswers(current => ({ ...current, [id]: next })); setChanged(true); }
  function selectedOptions(answer: Answer, length: number) {
    return answer.mode === 'ANY' ? Array.from({ length }, (_value, index) => index) : answer.mode === 'SELECTED' ? answer.acceptable : [];
  }
  function chooseOptions(id: string, answer: Answer, selected: number[], total: number) {
    update(id, { mode: selected.length === total ? 'ANY' : selected.length ? 'SELECTED' : '',
      acceptable: selected, preferred: answer.preferred !== '' && selected.includes(Number(answer.preferred)) ? answer.preferred : '' });
  }
  const complete = questions.every(({ variable }) => {
    const answer = answers[variable.id];
    return answer && !!answer.mode && (answer.mode !== 'SELECTED' || answer.acceptable.length > 0);
  });
  function label(value: KE.DecisionValue, variable: KE.PublicDecisionFrame['variables'][number]) {
    return value.type === 'DATE' ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.date + 'T00:00:00Z')) : describeValue(value, variable);
  }
  async function save() {
    if (saveGuard.current || blocked || saveBlocked || !complete || !consent || notes.trim()) return;
    const payload: Payload = { processingConsent: 'SYNTHETIC_TEST', retainedConstraintIds: retained,
      answers: questions.map(({ variable }) => {
        const answer = answers[variable.id]!;
        return { variableId: variable.id, mode: answer.mode as KE.PrivateChoiceAnswer['mode'],
          acceptableIndices: answer.mode === 'SELECTED' ? answer.acceptable : [],
          ...(answer.preferred !== '' && answer.mode !== 'NONE' ? { preferredIndex: Number(answer.preferred) } : {}) };
      }), ...(owner.draft ? { draft: { draftId: owner.draft.draftId, draftVersion: owner.draft.draftVersion,
        constraintIds: replaceDraft || onlyDirectDraft ? [] : included, replace: replaceDraft || onlyDirectDraft } } : {}) };
    saveGuard.current = true; setSaving(true);
    try { if (await onSave(payload)) { setChanged(false); onDirty(false); if (!embedded) onClose(); } }
    finally { saveGuard.current = false; setSaving(false); }
  }
  const saveHint = !complete ? 'Select at least one option for each topic, or choose “None work for me”.'
    : !consent ? 'Confirm the processing consent to save your answers.'
    : notes.trim() ? 'Review your notes with AI, or clear them to save just your selections.'
    : 'Saving your answers does not approve a final proposal.';
  const content = <div className="ke-wizard-shell ke-response-sheet">
    <header className="ke-wizard-header"><div><h2 ref={heading} tabIndex={-1} id="private-answers-title">What works for you?</h2>
      <p className="ke-wizard-help">Select every option you’re happy with. You can choose more than one.</p></div>
      {!embedded && <button type="button" className="secondary ke-wizard-close" aria-label="Close private answers" disabled={busy} onClick={onClose}><PageIcon name="X" /></button>}
    </header>
    <div className="ke-wizard-body">
      <p className="ke-response-privacy"><PageIcon name="Lock" />Your answers and notes are private.</p>
      {frameChanged && <p role="status">The options changed. Choose what works for you from the current list.</p>}
      {recovery}
      {!questions.length && <p>No selectable options are available yet. Add a private note or ask the organizer to update the decision.</p>}
      <div className="ke-response-topics">{questions.map(({ variable, options }, topicIndex) => {
        const answer = answers[variable.id] ?? { mode: '', acceptable: [], preferred: '' };
        const selected = selectedOptions(answer, options.length);
        return <fieldset key={variable.id} className="ke-private-question ke-response-topic" disabled={blocked || saving}>
          <legend><span aria-hidden="true" className="ke-response-topic-number">{topicIndex + 1}</span>{variable.label}</legend>
          <div className="ke-response-topic-tools"><small>{answer.mode === 'NONE' ? 'None work for you' : selected.length ? `${selected.length} selected` : 'Choose what works for you'}</small>
            <div><button type="button" className="ke-response-text-button" disabled={selected.length === options.length} onClick={() => chooseOptions(variable.id, answer, options.map((_option, index) => index), options.length)}>Select all</button>
              {!!answer.mode && <button type="button" className="ke-response-text-button" onClick={() => update(variable.id, { mode: '', acceptable: [], preferred: '' })}>Clear</button>}</div></div>
          <div className="ke-private-option-list ke-response-options" role="group" aria-label={'Acceptable options for ' + variable.label}>{options.map((value, index) =>
            <label key={index} className="ke-response-option" data-selected={selected.includes(index)}>
              <input type="checkbox" checked={selected.includes(index)} onChange={event => chooseOptions(variable.id, answer,
                event.target.checked ? [...selected, index] : selected.filter(option => option !== index), options.length)} />
              <span>{label(value, variable)}</span>
            </label>)}</div>
          <label className="ke-response-none" data-selected={answer.mode === 'NONE'}><input type="checkbox" checked={answer.mode === 'NONE'}
            onChange={event => update(variable.id, { mode: event.target.checked ? 'NONE' : '', acceptable: [], preferred: '' })} /><span>None work for me</span></label>
          {answer.mode === 'NONE' && <p className="ke-response-topic-hint">We’ll save this. The group will need other options before agreeing.</p>}
          {!!selected.length && options.length > 1 && <label className="ke-private-favourite">Favorite <span>Optional · which would you choose first?</span>
            <select value={answer.preferred} onChange={event => update(variable.id, { ...answer, preferred: event.target.value })}>
              <option value="">No favorite</option>{selected.map(index => <option key={index} value={index}>{label(options[index]!, variable)}</option>)}
            </select></label>}
        </fieldset>;
      })}</div>

      <details className="ke-private-extra-notes"><summary>Anything else? · optional</summary>
        <p className="ke-wizard-help">Add a requirement the options don’t cover. Optional AI help turns it into conditions for you to review; your selections stay unchanged.</p>
        <label htmlFor="private-extra-notes">Your private note</label>
        <textarea id="private-extra-notes" rows={3} value={notes} maxLength={2000} disabled={blocked} onChange={event => onNotes(event.target.value)} placeholder="For example: I need step-free access." />
        <small>{notes.length} / 2,000 characters · private</small>
        {notes.trim() && <><button type="button" className="secondary" disabled={blocked || saveBlocked || notesLocked || !consent} onClick={() => void onInterpret()}>Help with my notes</button>
          <p className="ke-response-topic-hint">Review the suggested conditions before saving. {!consent && 'Confirm the processing consent below to use AI help.'}</p>
          <button type="button" className="ke-text-link" disabled={blocked} onClick={() => onNotes('')}>Clear unsent notes</button></>}
      </details>
          {!!extras.length && <details className="ke-wizard-edit"><summary>Previously saved extra conditions ({retained.length} kept)</summary><p className="ke-wizard-help">Keep any that still apply. Uncheck a condition only if you want to replace or remove it.</p>
            {extras.map(item => <label className="ke-private-check" key={item.constraintId}><input type="checkbox" disabled={blocked} checked={retained.includes(item.constraintId)} onChange={event => { setRetained(current => event.target.checked ? [...current, item.constraintId] : current.filter(id => id !== item.constraintId)); setChanged(true); }} />{describeCondition(item)}</label>)}</details>}
          {owner.draft && !onlyDirectDraft && <div className="ke-wizard-edit ke-response-note-review"><h3>Review your notes</h3><p className="ke-wizard-help">Your selections above replace earlier selections for those questions. Keep only extra conditions you agree with.</p>
            <label className="ke-private-check"><input type="checkbox" checked={replaceDraft} disabled={blocked} onChange={event => { setReplaceDraft(event.target.checked); setIncluded([]);  setChanged(true); }} />Use my current selections only; replace these earlier extra conditions.</label>
            {!replaceDraft && <>{owner.draft.proposedConstraints.filter(item => !direct(item.constraintId)).map(item => <label className="ke-private-check" key={item.constraintId}><input type="checkbox" disabled={blocked} checked={included.includes(item.constraintId)}
              onChange={event => { setIncluded(current => event.target.checked ? [...current, item.constraintId] : current.filter(id => id !== item.constraintId));  setChanged(true); }} />{describeCondition(item)}</label>)}
              {owner.draft.unsupportedConditions.map(item => <p className="ke-wizard-save" key={item.id}>Still unresolved: {item.clarificationQuestion} Your answers can be saved, but a proposal must wait for clarification.</p>)}</>}
          </div>}

      <details className="ke-response-privacy-details"><summary>Privacy and preview limits</summary>
        <p>Known Enough and its authorized AI process your private answers to help with the decision. Private notes are sent for AI help when you request it. Other participants see shared choices and only disclosures you authorize. An outcome may still reveal something about people’s needs. Use fictional, non-sensitive information in this preview. Updating your answers keeps other people’s answers; a revised proposal needs fresh approval.</p>
      </details>
      <label className="ke-wizard-confirm ke-response-consent"><input type="checkbox" checked={consent} disabled={blocked || saving} onChange={event => onConsent(event.target.checked)} />These are fictional test answers. I agree to their processing by Known Enough and, if I use AI help, its AI.</label>
      {notice && <p role="status" className="ke-wizard-notice">{notice}</p>}
    </div>
    <footer className="ke-response-save"><div><p id="private-save-help" className="ke-response-save-help">{saveHint}</p>
      {changed && <small>Unsaved changes</small>}</div><button type="button" aria-describedby="private-save-help" disabled={saving || blocked || saveBlocked || !complete || !consent || !!notes.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save my answers'}<PageIcon name="Check" /></button>
    </footer>
  </div>;
  return embedded ? <section className="ke-private-inline ke-response-inline" aria-labelledby="private-answers-title">{content}</section> :
    <dialog ref={dialog} className="ke-decision-wizard ke-private-wizard" aria-labelledby="private-answers-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>{content}</dialog>;
}
