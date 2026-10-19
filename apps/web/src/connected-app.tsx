import { Modal } from './modal';
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
import { backgroundNegotiationAvailable, pollBackgroundDecision, type BackgroundTarget } from './background-negotiation';
import { readAppView, appViewSearch, saveIntendedView, takeIntendedView, type AppView } from './navigation';
let callbackCompletion: ReturnType<typeof finishCognitoSignIn> | null = null;
function decisionReadFailure(response: Response): Error & { status: number; reference?: string } {
  const reference = response.headers.get('x-request-id');
  return Object.assign(new Error('unavailable'), { status: response.status,
    ...(reference && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference) ? { reference } : {}) });
}
export function ConnectedApp({ config }: { config: CognitoBrowserConfig }) {
  const direct = useMemo(()=>createDirectCognito(config),[config]);
  const [session, setSession] = useState<CognitoSession | null>(() => readCognitoSession());
  // Token payload scopes a local presentation preference only; it never authorizes API access.
  const groupPreferencesKey = useMemo(() => {
    try {
      const part = session?.accessToken.split('.')[1];
      if (!part) return undefined;
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
      return typeof claims.sub === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)
        ? `known-enough-hidden-groups:${config.userPoolId}:${claims.sub}` : undefined;
    } catch { return undefined; }
  }, [session, config.userPoolId]);
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
      // The authenticated owner response already contains the atomic current
      // shared snapshot. Do not make participant loading depend on a second read.
      const response = await cognitoApiFetch(config, session, `/decisions/${id}/${session.kind === 'participant' ? 'me' : 'public'}`, expire, { signal: controller.signal });
      if (!response.ok) throw decisionReadFailure(response);
      const payload: unknown = await response.json();
      let privateValue: KE.OwnerDecisionSnapshot | null = null;
      if (session.kind === 'participant') privateValue = KE.OwnerDecisionSnapshot.parse(payload);
      const value = privateValue?.publicSnapshot ?? KE.PublicDecisionSnapshot.parse(payload);
      if (value.frame.decisionId !== id) throw new Error('wrong decision');
      if (epoch.current !== current || selection.current.id !== id || selection.current.token !== token) return;
      setDecisionTitle({ id, title: value.frame.title });
      setSnapshot(value); setOwner(privateValue); const available = backgroundNegotiationAvailable(response); setBackground(available);
      if (available && privateValue && value.status === 'REASONING') setTarget({ decisionId: id, contextToken: value.contextToken,
        semanticVersion: value.semanticVersion, ownerParticipantId: privateValue.ownerParticipantId, expiresAt: new Date(Date.now() + 120000).toISOString() });
      if (view.groupId && session.kind === 'participant') {
        // A renamed list title is cosmetic: publish the decision immediately,
        // then resolve its label with a short cancellable read, without busy UI.
        void cognitoApiFetch(config, session, `/groups/${view.groupId}`, expire, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        }).then(async result => {
          if (!result.ok) return;
          const label = Groups.GroupSnapshot.parse((await result.json()).group).decisions.find(item => item.id === id)?.title;
          if (label && epoch.current === current && selection.current.id === id && selection.current.token === token)
            setDecisionTitle({ id, title: label });
        }).catch(() => { /* Keep the current validated frame title. */ });
      }
    } catch (error) { if (epoch.current === current) {
      const reference = error && typeof error === 'object' && 'reference' in error && typeof error.reference === 'string'
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(error.reference) ? error.reference : null;
      setSnapshot(null); setOwner(null); setStatus('The shared decision is unavailable. Check your session or try again.'
        + (reference ? ` Reference: ${reference}.` : ''));
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
      : view.kind === 'decision' ? <Modal closeButton={false} ref={decisionDialog} className="ke-decision-wizard ke-open-decision-dialog" data-decision-id={snapshot?.frame.decisionId} aria-labelledby="open-decision-title" onCancel={event => { event.preventDefault(); move(view.groupId ? { kind: 'group', groupId: view.groupId } : { kind: 'groups' }); }}>
        <button type="button" className="secondary ke-response-close" aria-label="Close decision" onClick={() => move(view.groupId ? { kind: 'group', groupId: view.groupId } : { kind: 'groups' })}><PageIcon name="X" /></button>
        {!snapshot && <section className="ke-response-header" aria-busy={busy || !status}>
          <h2 id="open-decision-title">Your decision</h2>
          {!status && <LoadingSkeleton kind="decision" label="Loading current decision" />}
          {status && <><p role="status">{status}</p><button type="button" disabled={busy} aria-label="Refresh decision" onClick={() => { if (dirty.current && !window.confirm('Refresh and discard unsaved input?')) return; dirty.current = false; void load().catch(() => {}); }}>Try again</button></>}
        </section>}
        {snapshot && <div className="ke-load-reveal"><ConnectedDecision key={`${session.accessToken}:${snapshot.contextToken}`}
          snapshot={snapshot} owner={owner} backgroundNegotiation={background} staged
          mcpUrl={config.apiBaseUrl + '/mcp'} {...(view.groupId ? { groupId: view.groupId } : {})} title={decisionTitle?.id === snapshot.frame.decisionId ? decisionTitle.title : snapshot.frame.title} refreshing={busy}
          onRefresh={() => { if (dirty.current && !window.confirm('Refresh and discard unsaved input?')) return; dirty.current = false; void load().catch(() => {}); }} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} refresh={async () => { dirty.current = false; await load(); }}
          onDirtyChange={value => { dirty.current = value; }} onQueued={receipt => { if (!owner) return; setTarget({ decisionId: snapshot.frame.decisionId, contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion, ownerParticipantId: owner.ownerParticipantId, expiresAt: receipt.expiresAt }); }} /></div>}
      </Modal> : session.kind === 'display' ? <section className="ke-card"><h2>Shared screen</h2><p>Open a shared decision link from your group to show its progress. This screen cannot enter private needs or approve proposals.</p></section>
        : <GroupHome preferencesKey={groupPreferencesKey} key={`${session.accessToken}:${view.kind === 'group' ? view.groupId : 'home'}:${invitationEpoch}`} {...(view.kind === 'group' ? { selectedGroupId: view.groupId } : {})}
          api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} onOpenGroup={id => move({ kind: 'group', groupId: id })} onBack={() => move({ kind: 'groups' })} onDirtyChange={value => { dirty.current = value; }}
          openDecision={id => move({ kind: 'decision', decisionId: id, ...(view.kind === 'group' ? { groupId: view.groupId } : {}) })} />}
  </main>;
}
