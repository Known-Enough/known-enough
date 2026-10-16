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
  const [frameChanged, setFrameChanged] = useState(false);
  const boundContext = useRef(choiceFrameKey);
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
      next[variable.id] = { mode: limit ? 'SELECTED' : favourite || owner.ownInputReadiness === 'READY' ? 'ANY' : '', acceptable,
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
  const complete = questions.every(({ variable }) => {
    const answer = answers[variable.id];
    return answer && !!answer.mode && (answer.mode !== 'SELECTED' || answer.acceptable.length > 0);
  });
  function label(value: KE.DecisionValue, variable: KE.PublicDecisionFrame['variables'][number]) {
    return value.type === 'DATE' ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.date + 'T00:00:00Z')) : describeValue(value, variable);
  }
  async function save() {
    if (blocked || saveBlocked || !complete || !consent || notes.trim()) return;
    const payload: Payload = { processingConsent: 'SYNTHETIC_TEST', retainedConstraintIds: retained,
      answers: questions.map(({ variable }) => {
        const answer = answers[variable.id]!;
        return { variableId: variable.id, mode: answer.mode as KE.PrivateChoiceAnswer['mode'],
          acceptableIndices: answer.mode === 'SELECTED' ? answer.acceptable : [],
          ...(answer.preferred !== '' && answer.mode !== 'NONE' ? { preferredIndex: Number(answer.preferred) } : {}) };
      }), ...(owner.draft ? { draft: { draftId: owner.draft.draftId, draftVersion: owner.draft.draftVersion,
        constraintIds: replaceDraft ? [] : included, replace: replaceDraft } } : {}) };
    if (await onSave(payload)) { setChanged(false); onDirty(false); if (!embedded) onClose(); }
  }
  const content = <div className="ke-wizard-shell">
    <header className="ke-wizard-header"><div><h2 ref={heading} tabIndex={-1} id="private-answers-title">What works for you?</h2>
      <p className="ke-wizard-help">Choose your options and save. You can answer before anyone else.</p></div>
      {!embedded && <button type="button" className="secondary ke-wizard-close" aria-label="Close private answers" disabled={busy} onClick={onClose}><PageIcon name="X" /></button>}
    </header>
    <div className="ke-wizard-body">
      <p className="ke-wizard-privacy"><PageIcon name="ShieldCheck" />Your answers are private. Other people see shared choices and only disclosures you authorize.</p>
      {frameChanged && <p role="status">The shared options changed. Select your answers for the current choices.</p>}
      {recovery}
      {!questions.length && <p>No simple shared options are available. Use extra notes or ask the organizer to update the choices.</p>}
          {questions.map(({ variable, options }) => {
            const answer = answers[variable.id] ?? { mode: '', acceptable: [], preferred: '' };
            return <fieldset key={variable.id} className="ke-private-question" disabled={blocked}><legend>{variable.label}</legend>
              <div className="ke-private-options">{([['ANY', 'Any listed option works for me'], ['SELECTED', 'Only the options I select work'], ['NONE', 'None of these options work']] as const).map(([mode, text]) =>
                <label key={mode}><input type="radio" name={'answer-mode-' + variable.id} checked={answer.mode === mode} onChange={() => update(variable.id, { ...answer, mode, preferred: mode === 'NONE' || mode === 'SELECTED' && !answer.acceptable.includes(Number(answer.preferred)) ? '' : answer.preferred })} />{text}</label>)}</div>
              {answer.mode === 'SELECTED' && <div className="ke-private-option-list" role="group" aria-label={'Acceptable options for ' + variable.label}>{options.map((value, index) => <label key={index}>
                <input type="checkbox" checked={answer.acceptable.includes(index)} onChange={event => update(variable.id, { ...answer,
                  acceptable: event.target.checked ? [...answer.acceptable, index] : answer.acceptable.filter(option => option !== index),
                  preferred: !event.target.checked && answer.preferred === String(index) ? '' : answer.preferred })} />{label(value, variable)}</label>)}</div>}
              {answer.mode && answer.mode !== 'NONE' && <label className="ke-private-favourite">My first choice — optional
                <select value={answer.preferred} onChange={event => update(variable.id, { ...answer, preferred: event.target.value })}><option value="">No particular preference</option>
                  {options.map((value, index) => answer.mode === 'ANY' || answer.acceptable.includes(index) ? <option key={index} value={index}>{label(value, variable)}</option> : null)}</select></label>}
              {answer.mode === 'NONE' && <p className="ke-wizard-help">We’ll save that none work. New shared options will be needed before a proposal can proceed.</p>}
            </fieldset>;
          })}

      <details className="ke-private-extra-notes"><summary>Extra notes or conditions · optional</summary>
        <p className="ke-wizard-help">Add a requirement these choices don't cover. AI help applies only to these notes; it cannot change your selections.</p>
        <label htmlFor="private-extra-notes">Extra private notes</label>
        <textarea id="private-extra-notes" value={notes} maxLength={2000} disabled={blocked} onChange={event => onNotes(event.target.value)} placeholder="For example: I need step-free access." />
        <small>{notes.length} / 2,000 characters · private</small>
        {notes.trim() && <><button type="button" className="secondary" disabled={blocked || saveBlocked || notesLocked || !consent} onClick={() => void onInterpret()}>Use AI help for these notes</button>
          <p>Choose any returned conditions to include below. To save without these unsent notes, clear them.</p>
          <button type="button" className="ke-text-link" disabled={blocked} onClick={() => onNotes('')}>Clear unsent notes</button></>}
      </details>
          {!!extras.length && <details className="ke-wizard-edit"><summary>Previously saved extra conditions ({retained.length} kept)</summary><p className="ke-wizard-help">Keep any that still apply. Uncheck a condition only if you want to replace or remove it.</p>
            {extras.map(item => <label className="ke-private-check" key={item.constraintId}><input type="checkbox" disabled={blocked} checked={retained.includes(item.constraintId)} onChange={event => { setRetained(current => event.target.checked ? [...current, item.constraintId] : current.filter(id => id !== item.constraintId)); setChanged(true); }} />{describeCondition(item)}</label>)}</details>}
          {owner.draft && <div className="ke-wizard-edit"><h3>Review extra conditions</h3><p className="ke-wizard-help">Your selections above replace earlier selections for those questions. Keep only extra conditions you agree with.</p>
            <label className="ke-private-check"><input type="checkbox" checked={replaceDraft} disabled={blocked} onChange={event => { setReplaceDraft(event.target.checked); setIncluded([]);  setChanged(true); }} />Use my current selections only; replace these earlier extra conditions.</label>
            {!replaceDraft && <>{owner.draft.proposedConstraints.filter(item => !direct(item.constraintId)).map(item => <label className="ke-private-check" key={item.constraintId}><input type="checkbox" disabled={blocked} checked={included.includes(item.constraintId)}
              onChange={event => { setIncluded(current => event.target.checked ? [...current, item.constraintId] : current.filter(id => id !== item.constraintId));  setChanged(true); }} />{describeCondition(item)}</label>)}
              {owner.draft.unsupportedConditions.map(item => <p className="ke-wizard-save" key={item.id}>Still unresolved: {item.clarificationQuestion} Your answers can be saved, but a proposal must wait for clarification.</p>)}</>}
          </div>}

      {owner.ownInputReadiness !== 'NOT_STARTED' && <p className="ke-wizard-help">Updating your answers keeps everyone else's answers. Any earlier proposal will need fresh approval.</p>}
      <label className="ke-wizard-confirm"><input type="checkbox" checked={consent} disabled={blocked} onChange={event => onConsent(event.target.checked)} />These are fictional test answers. I agree to their processing by Known Enough and, if I use AI help, its AI.</label>
      <div className="ke-wizard-actions"><button type="button" disabled={blocked || saveBlocked || !complete || !consent || !!notes.trim()} onClick={() => void save()}>Save my answers</button></div>
      {!complete && <p className="ke-wizard-help">Choose an answer for each topic above.</p>}
      {notice && <p role="status" className="ke-wizard-notice">{notice}</p>}
    </div>
    <p className="ke-wizard-footer">Saving answers does not approve a final proposal or share your private notes. Outcomes may imply information about people's needs. Use fictional, non-sensitive data in this preview.</p>
  </div>;
  return embedded ? <section className="ke-private-inline" aria-labelledby="private-answers-title">{content}</section> :
    <dialog ref={dialog} className="ke-decision-wizard ke-private-wizard" aria-labelledby="private-answers-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>{content}</dialog>;
}
