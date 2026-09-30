import { useRef, useState } from 'react';
import { KnownEnough as KE } from '@deal-table/contracts';

type Variable = KE.DecisionVariable | KE.PublicDecisionFrame['variables'][number];
function valueText(value: KE.DecisionValue, variable?: Variable): string {
  if (value.type === 'MONEY') return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / 10 ** value.minorUnit);
  if (value.type === 'PERCENTAGE') return `${value.basisPoints / 100}%`;
  if (value.type === 'ENUM') return variable?.type === 'ENUM' ? variable.options.find(item => item.id === value.optionId)?.label ?? value.optionId : value.optionId;
  if (value.type === 'ENUM_SET') return value.optionIds.map(id => variable?.type === 'ENUM_SET'
    ? variable.options.find(item => item.id === id)?.label ?? id : id).join(', ');
  if (value.type === 'DATE') return value.date;
  if (value.type === 'DURATION') return `${value.seconds} seconds`;
  if (value.type === 'NUMBER') return `${value.coefficient / 10 ** value.scale} ${value.unitCode}`;
  if (value.type === 'DATETIME') return `${value.instant} (${value.displayTimeZone})`;
  if (value.type === 'BOOLEAN') return value.value ? 'Yes' : 'No';
  return value.participantId;
}
function variableText(variable: KE.PublicDecisionFrame['variables'][number], frame: KE.PublicDecisionFrame): string {
  const requirement = variable.required ? 'required' : 'optional';
  switch (variable.type) {
    case 'ENUM': case 'ENUM_SET': return `${variable.label} (${variable.type === 'ENUM' ? 'one option' : 'set of options'}, ${requirement}): ${variable.options.map(item => item.label).join(', ')}`;
    case 'PARTICIPANT': return `${variable.label} (participant, ${requirement}): ${variable.participantIds.map(id => frame.participants.find(person => person.id === id)?.displayName ?? id).join(', ')}`;
    case 'MONEY': return `${variable.label} (money, ${variable.currencyCode}, ${variable.minorUnit} decimal places, ${requirement})`;
    case 'NUMBER': return `${variable.label} (number, ${variable.unitCode}, ${variable.scale} decimal places, ${requirement})`;
    case 'PERCENTAGE': return `${variable.label} (percentage, ${requirement})`;
    case 'DATE': return `${variable.label} (date, ${requirement})`;
    case 'DATETIME': return `${variable.label} (date and time, ${variable.displayTimeZone}, ${requirement})`;
    case 'DURATION': return `${variable.label} (duration in seconds, ${requirement})`;
    case 'BOOLEAN': return `${variable.label} (yes or no, ${requirement})`;
  }
}
export function ruleText(rule: KE.ValidationRule, variables: Variable[]): string {
  const variable = (id: string) => variables.find(item => item.id === id);
  const label = (id: string) => variable(id)?.label ?? id;
  const atom = (condition: { variableId: string; operator: 'EQ' | 'NE'; value: KE.DecisionValue }) =>
    `${label(condition.variableId)} ${condition.operator === 'EQ' ? 'equals' : 'does not equal'} ${valueText(condition.value, variable(condition.variableId))}`;
  switch (rule.operator) {
    case 'COMPARE': return `${label(rule.variableId)} ${({ EQ: '=', NE: '≠', LT: '<', LTE: '≤', GT: '>', GTE: '≥' })[rule.comparison]} ${valueText(rule.value, variable(rule.variableId))}`;
    case 'IN': return `${label(rule.variableId)} is one of ${rule.values.map(value => valueText(value, variable(rule.variableId))).join(' or ')}`;
    case 'RANGE': return `${label(rule.variableId)} ${rule.includeMinimum ? '≥' : '>'} ${valueText(rule.minimum, variable(rule.variableId))} and ${rule.includeMaximum ? '≤' : '<'} ${valueText(rule.maximum, variable(rule.variableId))}`;
    case 'SUM_EQUALS': return `Sum of ${rule.variableIds.map(label).join(' + ')} = ${valueText(rule.target, variable(rule.variableIds[0]!))}`;
    case 'ALL_DIFFERENT': return `${rule.variableIds.map(label).join(', ')} must all have different values`;
    case 'MUTUALLY_EXCLUSIVE': return `At most ${rule.maximumSelected} of ${rule.variableIds.map(label).join(', ')} may be Yes`;
    case 'IMPLIES': return `If ${atom(rule.antecedent)}, then ${atom(rule.consequent)}`;
  }
}
function preferenceText(preference: KE.PreferenceCriterion, variables: Variable[]): string {
  const variable = variables.find(item => item.id === preference.variableId);
  return `${variable?.label ?? preference.variableId}: ${valueText(preference.value, variable)} (preference cost ${preference.cost})`;
}

