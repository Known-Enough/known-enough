import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KnownEnough } from '@deal-table/contracts';
import { answerPublicTurn, publicAssistantContext, publicAssistantStateKey, type PublicAssistantMemory } from './public-assistant';

type Props = {
  snapshot: KnownEnough.PublicDecisionSnapshot | null;
  fetchPublic: () => Promise<unknown>;
  onFreshSnapshot: (snapshot: KnownEnough.PublicDecisionSnapshot) => void;
};

export function SimulatedSharedAssistant({ snapshot, fetchPublic, onFreshSnapshot }: Props) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const memory = useRef<PublicAssistantMemory | undefined>(undefined);
  const request = useRef(0);
  const snapshotKey = snapshot ? publicAssistantStateKey(publicAssistantContext(snapshot)) : null;
  useEffect(() => {
    if (memory.current && snapshotKey !== memory.current.stateKey) {
      request.current++;
      memory.current = undefined;
      setAnswers([]);
      setNotice('The public decision changed. Earlier assistant answers were cleared.');
      setBusy(false);
    }
  }, [snapshotKey]);
  useEffect(() => () => { request.current++; }, []);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const current = question.trim();
    if (!current || busy) return;
    const sequence = ++request.current;
    setBusy(true); setNotice(''); setQuestion('');
    try {
      // Every turn fetches the authenticated public route; private owner routes and consent commands are absent.
      const fresh = KnownEnough.PublicDecisionSnapshot.parse(await fetchPublic());
      if (sequence !== request.current) return;
      const context = publicAssistantContext(fresh);
      const turn = answerPublicTurn(context, current, memory.current);
      memory.current = turn.memory;
      onFreshSnapshot(fresh);
      setAnswers(previous => turn.revised ? [turn.answer] : [...previous.slice(-5), turn.answer]);
      if (turn.revised) setNotice('The proposal or decision changed. Earlier assistant answers were cleared.');
    } catch {
      if (sequence !== request.current) return;
      memory.current = undefined;
      setAnswers([]);
      setNotice('The current public decision could not be checked. Try again after refreshing your session.');
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  };

  return <section className="ke-card ke-assistant" aria-labelledby="ke-assistant-heading">
    <p className="eyebrow">SIMULATED ALEXA+ · SHARED ASSISTANT</p>
    <h2 id="ke-assistant-heading">Ask about this decision</h2>
    <p className="ke-help">This simulation uses the current authenticated public view. It has no native Alexa connection, model call, private profile access, or permission controls.</p>
    {answers.length > 0 && <ol className="ke-assistant-answers" aria-label="Assistant answers">{answers.map((answer, index) => <li key={index}>{answer}</li>)}</ol>}
    {notice && <p role="status" className="local-note">{notice}</p>}
    <form onSubmit={event => void ask(event)}>
      <label htmlFor="ke-assistant-question">Your question</label>
      <input id="ke-assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder="What is the proposal status?" autoComplete="off" />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? 'Checking public view…' : 'Ask simulated Alexa+'}</button>
    </form>
    <p className="ke-help">Questions are not saved in assistant memory. Recheck the current public view before relying on an answer.</p>
  </section>;
}
