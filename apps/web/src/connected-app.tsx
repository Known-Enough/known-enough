import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { beginCognitoSignIn, clearCognitoSession, cognitoApiFetch, cognitoLogoutUrl, finishCognitoSignIn, readCognitoSession,
  CognitoSignInFailure, type CognitoBrowserConfig, type CognitoSession } from './cognito-session';
import { AuthEntry } from './auth-entry';
import { ProfileDrawer } from './profile-drawer';
import { GroupHome } from './group-home';
import { ConnectedDecision } from './connected-decision';
import { decisionStatusText } from './decision-copy';
import { backgroundNegotiationAvailable, pollBackgroundDecision, type BackgroundTarget } from './background-negotiation';
import { readAppView, appViewSearch, saveIntendedView, takeIntendedView, type AppView } from './navigation';
let callbackCompletion: ReturnType<typeof finishCognitoSignIn> | null = null;
export function ConnectedApp({ config }: { config: CognitoBrowserConfig }) {
  const [session, setSession] = useState<CognitoSession | null>(() => readCognitoSession());
  const [view, setView] = useState<AppView>(() => readAppView(window.location.search));
  const [invitationEpoch, setInvitationEpoch] = useState(0);
  const [snapshot, setSnapshot] = useState<KE.PublicDecisionSnapshot | null>(null), [owner, setOwner] = useState<KE.OwnerDecisionSnapshot | null>(null);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [background, setBackground] = useState(false);
  const [target, setTarget] = useState<BackgroundTarget | null>(null);
  const epoch = useRef(0), abort = useRef<AbortController | null>(null), dirty = useRef(false);
  const selection = useRef({ id: '', token: '' }); selection.current = { id: view.kind === 'decision' ? view.decisionId : '', token: session?.accessToken ?? '' };
  function move(next: AppView, replace = false) {
    if (dirty.current && !window.confirm('Leave this view and discard unsaved input?')) return;
    dirty.current = false; epoch.current++; abort.current?.abort(); setSnapshot(null); setOwner(null); setTarget(null); setStatus(''); setBusy(false);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', window.location.pathname + appViewSearch(next)); setView(next);
  }
  useEffect(() => {
    const pop = () => {
      if (dirty.current && !window.confirm('Leave this view and discard unsaved input?')) { window.history.pushState(null, '', window.location.pathname + appViewSearch(view)); return; }
      dirty.current = false; epoch.current++; abort.current?.abort(); setSnapshot(null); setOwner(null); setTarget(null); setBusy(false); setView(readAppView(window.location.search));
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [view]);
  useLayoutEffect(() => {
    const capture = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1)), token = fragment.get('groupInvite');
      if (fragment.has('invite')) { fragment.delete('invite'); window.history.replaceState(null, '', window.location.pathname + window.location.search + (fragment.size ? '#' + fragment.toString() : '')); setStatus('This older invitation is unavailable here. Ask for a current group invitation.'); }
      if (!token || !/^[A-Za-z0-9_-]{32,80}$/.test(token)) return;
      sessionStorage.setItem('ke-group-invite', JSON.stringify({ token, at: Date.now() })); setInvitationEpoch(value => value + 1); fragment.delete('groupInvite');
      window.history.replaceState(null, '', window.location.pathname + window.location.search + (fragment.size ? '#' + fragment.toString() : ''));
      if (session) move({ kind: 'groups' });
    };
    capture(); window.addEventListener('hashchange', capture); return () => window.removeEventListener('hashchange', capture);
  }, [session]);
  const expire = useCallback(() => {
    epoch.current++; abort.current?.abort(); dirty.current = false; clearCognitoSession(); setSession(null); setSnapshot(null); setOwner(null); setTarget(null);
    setStatus('Your session expired. Sign in again to continue.');
  }, []);
  useEffect(() => { if (!session) return; const timeout = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now() - 5000)); return () => window.clearTimeout(timeout); }, [session, expire]);
  useEffect(() => {
    let active = true; callbackCompletion ??= finishCognitoSignIn(config);
    void callbackCompletion.then(result => { if (!active || !result) return; setSession(result); const wanted = takeIntendedView(); if (wanted) move(wanted, true); })
      .catch(error => {
        if (!active) return; const code = error instanceof CognitoSignInFailure ? error.code : 'HOSTED_ERROR';
        const observedAt = error instanceof CognitoSignInFailure ? error.observedAt : new Date().toISOString();
        console.info('Known Enough sign-in diagnostic', { environment: config.userPoolId, step: 'callback', code, observedAt });
        setStatus(`Sign-in could not be completed. Start again. Reference: ${code} at ${observedAt}.`);
      });
    return () => { active = false; };
  }, [config]);
  const signIn = async (kind: CognitoSession['kind']) => { try { saveIntendedView(view); window.location.assign(await beginCognitoSignIn(config, kind)); } catch { setStatus('Sign-in is unavailable. Check the app configuration.'); } };
  const signOut = () => { if (!session) return; const url = cognitoLogoutUrl(config, session); expire(); window.location.assign(url); };
  async function load() {
    if (!session || view.kind !== 'decision') return;
    const id = view.decisionId, token = session.accessToken, current = ++epoch.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setTarget(null); setBusy(true); setStatus(''); setSnapshot(null); setOwner(null);
    try {
      const pub = await cognitoApiFetch(config, session, `/decisions/${id}/public`, expire, { signal: controller.signal });
      if (!pub.ok) throw Object.assign(new Error('unavailable'), { status: pub.status }); const value = KE.PublicDecisionSnapshot.parse(await pub.json());
      if (value.frame.decisionId !== id) throw new Error('wrong decision');
      let privateValue: KE.OwnerDecisionSnapshot | null = null;
      if (session.kind === 'participant') {
        const response = await cognitoApiFetch(config, session, `/decisions/${id}/me`, expire, { signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('unavailable'), { status: response.status }); privateValue = KE.OwnerDecisionSnapshot.parse(await response.json());
        if (privateValue.publicSnapshot.frame.decisionId !== id || privateValue.publicSnapshot.contextToken !== value.contextToken || privateValue.publicSnapshot.semanticVersion !== value.semanticVersion || privateValue.publicSnapshot.publicRevision !== value.publicRevision) throw new Error('changed');
      }
      if (epoch.current !== current || selection.current.id !== id || selection.current.token !== token) return;
      setSnapshot(value); setOwner(privateValue); const available = backgroundNegotiationAvailable(pub); setBackground(available);
      if (available && privateValue && value.status === 'REASONING') setTarget({ decisionId: id, contextToken: value.contextToken,
        semanticVersion: value.semanticVersion, ownerParticipantId: privateValue.ownerParticipantId, expiresAt: new Date(Date.now() + 120000).toISOString() });
    } catch (error) { if (epoch.current === current) {
      setSnapshot(null); setOwner(null); setStatus('The shared decision is unavailable. Check your session or try again.');
      if (session.kind === 'participant' && error && typeof error === 'object' && 'status' in error && error.status === 403) {
        try { const response = await cognitoApiFetch(config, session, '/account', expire, { signal: controller.signal });
          const value = Groups.AccountSnapshot.parse((await response.json()).account);
          if (epoch.current === current && value.status !== 'APPROVED') { saveIntendedView(view); dirty.current = false; move({ kind: 'groups' }, true); }
        } catch { /* Keep private snapshots cleared without inventing an account state. */ }
      }
    } }
    finally { if (epoch.current === current) setBusy(false); }
  }
  useEffect(() => { let cancelled = false; if (view.kind === 'decision' && session) void Promise.resolve().then(() => { if (!cancelled) void load(); }); else { epoch.current++; abort.current?.abort(); setTarget(null); setSnapshot(null); setOwner(null); setBusy(false); }
    return () => { cancelled = true; epoch.current++; abort.current?.abort(); };
  }, [view, session]);
  useEffect(() => {
    if (!target || !session || session.kind !== 'participant') return;
    const controller = new AbortController(), id = target.decisionId, token = session.accessToken; let active = true;
    void pollBackgroundDecision({ target, signal: controller.signal, api: (path, init) => cognitoApiFetch(config, session, path, expire, init),
      accept: value => { if (active && selection.current.id === id && selection.current.token === token) { if (dirty.current) { setStatus('New progress is available. Finish or discard your input, then refresh.'); return; } setSnapshot(value.snapshot); setOwner(value.owner); } }
    }).then(result => { if (active) { setTarget(null); if (result === 'UNAVAILABLE' || result === 'CONTEXT_CHANGED') { setSnapshot(null); setOwner(null); } if (result !== 'SETTLED' && result !== 'CANCELLED') setStatus('Automatic checking stopped. Refresh this decision for its latest result.'); } })
      .catch(() => { if (active) { setTarget(null); setStatus('Automatic checking stopped. Refresh this decision for its latest result.'); } });
    return () => { active = false; controller.abort(); };
  }, [target, session, config, expire]);
  if (!session) return <AuthEntry config={config} signIn={signIn} notice={status} />;
  return <main className="ke-home">
    <header className="masthead ke-masthead"><div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div>
      {session.kind === 'participant' ? <ProfileDrawer key={session.accessToken} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} signOut={signOut} /> : <button type="button" className="secondary" onClick={signOut}>Sign out</button>}
    </header>
    <details className="ke-privacy-details"><summary>Privacy and preview limits</summary><p>Known Enough and its authorized AI process private inputs. Other people see shared choices and disclosures you authorize. Outcomes may imply private needs. Use fictional, non-sensitive data here.</p></details>
    {view.kind !== 'decision' && status && <p role="status">{status}</p>}
    {view.kind === 'invalid' ? <section className="ke-card"><h2>This link is unavailable</h2><button onClick={() => move({ kind: 'groups' }, true)}>Back to groups</button></section>
      : view.kind === 'decision' ? <>
        <button className="secondary" onClick={() => move(view.groupId ? { kind: 'group', groupId: view.groupId } : { kind: 'groups' })}>{view.groupId ? 'Back to group' : 'Back to groups'}</button>
        <section className="ke-card" aria-busy={busy}><h2>{snapshot?.frame.title ?? 'Your decision'}</h2>
          {snapshot && <p role="status">Status: {decisionStatusText(snapshot.status)}</p>}
          <button className="secondary" disabled={busy} onClick={() => { if (dirty.current && !window.confirm('Refresh and discard unsaved input?')) return; dirty.current = false; void load(); }}>Refresh decision</button>
          {(busy || status) && <p role="status">{busy ? 'Loading current decision…' : status}</p>}
        </section>
        {snapshot && <ConnectedDecision key={`${session.accessToken}:${snapshot.contextToken}:${snapshot.currentProposal?.proposalId ?? ''}:${owner?.ownerVersion ?? ''}:${owner?.draft?.draftId ?? ''}`}
          snapshot={snapshot} owner={owner} backgroundNegotiation={background} staged api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} refresh={async () => { dirty.current = false; await load(); }}
          onDirtyChange={value => { dirty.current = value; }} onQueued={receipt => { if (!owner) return; setTarget({ decisionId: snapshot.frame.decisionId, contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion, ownerParticipantId: owner.ownerParticipantId, expiresAt: receipt.expiresAt }); }} />}
      </> : session.kind === 'display' ? <section className="ke-card"><h2>Shared screen</h2><p>Open a shared decision link from your group to show its progress. This screen cannot enter private needs or approve proposals.</p></section>
        : <GroupHome key={`${session.accessToken}:${view.kind === 'group' ? view.groupId : 'home'}:${invitationEpoch}`} {...(view.kind === 'group' ? { selectedGroupId: view.groupId } : {})}
          api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} onOpenGroup={id => move({ kind: 'group', groupId: id })} onBack={() => move({ kind: 'groups' })}
          openDecision={id => move({ kind: 'decision', decisionId: id, ...(view.kind === 'group' ? { groupId: view.groupId } : {}) })} />}
  </main>;
}
