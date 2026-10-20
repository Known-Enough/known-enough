import { Modal } from './modal';
import { useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Alexa, AssistantChat as Chat } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';

const labels = { group: 'Decision chat', private: 'Private assistant' };
const notices: Record<Chat.Receipt['state'], string> = {
  POSTED: 'Message posted.', ANSWERED: '', NOT_SUBMITTED: 'Your message is posted, but the assistant didn’t start. You can ask again later.',
  PENDING: 'Your message is posted. The assistant is still working; check the reply before sending again.',
  UNKNOWN: 'Your message is posted, but we couldn’t confirm the reply. You can check it or post another message.',
  UNAVAILABLE: 'Your message is posted, but the assistant couldn’t finish replying. You can ask a new question.',
};
export default function AlexaChat({ decisionId, title, endpoint, api, onClose }: {
  decisionId: string; title: string; groupId?: string | undefined; endpoint: string;
  api: (path: string, init?: RequestInit) => Promise<Response>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);
  const apiRef = useRef(api); apiRef.current = api;
  const [scope, setScope] = useState<Chat.Scope>('group');
  const [conversation, setConversation] = useState<Chat.Snapshot | null>(null), [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({ group: '', private: '' }), [working, setWorking] = useState(false), [notice, setNotice] = useState('');
  const [consent, setConsent] = useState(false);
  const [share, setShare] = useState<Chat.Message | null>(null), [pending, setPending] = useState<string | null>(null);
  const [details, setDetails] = useState(false), [connection, setConnection] = useState('Not checked'), [trace, setTrace] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [replyStates, setReplyStates] = useState<Record<string, Chat.Receipt['state']>>({});
  const [activity, setActivity] = useState<'sending' | 'asking' | 'checking' | null>(null);
  const turnVersion = useRef(0);
  const sequence = useRef(0), turnGuard = useRef(false), lifetime = useRef<AbortController | null>(null);
  const base = '/decisions/' + decisionId + '/chat/' + scope;
  const pendingKey = (viewer: string, tab: Chat.Scope) => 'known-enough-chat-pending:' + viewer + ':' + decisionId + ':' + tab;
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal(); input.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const current = ++sequence.current, controller = new AbortController(); lifetime.current = controller;
    let reading = false;
    setConversation(null); setLoading(true); setNotice(''); setShare(null); setPending(null); setConsent(false);
    async function read() {
      if (reading || turnGuard.current || document.visibilityState === 'hidden') return;
      reading = true; const startedTurn = turnVersion.current;
      try {
        const response = await apiRef.current(base, { signal: controller.signal });
        if (!response.ok) throw new Error('History unavailable');
        const value = Chat.Snapshot.parse(await response.json());
        if (value.decisionId !== decisionId || value.scope !== scope) throw new Error('Wrong conversation');
        if (sequence.current === current && !controller.signal.aborted && startedTurn === turnVersion.current) {
          setConversation(value);
          setPending(sessionStorage.getItem('known-enough-chat-pending:' + value.viewerId + ':' + decisionId + ':' + scope));
          setLoading(false);
        }
      } catch {
        if (!controller.signal.aborted && sequence.current === current) { setConversation(null); setLoading(false); setNotice('We couldn’t load this conversation. Check your connection and try refreshing.'); }
      } finally { reading = false; }
    }
    void read();
    const timer = window.setInterval(() => void read(), 15000);
    const onFocus = () => void read(); window.addEventListener('focus', onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [base, decisionId, scope, refresh]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [conversation?.messages.length, scope]);
  useEffect(() => {
    if (!details) return;
    const controller = new AbortController();
    const client = new Client({ name: 'known-enough-web-simulator', version: '2.0.0' });
    setConnection('Checking connection…');
    const transport = new StreamableHTTPClientTransport(URL.parse(endpoint)!, {
      fetch: async (url, init) => {
        if ((typeof url === 'string' ? url : url.href) !== endpoint) throw new Error('Unexpected endpoint');
        return apiRef.current('/mcp', { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
      }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    void (async () => {
      try {
        await client.connect(transport as Parameters<Client['connect']>[0], { timeout: 15000 });
        const result = await client.listTools({}, { timeout: 15000, signal: controller.signal });
        if (!Alexa.TOOL_NAMES.every(name => result.tools.some(tool => tool.name === name))) throw new Error('Missing tools');
        if (!controller.signal.aborted) { setConnection('Connected'); setTrace(['Messages saved to your account', 'MCP ' + Alexa.PROTOCOL_VERSION + ' · initialize complete', result.tools.length + ' shared read tools available', 'AI model: Amazon Nova Lite. Decision progress and outcomes come from the saved decision.']); }
      } catch { if (!controller.signal.aborted) setConnection('We couldn’t check the assistant connection. Refresh to try again.'); }
    })();
    return () => { controller.abort(); void client.close().catch(() => {}); };
  }, [details, endpoint]);

  async function accept(response: Response, current: number, expectedRequest: string) {
    if (!response.ok) throw new Error('Send unavailable');
    const value = Chat.Receipt.parse(await response.json());
    if (value.requestId !== expectedRequest || value.conversation.decisionId !== decisionId || value.conversation.scope !== scope || value.conversation.viewerId !== conversation?.viewerId) throw new Error('Wrong receipt');
    if (sequence.current !== current || lifetime.current?.signal.aborted) return;
    setConversation(value.conversation); setReplyStates(states => ({ ...states, [value.requestId]: value.state }));
    const exists = value.conversation.messages.some(message => message.id === value.requestId);
    // A confirmed saved message with an unknown reply stays in history for status checks,
    // but does not lock the whole conversation. Its provider job/reservation is untouched.
    const uncertain = value.state === 'PENDING' || !exists;
    if (!uncertain) {
      if (sessionStorage.getItem(pendingKey(value.conversation.viewerId, scope)) === value.requestId) sessionStorage.removeItem(pendingKey(value.conversation.viewerId, scope));
      setPending(current => current === value.requestId ? null : current);
    } else {
      sessionStorage.setItem(pendingKey(value.conversation.viewerId, scope), value.requestId); setPending(value.requestId);
    }
    setNotice(exists ? notices[value.state] : 'We haven’t confirmed whether this message was posted. Check again before sending it again.');
    return value;
  }
  async function send(shared?: Chat.Message, requestAssistant = scope === 'private') {
    const askAssistant = !shared && requestAssistant;
    if (turnGuard.current || !conversation || conversation.scope !== scope || pending) return;
    if (shared && sessionStorage.getItem(pendingKey(conversation.viewerId, 'group'))) { setScope('group'); return; }
    const text = shared?.text ?? drafts[scope].trim();
    if (!text || (!shared && askAssistant && !consent)) return;
    const sentScope = shared ? 'group' : scope, current = sequence.current;
    const post: Chat.Post = { requestId: crypto.randomUUID(), text, askAssistant: shared ? false : askAssistant,
      ...(!shared && askAssistant ? { processingConsent: 'CHAT_AI' as const } : {}), ...(shared ? { shareMessageId: shared.id } : {}) };
    const selectedKey = pendingKey(conversation.viewerId, sentScope);
    // Retain only an opaque selector for an interrupted send, never message text or tokens.
    sessionStorage.setItem(selectedKey, post.requestId); setPending(post.requestId);
    turnVersion.current++; turnGuard.current = true; setWorking(true); setActivity(askAssistant ? 'asking' : 'sending'); setNotice('');
    try {
      const response = await apiRef.current('/decisions/' + decisionId + '/chat/' + sentScope, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post), signal: lifetime.current?.signal ?? null });
      if (shared) {
        if (!response.ok) throw new Error('Share unavailable');
        const value = Chat.Receipt.parse(await response.json());
        if (value.requestId !== post.requestId || value.state !== 'POSTED' || value.conversation.scope !== 'group' || value.conversation.decisionId !== decisionId || value.conversation.viewerId !== conversation.viewerId) throw new Error('Wrong share receipt');
        if (sequence.current !== current) return;
        sessionStorage.removeItem(selectedKey); setPending(null); setShare(null); setScope('group');
      } else {
        const value = await accept(response, current, post.requestId);
        if (value) setDrafts(previous => ({ ...previous, [sentScope]: '' }));
      }
    } catch {
      if (sequence.current === current && !lifetime.current?.signal.aborted) {
        if (shared) { setShare(null); setScope('group'); }
        else { setReplyStates(states => ({ ...states, [post.requestId]: 'UNKNOWN' })); setNotice('We couldn’t confirm whether your message was posted. Check before sending it again.'); }
      }
    } finally { turnGuard.current = false; if (sequence.current === current) { setWorking(false); setActivity(null); } }
  }
  async function check(requestId: string) {
    if (turnGuard.current || pending && pending !== requestId) return;
    turnVersion.current++; const current = sequence.current; turnGuard.current = true; setWorking(true); setActivity('checking');
    try { await accept(await apiRef.current(base + '/requests/' + requestId, { signal: lifetime.current?.signal ?? null }), current, requestId); }
    catch { if (sequence.current === current) setNotice('We couldn’t check whether the message was posted. Please check again later.'); }
    finally { turnGuard.current = false; if (sequence.current === current) { setWorking(false); setActivity(null); } }
  }
  function changeTab(next: Chat.Scope) { if (working || next === scope) return; setScope(next); setReplyStates({}); }
  const currentConversation = conversation?.scope === scope && conversation.decisionId === decisionId ? conversation : null;
  const messages = currentConversation?.messages ?? [];
  return <Modal closeButton={false} ref={dialog} className="ke-alexa-chat ke-alexa-conversations" aria-labelledby="alexa-chat-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="alexa-chat-title">Chat</h2><p>{title}</p></div><button type="button" className="ke-alexa-close" aria-label="Close chat" onClick={onClose}><PageIcon name="X" /></button></header>
    <div className="ke-alexa-tabs" role="tablist" aria-label="Conversation">
      {(['group', 'private'] as const).map(tab => <button type="button" role="tab" key={tab} id={'alexa-tab-' + tab} aria-controls="alexa-conversation" aria-selected={scope === tab} tabIndex={scope === tab ? 0 : -1} disabled={working}
        onClick={() => changeTab(tab)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'group' : event.key === 'End' ? 'private' : scope === 'group' ? 'private' : 'group'; changeTab(next); document.getElementById('alexa-tab-' + next)?.focus(); } }}>
        <PageIcon name={tab === 'group' ? 'Users' : 'Lock'} />{labels[tab]}</button>)}
    </div>
    <div className="ke-alexa-audience"><PageIcon name={scope === 'group' ? 'Users' : 'Lock'} /><p>{scope === 'group' ? 'Everyone in this decision can see these messages.' : 'Other participants can’t see this conversation. You choose whether to share a message in Decision chat.'}</p></div>
    <div className="ke-alexa-body" id="alexa-conversation" role="tabpanel" aria-labelledby={'alexa-tab-' + scope} aria-busy={loading}>
      {loading ? <p role="status">Loading your conversation…</p> : !messages.length && <div className="ke-alexa-empty"><PageIcon name="MessageCircle" /><h3>{scope === 'group' ? 'A place to decide together' : 'A little space to think'}</h3><p>{scope === 'group' ? 'Post a message for everyone, or choose Post and ask AI for an assistant reply.' : 'Ask a question, explore ideas, or work through what matters to you.'}</p></div>}
      <ol className="ke-alexa-messages" role="log" aria-label={labels[scope]} aria-live="polite" aria-relevant="additions">
        {messages.map(message => <li key={message.id} className="ke-alexa-message" data-own={message.authorId === conversation?.viewerId} data-role={message.role}>
          <div className="ke-alexa-message-meta"><strong>{message.role === 'assistant' ? 'Assistant' : message.authorName}{message.authorId === conversation?.viewerId ? ' (you)' : ''}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>
          <p className="ke-alexa-bubble">{message.text}</p>
          {scope === 'private' && <button type="button" className="ke-alexa-share" disabled={working || !!pending} onClick={() => setShare(message)}>Share in Decision chat…</button>}
          {message.authorId === conversation?.viewerId && message.askAssistant && !messages.some(reply => reply.replyTo === message.id) && <div className="ke-alexa-reply-status" role="status">
            <span>{working && pending === message.id ? activity === 'checking' ? 'Checking reply status…' : 'Assistant is replying…' : replyStates[message.id] === 'UNAVAILABLE' ? 'Reply failed. Your message is saved.' : replyStates[message.id] === 'NOT_SUBMITTED' ? 'Reply did not start. Your message is saved.' : replyStates[message.id] === 'UNKNOWN' ? 'Reply not confirmed.' : replyStates[message.id] === 'PENDING' ? 'Reply pending.' : 'No reply yet.'}</span>
            <button type="button" className="ke-alexa-share" disabled={working || !!pending && pending !== message.id} onClick={() => void check(message.id)}>Check reply status</button>
          </div>}
        </li>)}
      </ol><div ref={end} />
      {scope === 'private' && share && <aside className="ke-alexa-share-preview" aria-label="Preview group message"><h3>Post this to Decision chat?</h3><p>Everyone in this decision will see this text, posted with your name.</p><blockquote>{share.text}</blockquote><div className="button-row"><button type="button" disabled={working || !!pending} onClick={() => void send(share)}>Post to Decision chat</button><button type="button" className="secondary" disabled={working} onClick={() => setShare(null)}>Keep private</button></div></aside>}
      {notice && <p role="status" className="ke-alexa-notice">{notice}</p>}
      {working && <p role="status" className="ke-alexa-working">{activity === 'checking' ? 'Checking reply status…' : share ? 'Posting your chosen text…' : activity === 'asking' ? 'Assistant is replying…' : 'Posting your message…'}</p>}
      {pending && <button type="button" className="secondary" disabled={working} onClick={() => void check(pending)}>Check send status</button>}
      {!conversation && !loading && <button type="button" className="secondary" disabled={working} onClick={() => setRefresh(value => value + 1)}>Refresh conversation</button>}
      <p className="ke-alexa-history-note">Replies describe the decision when sent. Open the decision for the latest progress.</p>
      <details className="ke-alexa-trace" open={details} onToggle={event => setDetails(event.currentTarget.open)}><summary>About the assistant</summary><p>{connection} · Connected to your decision.</p><ul>{trace.map(line => <li key={line}>{line}</li>)}</ul><p>The assistant uses your recent messages in this conversation and the shared options. It can’t read other participants’ messages or saved private answers, change your answers, or approve a proposal for anyone. This web preview is not a native Alexa+ connection.</p></details>
    </div>
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="alexa-question">{scope === 'group' ? 'Message everyone' : 'Message your private assistant'}</label>
      <div className="ke-alexa-composer" data-scope={scope}>
        <textarea ref={input} id="alexa-question" rows={2} maxLength={1000} autoComplete="off" value={drafts[scope]} onChange={event => setDrafts(previous => ({ ...previous, [scope]: event.target.value }))} placeholder={scope === 'group' ? 'Write a message or ask a question…' : 'What’s on your mind?'} />
        <button type="submit" className={scope === 'group' ? 'secondary' : undefined} disabled={!currentConversation || working || !!pending || !drafts[scope].trim() || scope === 'private' && !consent}>{scope === 'private' ? 'Ask assistant' : 'Post message'}<PageIcon name="ArrowRight" /></button>
        {scope === 'group' && <button type="button" disabled={!currentConversation || working || !!pending || !drafts.group.trim() || !consent} onClick={() => void send(undefined, true)}>Post and ask AI<PageIcon name="Sparkles" /></button>}
      </div>
      <label className="ke-alexa-check ke-alexa-consent"><input type="checkbox" checked={consent} disabled={working} onChange={event => setConsent(event.target.checked)} />I agree to AI using messages I send to the assistant and the shared options. It won’t read my saved private answers. Use made-up, non-sensitive information in this preview.</label>
      <p>Messages stay available for up to 30 days, or until the decision is deleted. The preview’s retention settings may shorten this time.</p>
    </form>
  </Modal>;
}
