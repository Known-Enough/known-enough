import { useEffect, useRef, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Alexa } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';
import { liveDecisionCopy, liveDecisionResult } from './live-decision';

type Api = (path: string, init?: RequestInit) => Promise<Response>;
type Readback = { key: string; value: Alexa.DecisionSummary | null; checkedAt: string | null; reading: boolean; connected: boolean; failed: boolean };

export function useLiveDecision(decisionId: string, endpoint: string, api: Api) {
  const key = decisionId + ':' + endpoint, apiRef = useRef(api); apiRef.current = api;
  const [readback, setReadback] = useState<Readback>({ key, value: null, checkedAt: null, reading: true, connected: false, failed: false });
  const readRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const controller = new AbortController();
    let client: Client | null = null, running: Promise<void> | null = null;
    setReadback({ key, value: null, checkedAt: null, reading: true, connected: false, failed: false });
    async function read() {
      if (controller.signal.aborted) return;
      if (running) return running;
      setReadback(previous => ({ ...previous, reading: true }));
      running = (async () => {
        try {
          if (!client) {
            client = new Client({ name: 'known-enough-web-simulator', version: '2.1.0' });
            const url = URL.parse(endpoint);
            if (!url || url.protocol !== 'https:' || url.pathname !== '/mcp' || url.search || url.hash) throw new Error('Invalid MCP endpoint');
            const transport = new StreamableHTTPClientTransport(url, {
              fetch: async (url, init) => {
                if ((typeof url === 'string' ? url : url.href) !== endpoint) throw new Error('Unexpected endpoint');
                return apiRef.current('/mcp', { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
              },
              reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
            });
            await client.connect(transport as Parameters<Client['connect']>[0], { timeout: 15000, signal: controller.signal });
            const tools = await client.listTools({}, { timeout: 15000, signal: controller.signal });
            if (!Alexa.TOOL_NAMES.every(name => tools.tools.some(tool => tool.name === name))) throw new Error('Missing shared tools');
          }
          const result = await client.callTool({ name: 'get_decision_outcome', arguments: { decisionId } }, undefined, { timeout: 15000, signal: controller.signal });
          const value = liveDecisionResult(result, decisionId);
          if (!controller.signal.aborted) setReadback({ key, value, checkedAt: new Date().toISOString(), reading: false, connected: true, failed: false });
        } catch {
          // Never leave an old outcome labelled live after a failed or denied read.
          if (!controller.signal.aborted) setReadback({ key, value: null, checkedAt: null, reading: false, connected: false, failed: true });
          const failed = client; client = null;
          await failed?.close().catch(() => {});
        }
      })();
      try { await running; } finally { running = null; }
    }
    readRef.current = read;
    const visibleRead = () => { if (document.visibilityState !== 'hidden') void read(); };
    const unavailable = () => { if (!controller.signal.aborted) setReadback({ key, value: null, checkedAt: null, reading: false, connected: false, failed: true }); };
    void read();
    const timer = window.setInterval(visibleRead, 20000);
    window.addEventListener('focus', visibleRead); window.addEventListener('online', visibleRead);
    window.addEventListener('offline', unavailable); document.addEventListener('visibilitychange', visibleRead);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', visibleRead); window.removeEventListener('online', visibleRead);
      window.removeEventListener('offline', unavailable); document.removeEventListener('visibilitychange', visibleRead);
      void client?.close().catch(() => {});
    };
  }, [decisionId, endpoint, key]);
  return { ...(readback.key === key ? readback : { key, value: null, checkedAt: null, reading: true, connected: false, failed: false }), refresh: () => readRef.current() };
}

export function LiveDecisionCard({ live, onReview, disabled, reviewBlocked }: {
  live: ReturnType<typeof useLiveDecision>; onReview: () => Promise<void>; disabled: boolean; reviewBlocked: boolean;
}) {
  const [opening, setOpening] = useState(false), [error, setError] = useState(false);
  const copy = live.value ? liveDecisionCopy(live.value) : null;
  async function review() {
    setOpening(true); setError(false);
    try { await onReview(); } catch { setError(true); } finally { setOpening(false); }
  }
  return <section className="ke-chat-decision-card" aria-label="Live decision" aria-busy={live.reading} data-agreed={live.value?.status === 'AGREED'}>
    <header><span className="ke-chat-decision-live"><span aria-hidden="true" />Live decision</span>
      <button type="button" className="ke-chat-decision-refresh" aria-label="Refresh live decision" title="Refresh decision" disabled={live.reading} onClick={() => void live.refresh()}><PageIcon name="RefreshCw" /></button></header>
    {live.value && copy ? <>
      <h3>{copy.label}</h3><p className="ke-chat-decision-title">{live.value.title}</p>
      {copy.hasOutcome && <>
        <dl>{live.value.choices.map((choice, index) => <div key={index}><dt>{choice.topic}</dt><dd>{choice.option}</dd></div>)}</dl>
        <p className="ke-chat-decision-approvals"><PageIcon name={live.value.status === 'AGREED' ? 'Check' : 'Users'} />{live.value.approved} of {live.value.requiredApprovals} approved</p>
        <button type="button" className="ke-chat-decision-review" disabled={disabled || opening || live.reading} onClick={() => void review()}>{opening ? 'Opening outcome…' : live.value.status === 'AGREED' ? 'View agreed outcome' : 'Review proposal'}<PageIcon name="ArrowRight" /></button>
        {reviewBlocked && <p className="ke-chat-decision-explanation">Save or cancel your decision edits before opening the outcome.</p>}
      </>}
      <p className="ke-chat-decision-explanation">{copy.explanation}</p>
      <p className="ke-chat-decision-checked">{live.reading ? 'Updating…' : <>Checked <time dateTime={live.checkedAt ?? undefined}>{live.checkedAt ? new Date(live.checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}</time> · Saved decision</>}</p>
    </> : <p className="ke-chat-decision-explanation" role="status">{live.failed ? 'We couldn’t check the current decision. Refresh to try again.' : 'Checking the current decision…'}</p>}
    {error && <p className="ke-chat-decision-explanation" role="status">We couldn’t open the latest outcome. Refresh the decision and try again.</p>}
  </section>;
}