export function ConnectedDecision({ snapshot, owner, api, refresh }: {
  snapshot: KE.PublicDecisionSnapshot; owner: KE.OwnerDecisionSnapshot | null;
  api: (path: string, init?: RequestInit) => Promise<Response>; refresh: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [empty, setEmpty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewedFrame, setReviewedFrame] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef<{ type: string; body: unknown } | null>(null);
  const decisionId = snapshot.frame.decisionId;
  const frameReviewKey = `${snapshot.contextToken}:${snapshot.frame.frameVersion}`;
  const variables: Variable[] = [...snapshot.frame.variables, ...(owner?.privateVariables ?? [])];
  const allConfirmed = snapshot.frame.requiredParticipantIds.every(id => snapshot.frameConfirmations.some(item => item.participantId === id));
  const confirmed = owner && snapshot.frameConfirmations.some(item => item.participantId === owner.ownerParticipantId);
  const request = async (path: string, body: unknown) => {
    const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('rejected');
    const result: unknown = await response.json();
    if (result && typeof result === 'object' && 'ok' in result && result.ok !== true) throw new Error('rejected');
    return result;
  };
  const command = async (type: string, payload: unknown) => {
    if (!owner) return;
    setBusy(true); setNotice('');
    if (!pending.current) {
      const id = crypto.randomUUID();
      pending.current = { type, body: { schemaVersion: 2, decisionId, type, requestId: id, idempotencyKey: id,
        expected: { contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion,
          controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion }, payload } };
    }
    try {
      KE.DecisionCommandResult.parse(await request(`/decisions/${decisionId}/commands`, pending.current.body));
      pending.current = null; setSelected([]); setEmpty(false); setReviewed(false);
      await refresh(); setNotice('Your decision was recorded.');
    } catch { setNotice('The action was rejected or its result is unknown. Retry the same action, or refresh to review current state.'); }
    finally { setBusy(false); }
  };
  const interpret = async () => {
    if (!text.trim()) return;
    setBusy(true); setNotice('');
    try {
      const result = await request(`/decisions/${decisionId}/owner-conversation/draft`, { requestId: crypto.randomUUID(), messages: [{ role: 'owner', text }] });
      if (!result || typeof result !== 'object' || !('draft' in result)) throw new Error('invalid');
      KE.AIConstraintDraft.parse(result.draft);
      setText(''); setSelected([]); setEmpty(false); setReviewed(false); await refresh();
    } catch { setNotice('Interpretation is unavailable. Refresh and check that everyone has confirmed the current frame.'); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true); setNotice('');
    try { await request(`/decisions/${decisionId}/reasoning`, { requestId: crypto.randomUUID() }); await refresh(); }
    catch { setNotice('Exploration is unavailable. Refresh and check confirmations, or try again.'); }
    finally { setBusy(false); }
  };
  const proposal = snapshot.currentProposal;
  const draft = owner?.draft;
  const blocked = busy || pending.current !== null;
  return <>
    <section className="ke-card"><h2>Shared frame</h2><p>{snapshot.frame.objective}</p>
      <p>{snapshot.frame.description}</p>
      <p>Frame version {snapshot.frame.frameVersion}. Review the people, choices and rules below before confirming this version.</p>
      <h3>Participants and approvals</h3>
      <ul aria-label="Frame participants and approvals">{snapshot.frame.participants.map(person => <li key={person.id}>{person.displayName}: {person.requiredForApproval ? 'required approver' : 'optional participant'}</li>)}</ul>
      <h3>Shared topics and options</h3>
      <ul aria-label="Shared frame options and types">{snapshot.frame.variables.map(variable => <li key={variable.id}>{variableText(variable, snapshot.frame)}</li>)}</ul>
      <h3>Public decision rules</h3>
      {snapshot.frame.rules.length ? <ul aria-label="Public decision rules">{snapshot.frame.rules.map(rule => <li key={rule.id}>{ruleText(rule, snapshot.frame.variables)}</li>)}</ul> : <p>No public decision rules were declared.</p>}
      <p>{snapshot.frameConfirmations.length} of {snapshot.frame.requiredParticipantIds.length} required frame confirmations.</p>
      {owner && !confirmed && <><label><input type="checkbox" disabled={blocked} checked={reviewedFrame === frameReviewKey}
        onChange={event => setReviewedFrame(event.target.checked ? frameReviewKey : null)} />I reviewed this frame version, its options and public rules.</label>
        <button disabled={blocked || reviewedFrame !== frameReviewKey} onClick={() => void command('CONFIRM_FRAME', { frameVersion: snapshot.frame.frameVersion })}>Confirm shared frame</button></>}
    </section>
    {owner && <section className="ke-card"><h2>Your private conditions</h2>
      <p>Known Enough and its authorized AI process these inputs. Other participants receive only shared facts and disclosures you authorize. Outcomes may imply information. Use synthetic data here.</p>
      <label htmlFor="connected-owner-text">Explain your limits and preferences privately</label>
      <textarea id="connected-owner-text" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={blocked || !allConfirmed} />
      <button disabled={blocked || !allConfirmed || !text.trim()} onClick={() => void interpret()}>Interpret my conditions</button>
      {!allConfirmed && <p>Everyone must confirm the current frame first.</p>}
      {owner.ownInputReadiness === 'NEEDS_CLARIFICATION' && <p>An unresolved condition is blocking exploration. Clarify it in your private conversation before continuing.</p>}
      <ul>{owner.confirmedConstraints.filter(item => item.status === 'ACTIVE').map(item => <li key={`${item.constraintId}:${item.constraintVersion}`}>
        {item.kind.toLowerCase()}: {item.kind === 'PREFERENCE' ? preferenceText(item.preference, variables) : ruleText(item.rule, variables)}
      </li>)}</ul>
      {draft && <div><h3>Review the interpretation</h3>
        {draft.proposedConstraints.map(item => <label key={item.constraintId}><input type="checkbox" disabled={blocked} checked={selected.includes(item.constraintId)}
          onChange={event => setSelected(current => event.target.checked ? [...current, item.constraintId] : current.filter(id => id !== item.constraintId))} />
          {item.kind.toLowerCase()}: {item.kind === 'PREFERENCE' ? preferenceText(item.preference, variables) : ruleText(item.rule, variables)}</label>)}
        {draft.unsupportedConditions.map(item => <p key={item.id}>Needs clarification: {item.clarificationQuestion}</p>)}
        {!draft.proposedConstraints.length && <label><input type="checkbox" disabled={blocked} checked={empty} onChange={event => setEmpty(event.target.checked)} />I confirm that I have no additional conditions.</label>}
        <button disabled={blocked || !allConfirmed || !(selected.length || empty)} onClick={() => void command('CONFIRM_CONSTRAINTS', {
          draftId: draft.draftId, draftVersion: draft.draftVersion, constraintIds: selected })}>Confirm selected conditions</button>
        <p>Only selected conditions become authoritative. Replacing confirmed conditions requires everyone to reconfirm the revised frame.</p>
      </div>}
      {owner.pendingQuestions.filter(question => question.status === 'PENDING').map(question => <div key={question.questionId}><h3>Private negotiation question</h3>
        <p>Would this alternative work, provided all your confirmed hard limits still pass?</p><p>{ruleText(question.adjustment, variables)}</p>
        <p>Expires {question.expiresAt}. Permission for this adjustment does not disclose your conditions or approve a final proposal.</p>
        {(['ALLOW', 'DECLINE'] as const).map(answer => <button key={answer} disabled={blocked} onClick={() => void command('ANSWER_NEGOTIATION', {
          questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer })}>{answer === 'ALLOW' ? 'Allow this adjustment' : 'Decline this adjustment'}</button>)}
      </div>)}
      <button disabled={blocked || !['READY', 'SUPERSEDED', 'NO_AGREEMENT'].includes(snapshot.status)} onClick={() => void generate()}>Explore proposals</button>
    </section>}
    {proposal && <section className="ke-card"><h2>Current hypothetical proposal</h2>
      <ul>{proposal.facts.values.map(item => <li key={item.variableId}>{variables.find(variable => variable.id === item.variableId)?.label}: {valueText(item.value, variables.find(variable => variable.id === item.variableId))}</li>)}</ul>
      {owner?.privateProposalValues && <div><h3>Your private part of this proposal</h3>
        <ul>{owner.privateProposalValues.values.map(item => <li key={item.variableId}>{variables.find(variable => variable.id === item.variableId)?.label}: {valueText(item.value, variables.find(variable => variable.id === item.variableId))}</li>)}</ul></div>}
      <p>Valid under currently confirmed supported conditions. All offers are synthetic. This does not execute a booking or purchase, or establish legal ownership.</p>
      <p>{snapshot.approvedParticipantIds.length} of {snapshot.frame.requiredParticipantIds.length} approvals. {snapshot.status === 'AGREED' ? 'Everyone approved this exact outcome.' : 'Agreement is still pending.'}</p>
      {owner && <><label><input type="checkbox" disabled={blocked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the shared outcome and my private part of this exact proposal.</label>
        <button disabled={blocked || !reviewed || !!owner.ownApproval} onClick={() => void command('APPROVE_PROPOSAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Approve this exact proposal</button>
        {owner.ownApproval && <button disabled={blocked} onClick={() => void command('WITHDRAW_APPROVAL', { proposalId: proposal.proposalId,
          proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash })}>Withdraw my approval</button>}</>}
    </section>}
    {pending.current && <div><button disabled={busy} onClick={() => void command(pending.current!.type, {})}>Retry the same action</button>
      <button disabled={busy} onClick={() => { pending.current = null; setReviewed(false); void refresh(); }}>Refresh and review current state</button></div>}
    {notice && <p role="status">{notice}</p>}
  </>;
}
