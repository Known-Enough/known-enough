import { useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Alexa } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';

type Message = { question: string; answer: string };
export default function AlexaChat({ decisionId, title, groupId, endpoint, api, onClose }: {
  decisionId: string; title: string; groupId?: string | undefined; endpoint: string;
  api: (path: string, init?: RequestInit) => Promise<Response>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const client = useRef<Client | null>(null), apiRef = useRef(api); apiRef.current = api;
  const lifetime = useRef<AbortController | null>(null);
  const [epoch, setEpoch] = useState(0), [ready, setReady] = useState(false), [working, setWorking] = useState(false);
  const [connection, setConnection] = useState('Connecting to shared decision tools…');
  const [question, setQuestion] = useState(''), [messages, setMessages] = useState<Message[]>([]), [notice, setNotice] = useState('');
  const [trace, setTrace] = useState<string[]>([]), [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [selectedGroup, setSelectedGroup] = useState(groupId ?? '');
  const stateKey = useRef<string | null>(null), turnGuard = useRef(false);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal(); input.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(); lifetime.current = controller;
    setReady(false); setConnection('Connecting to shared decision tools…'); setTrace([]); setMessages([]); setGroups([]); setCursor(null); setNotice(''); stateKey.current = null;
    const current = new Client({ name: 'known-enough-web-simulator', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(URL.parse(endpoint)!, {
      fetch: async (url, init) => {
        const requested = typeof url === 'string' ? url : url.href;
        if (requested !== endpoint) throw new Error('Unexpected MCP endpoint');
        return apiRef.current('/mcp', { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
      },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    void (async () => {
      try {
        // SDK v1's sessionId getter is string | undefined while Transport declares it optional.
        await current.connect(transport as Parameters<Client['connect']>[0], { timeout: 15000 });
        const tools = await current.listTools({}, { timeout: 15000, signal: controller.signal });
        if (!Alexa.TOOL_NAMES.every(name => tools.tools.some(tool => tool.name === name))) throw new Error('Missing shared tools');
        if (!active) return;
        client.current = current; setReady(true); setConnection('Connected to live shared data');
        setTrace([`MCP ${Alexa.PROTOCOL_VERSION} · initialize complete`, `tools/list · ${tools.tools.length} shared read tools available`]);
      } catch {
        if (active) { setConnection('The assistant could not connect. Your decisions are unchanged.'); setReady(false); }
      }
    })();
    return () => { active = false; controller.abort(); client.current = null; void current.close().catch(() => {}); };
  }, [endpoint, decisionId, epoch]);
  const record = (line: string) => setTrace(current => [...current, line].slice(-8));
  async function tool(name: typeof Alexa.TOOL_NAMES[number], args: Record<string, string>) {
    if (!client.current || !lifetime.current) throw new Error('Not connected');
    record(`tools/call · ${name} · started`);
    const result = await client.current.callTool({ name, arguments: args }, undefined, { timeout: 15000, signal: lifetime.current.signal });
    if (result.isError || !result.structuredContent) { record(`tools/call · ${name} · unavailable`); throw new Error('Unavailable'); }
    record(`tools/call · ${name} · complete`);
    return result.structuredContent;
  }
  function answerSummary(value: Alexa.DecisionSummary, intent: 'outcome' | 'progress' | 'approvals'): string {
    const changed = stateKey.current !== null && stateKey.current !== JSON.stringify([value.contextToken, value.publicRevision, value.proposalId, value.proposalVersion, value.status, value.approved]);
    stateKey.current = JSON.stringify([value.contextToken, value.publicRevision, value.proposalId, value.proposalVersion, value.status, value.approved]);
    if (changed) setMessages([]);
    const prefix = changed ? 'The decision changed; this is the current view.\n\n' : '';
    const approvals = `${value.approved} of ${value.requiredApprovals} required approvals are recorded.`;
    if (intent === 'outcome') {
      if (!value.proposalId) return prefix + (value.status === 'CLOSED' ? 'This decision is closed.' : 'There is no shared outcome yet. Everyone can add their answers in the decision screen.');
      return prefix + (value.status === 'AGREED' ? 'The group agreed on:\n' : 'The current proposal, still awaiting approval:\n') + value.choices.map(choice => `${choice.topic}: ${choice.option}`).join('\n') + '\n\n' + approvals;
    }
    if (intent === 'approvals') return prefix + approvals + '\n' + value.participants.filter(person => person.required).map(person => `${person.name}: ${person.approved ? 'approved' : 'approval pending'}`).join('\n');
    if (value.status === 'AGREED') return prefix + 'This decision is agreed. ' + approvals;
    if (value.proposalId) return prefix + 'A proposal is ready to review. ' + approvals;
    if (value.status === 'REASONING') return prefix + 'The app is finding an outcome from the saved answers.';
    if (value.status === 'CLOSED') return prefix + 'This decision is closed.';
    const pending = value.participants.filter(person => person.answered === false).map(person => person.name);
    if (pending.length) return prefix + 'Still waiting for answers from: ' + pending.join(', ') + '.\nOnly submission status is shared; their answers remain private.';
    if (value.participants.every(person => person.answered === true)) return prefix + 'Everyone’s answers are saved. You can find an outcome in the decision screen.';
    return prefix + 'The decision is still being prepared. Some response information is not available yet; open the decision for the current next step.';
  }
  async function ask(value: string, moreGroups = false, explicitGroup?: string) {
    if (turnGuard.current || !ready || !value.trim()) return;
    turnGuard.current = true; setWorking(true); setNotice('');
    const text = value.trim().slice(0, 500), normalized = text.toLocaleLowerCase();
    try {
      let answer: string;
      if (!explicitGroup && /\b(private|budget|afford|salary|medical|secret|infer|guess|why|reason|preferences?|conditions?|notes|refus\w*|dissent|reject\w*)\b/.test(normalized)) {
        answer = 'I can show shared progress, approvals and the chosen options. I cannot read or explain anyone’s private answers or personal reasons.';
      } else if (!explicitGroup && /\b(approve|withdraw|delete|remove|create|invite|change|save)\b/.test(normalized) && !/\b(who|how many|approved|approvals|progress|status)\b/.test(normalized)) {
        answer = 'Please use the decision screen for changes or approval. This assistant only reads shared information.';
      } else if (explicitGroup || /\bdecisions\b/.test(normalized) && selectedGroup) {
        const result = Alexa.GroupDecisions.parse(await tool('list_group_decisions', { groupId: explicitGroup ?? selectedGroup }));
        if (explicitGroup) setSelectedGroup(explicitGroup);
        answer = result.decisions.length ? `${result.name}:\n` + result.decisions.map(decision => `• ${decision.title}${decision.current ? '' : ' (membership update needed)'}`).join('\n') : 'This group has no saved decisions yet.';
      } else if (/\bgroups?\b/.test(normalized) || /\bdecisions\b/.test(normalized)) {
        const result = Alexa.GroupList.parse(await tool('list_groups', moreGroups && cursor ? { cursor } : {}));
        setGroups(current => moreGroups ? [...current, ...result.groups] : result.groups); setCursor(result.cursor);
        answer = result.groups.length ? 'Choose a group below to see its shared decisions.' : 'No more groups are available for this account.';
      } else if (/\b(outcome|agree|agreed|result|chosen|choose|choice|choices|decide|decided|dinner|proposal)\b/.test(normalized)) {
        const result = Alexa.DecisionSummary.parse(await tool('get_decision_outcome', { decisionId }));
        if (result.decisionId !== decisionId) throw new Error('Wrong decision');
        answer = answerSummary(result, 'outcome');
      } else if (/\b(who|respond|responded|answer|answers|waiting|status|progress|approval|approvals|approved|ready)\b/.test(normalized)) {
        const result = Alexa.DecisionSummary.parse(await tool('get_decision_progress', { decisionId }));
        if (result.decisionId !== decisionId) throw new Error('Wrong decision');
        answer = answerSummary(result, /\b(approval|approvals|approved)\b/.test(normalized) ? 'approvals' : 'progress');
      } else answer = 'Try “Who still needs to answer?”, “What did we agree on?”, or “Show this group’s decisions”. I use these supported questions to look up current shared information.';
      if (lifetime.current?.signal.aborted) return;
      setMessages(current => [...current, { question: text, answer }].slice(-6)); setQuestion('');
    } catch {
      if (!lifetime.current?.signal.aborted) { setNotice('I couldn’t check the current shared data. Your decisions are unchanged. Try again or reconnect.'); setMessages([]); setGroups([]); setCursor(null); stateKey.current = null; }
    } finally { turnGuard.current = false; setWorking(false); }
  }
  return <dialog ref={dialog} className="ke-alexa-chat" aria-labelledby="alexa-chat-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><span className="ke-alexa-eyebrow">Simulated Alexa+</span><h2 id="alexa-chat-title">Ask about this decision</h2><p>{title}</p></div><button type="button" className="ke-alexa-close" aria-label="Close assistant" onClick={onClose}><PageIcon name="X" /></button></header>
    <div className="ke-alexa-body"><p className="ke-alexa-connection" role="status" data-connected={ready}>{connection}</p>
      {(!ready || notice) && <button type="button" className="secondary" disabled={working} onClick={() => setEpoch(current => current + 1)}>Reconnect</button>}
      <div className="ke-alexa-suggestions">{['Who still needs to answer?', 'What did we agree on?', 'Who has approved?', groupId ? 'Show this group’s decisions' : 'Show my groups'].map(prompt => <button type="button" key={prompt} disabled={!ready || working} onClick={() => void ask(prompt)}>{prompt}</button>)}</div>
      <ol className="ke-alexa-messages" aria-label="Assistant conversation">{messages.map((message, index) => <li key={index}><p className="ke-alexa-question">{message.question}</p><p className="ke-alexa-answer">{message.answer}</p></li>)}</ol>
      {!!groups.length && <div className="ke-alexa-groups">{groups.map(group => <button key={group.id} type="button" disabled={working || !ready} onClick={() => void ask(`Show decisions in ${group.name}`, false, group.id)}>{group.name}</button>)}{cursor && <button type="button" disabled={working || !ready} onClick={() => void ask('Show more groups', true)}>More groups</button>}</div>}
      {notice && <p role="status" className="ke-alexa-notice">{notice}</p>}
      {working && <p role="status" className="ke-alexa-working">Checking the current shared view…</p>}
      <details className="ke-alexa-trace"><summary>Connection details</summary><p>Real MCP tools · protocol {Alexa.PROTOCOL_VERSION}. No private-answer or approval tools.</p><ul>{trace.map((line, index) => <li key={index}>{line}</li>)}</ul></details>
    </div>
    <form onSubmit={event => { event.preventDefault(); void ask(question); }}><label htmlFor="alexa-question">Your question</label><div><input ref={input} id="alexa-question" value={question} maxLength={500} autoComplete="off" onChange={event => setQuestion(event.target.value)} placeholder="Ask about shared progress or the outcome" /><button type="submit" disabled={!ready || working || !question.trim()}>Ask<PageIcon name="ArrowRight" /></button></div>
      <p>Web demonstration, not a native Alexa+ connection. Supported questions use live read tools, without a language-model call. Messages stay in this window and disappear when closed; ask only about shared information.</p></form>
  </dialog>;
}
