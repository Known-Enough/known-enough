import { createDirectCognito } from './cognito-direct';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { clearCognitoSession, cognitoApiFetch, cognitoLogoutUrl, finishCognitoSignIn, readCognitoSession,
  CognitoSignInFailure, type CognitoBrowserConfig, type CognitoSession } from './cognito-session';
import { AuthEntry } from './auth-entry';
import { ProfileDrawer } from './profile-drawer';
import { Brand, LoadingSkeleton, PageIcon, PrivacyBar, ThemeToggle, WelcomeHeading } from './app-chrome';
import { GroupHome } from './group-home';
import { ConnectedDecision } from './connected-decision';
import { decisionPhaseLabel, decisionStatusText } from './decision-copy';
import { backgroundNegotiationAvailable, pollBackgroundDecision, type BackgroundTarget } from './background-negotiation';
import { readAppView, appViewSearch, saveIntendedView, takeIntendedView, type AppView } from './navigation';
let callbackCompletion: ReturnType<typeof finishCognitoSignIn> | null = null;
export function ConnectedApp({ config }: { config: CognitoBrowserConfig }) {
  const direct = useMemo(()=>createDirectCognito(config),[config]);
  const [session, setSession] = useState<CognitoSession | null>(() => readCognitoSession());
  const [view, setView] = useState<AppView>(() => readAppView(window.location.search));
  const [callbackPending, setCallbackPending] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.has('code') || query.has('error') || query.has('state');
  });
  const [invitationEpoch, setInvitationEpoch] = useState(0);
  const [snapshot, setSnapshot] = useState<KE.PublicDecisionSnapshot | null>(null), [owner, setOwner] = useState<KE.OwnerDecisionSnapshot | null>(null);
  const [decisionTitle, setDecisionTitle] = useState<{ id: string; title: string } | null>(null);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [background, setBackground] = useState(false);
  const [target, setTarget] = useState<BackgroundTarget | null>(null);
  const decisionDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = decisionDialog.current;
    if (view.kind !== 'decision' || !session || !element) return;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [view.kind, !!session]);
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
    direct.signOut(); epoch.current++; abort.current?.abort(); dirty.current = false; clearCognitoSession(); setSession(null); setSnapshot(null); setOwner(null); setTarget(null);
    setStatus('Your session expired. Sign in again to continue.');
  }, [direct]);
  useEffect(() => { if (!session) return; const timeout = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now() - 5000)); return () => window.clearTimeout(timeout); }, [session, expire]);
  useEffect(()=>{if(!session||session.method!=='SRP'||!direct.canRefresh())return;let active=true;const timer=window.setTimeout(()=>{void direct.refresh().then(value=>{if(active){sessionStorage.setItem('known-enough-cognito-session',JSON.stringify(value));setSession(value);}}).catch(()=>{if(active)expire();});},Math.max(0,session.expiresAt-Date.now()-60000));return()=>{active=false;window.clearTimeout(timer);};},[session,direct,expire]);
  useEffect(() => {
    let active = true; callbackCompletion ??= finishCognitoSignIn(config);
    void callbackCompletion.then(result => { if (!active) return; setCallbackPending(false); if (!result) return; setSession(result); const wanted = takeIntendedView(); if (wanted) move(wanted, true); })
      .catch(error => {
        if (!active) return; const code = error instanceof CognitoSignInFailure ? error.code : 'HOSTED_ERROR';
        setCallbackPending(false);
        const observedAt = error instanceof CognitoSignInFailure ? error.observedAt : new Date().toISOString();
        console.info('Known Enough sign-in diagnostic', { environment: config.userPoolId, step: 'callback', code, observedAt });
        setStatus(`Sign-in could not be completed. Start again. Reference: ${code} at ${observedAt}.`);
      });
    return () => { active = false; };
  }, [config]);
  const signOut = () => { if (!session) return; direct.signOut(); const legacy=session.method!=='SRP'; const url=legacy?cognitoLogoutUrl(config,session):null; expire(); if(url)window.location.assign(url); };
  async function load(preserve = true) {
    if (!session || view.kind !== 'decision') return;
    const id = view.decisionId, token = session.accessToken, current = ++epoch.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setTarget(null); setBusy(true); setStatus(''); if (!preserve) { setSnapshot(null); setOwner(null); }
    try {
      const pub = await cognitoApiFetch(config, session, `/decisions/${id}/public`, expire, { signal: controller.signal });
      if (!pub.ok) throw Object.assign(new Error('unavailable'), { status: pub.status }); const value = KE.PublicDecisionSnapshot.parse(await pub.json());
      if (value.frame.decisionId !== id) throw new Error('wrong decision');
      let privateValue: KE.OwnerDecisionSnapshot | null = null;
      if (session.kind === 'participant') {
        const response = await cognitoApiFetch(config, session, `/decisions/${id}/me`, expire, { signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('unavailable'), { status: response.status }); privateValue = KE.OwnerDecisionSnapshot.parse(await response.json());
        if (privateValue.publicSnapshot.frame.decisionId !== id) throw new Error('wrong decision');
      }
      let label: string | undefined;
      if (view.kind === 'decision' && view.groupId && session.kind === 'participant') {
        try { const response = await cognitoApiFetch(config, session, `/groups/${view.groupId}`, expire, { signal: controller.signal });
          if (response.ok) label = Groups.GroupSnapshot.parse((await response.json()).group).decisions.find(item => item.id === id)?.title;
        } catch { /* A cosmetic label must not prevent decision recovery. */ }
      }
      if (epoch.current !== current || selection.current.id !== id || selection.current.token !== token) return;
      setDecisionTitle({ id, title: label ?? value.frame.title });
      setSnapshot(privateValue?.publicSnapshot ?? value); setOwner(privateValue); const available = backgroundNegotiationAvailable(pub); setBackground(available);
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
    } throw error; }
    finally { if (epoch.current === current) setBusy(false); }
  }
  useEffect(() => { let cancelled = false; if (view.kind === 'decision' && session) void Promise.resolve().then(() => { if (!cancelled) void load(false).catch(() => {}); }); else { epoch.current++; abort.current?.abort(); setTarget(null); setSnapshot(null); setOwner(null); setBusy(false); }
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
  if (!session) return <AuthEntry config={config} direct={direct} onSession={value=>{sessionStorage.setItem('known-enough-cognito-session',JSON.stringify(value));setSession(value);setStatus('');const wanted=takeIntendedView();if(wanted)move(wanted,true);}} notice={status} callbackPending={callbackPending} />;
  return <main className={view.kind === 'group' ? 'ke-home ke-group-route' : view.kind === 'groups' ? 'ke-home ke-groups-dashboard' : 'ke-home'}>
    <header className="ke-masthead"><Brand onNavigate={() => move({ kind: 'groups' })} /><div className="ke-header-actions">
      <ThemeToggle />
      {session.kind === 'participant' ? <ProfileDrawer key={session.accessToken} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} signOut={signOut} /> : <button type="button" className="secondary" onClick={signOut}>Sign out</button>}
    </div>
    </header>
    <WelcomeHeading />
    <PrivacyBar />
    {view.kind !== 'decision' && status && <p role="status">{status}</p>}
    {view.kind === 'invalid' ? <section className="ke-card"><h2>This link is unavailable</h2><button onClick={() => move({ kind: 'groups' }, true)}>Back to groups</button></section>
      : view.kind === 'decision' ? <dialog ref={decisionDialog} className="ke-decision-wizard ke-open-decision-dialog" data-decision-id={snapshot?.frame.decisionId} aria-labelledby="open-decision-title" onCancel={event => { event.preventDefault(); move(view.groupId ? { kind: 'group', groupId: view.groupId } : { kind: 'groups' }); }}>
        <button className="secondary ke-response-close" aria-label="Close decision" onClick={() => move(view.groupId ? { kind: 'group', groupId: view.groupId } : { kind: 'groups' })}><PageIcon name="X" /></button>
        <section className={`ke-card ke-response-header${snapshot ? ' ke-load-reveal' : ''}`} aria-busy={busy || (!snapshot && !status)}><span className="ke-wizard-eyebrow">Group decision</span>
          <h2 id="open-decision-title">{snapshot ? decisionTitle?.id === snapshot.frame.decisionId ? decisionTitle.title : snapshot.frame.title : 'Your decision'}</h2>
          <div className="ke-response-header-meta">{snapshot && <span className="ke-response-phase" data-finished={['AGREED', 'CLOSED'].includes(snapshot.status)} role="status" title={decisionStatusText(snapshot.status)}>{decisionPhaseLabel(snapshot.status)}</span>}
          <button className="ke-response-text-button" aria-label="Refresh decision" disabled={busy} onClick={() => { if (dirty.current && !window.confirm('Refresh and discard unsaved input?')) return; dirty.current = false; void load().catch(() => {}); }}><PageIcon name="RefreshCw" />{busy ? 'Refreshing…' : 'Refresh'}</button></div>
          {!snapshot && !status && <LoadingSkeleton kind="decision" label="Loading current decision" />}
          {!snapshot && status && <p role="status">{status}</p>}
        </section>
        {snapshot && <div className="ke-load-reveal"><ConnectedDecision key={`${session.accessToken}:${snapshot.contextToken}`}
          snapshot={snapshot} owner={owner} backgroundNegotiation={background} staged api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} refresh={async () => { dirty.current = false; await load(); }}
          onDirtyChange={value => { dirty.current = value; }} onQueued={receipt => { if (!owner) return; setTarget({ decisionId: snapshot.frame.decisionId, contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion, ownerParticipantId: owner.ownerParticipantId, expiresAt: receipt.expiresAt }); }} /></div>}
      </dialog> : session.kind === 'display' ? <section className="ke-card"><h2>Shared screen</h2><p>Open a shared decision link from your group to show its progress. This screen cannot enter private needs or approve proposals.</p></section>
        : <GroupHome key={`${session.accessToken}:${view.kind === 'group' ? view.groupId : 'home'}:${invitationEpoch}`} {...(view.kind === 'group' ? { selectedGroupId: view.groupId } : {})}
          api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} onOpenGroup={id => move({ kind: 'group', groupId: id })} onBack={() => move({ kind: 'groups' })} onDirtyChange={value => { dirty.current = value; }}
          openDecision={id => move({ kind: 'decision', decisionId: id, ...(view.kind === 'group' ? { groupId: view.groupId } : {}) })} />}
  </main>;
}
