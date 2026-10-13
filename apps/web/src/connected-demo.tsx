import { useCallback, useEffect, useRef, useState } from 'react';
import { KnownEnough } from '@deal-table/contracts';
import {
  beginCognitoSignIn, clearCognitoSession, clearPendingCognitoInvitation, cognitoApiFetch, cognitoLogoutUrl,
  finishCognitoSignIn, readCognitoSession, readPendingCognitoInvitation, CognitoSignInFailure,
  type CognitoBrowserConfig, type CognitoSession,
} from './cognito-session';
import { SimulatedSharedAssistant } from './simulated-shared-assistant';
import { decisionStatusText, privateReadinessText } from './decision-copy';
import { GroupHomeDemo } from './group-home-demo';
import { AuthEntry } from './auth-entry';
import { ProfileDrawer } from './profile-drawer';
import { LoadingSkeleton } from './app-chrome';
import { ConnectedDecision } from './connected-decision';
import { backgroundNegotiationAvailable, pollBackgroundDecision, type BackgroundTarget } from './background-negotiation';

const DECISION_ID = 'christmas-decision';
let callbackCompletion: Promise<CognitoSession | null> | null = null;
export function ConnectedDemo({ config }: { config: CognitoBrowserConfig }) {
  const initialId = new URLSearchParams(window.location.search).get('decision') ?? DECISION_ID;
  const [decisionId, setDecisionId] = useState(/^[A-Za-z0-9_-]{1,80}$/.test(initialId) ? initialId : DECISION_ID);
  const [roomInput, setRoomInput] = useState(decisionId);
  const [scenario, setScenario] = useState<'CHRISTMAS' | 'SHARED_PURCHASE'>('CHRISTMAS');
  const [objective, setObjective] = useState('Choose our synthetic Christmas trip together.');
  const loadEpoch = useRef(0);
  const decisionHeading = useRef<HTMLHeadingElement>(null);
  const quietUpdate = useRef(false);
  const [backgroundNegotiation, setBackgroundNegotiation] = useState(false);
  const [backgroundTarget, setBackgroundTarget] = useState<BackgroundTarget | null>(null);

  const createRequest = useRef<{ requestId: string; idempotencyKey: string; scenario: string; objective: string } | null>(null);
  const [session, setSession] = useState<CognitoSession | null>(() => readCognitoSession());
  const [publicSnapshot, setPublicSnapshot] = useState<KnownEnough.PublicDecisionSnapshot | null>(null);
  useEffect(() => { if (quietUpdate.current) { quietUpdate.current = false; return; } if (publicSnapshot) decisionHeading.current?.focus(); }, [publicSnapshot]);
  const [ownerSnapshot, setOwnerSnapshot] = useState<KnownEnough.OwnerDecisionSnapshot | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(() => readPendingCognitoInvitation());
  const [invitee, setInvitee] = useState('');
  const [replaceInvite, setReplaceInvite] = useState(false);
  const currentSelection = useRef({ decisionId, token: session?.accessToken });
  currentSelection.current = { decisionId, token: session?.accessToken };
  const [inviteLink, setInviteLink] = useState('');
  const expire = useCallback(() => {
    loadEpoch.current++;
    setBackgroundTarget(null);
    clearCognitoSession(); setSession(null); setPublicSnapshot(null); setOwnerSnapshot(null);
    setStatus('Your session expired or access was denied. Sign in again.');
  }, []);
  useEffect(() => {
    if (!backgroundTarget || !session || session.kind !== 'participant') return;
    const target = backgroundTarget; const token = session.accessToken; const controller = new AbortController(); let active = true;
    void pollBackgroundDecision({ target, signal: controller.signal,
      api: (path, init) => cognitoApiFetch(config, session, path, expire, init), accept: value => {
        if (!active || currentSelection.current.decisionId !== target.decisionId || currentSelection.current.token !== token) return;
        quietUpdate.current = true;
        setPublicSnapshot(value.snapshot); setOwnerSnapshot(value.owner);
      } }).then(result => {
        if (!active) return;
        setBackgroundTarget(null);
        if (result === 'EXPIRED' || result === 'UNAVAILABLE') setStatus('Automatic checking stopped. Refresh the decision to check its latest result.');
        else if (result === 'CONTEXT_CHANGED') setStatus('The decision changed. Refresh to review the current version.');
      }).catch(() => { if (active) { setBackgroundTarget(null); setStatus('Automatic checking stopped. Refresh the decision to check its latest result.'); } });
    return () => { active = false; controller.abort(); };
  }, [backgroundTarget, session, config, expire]);
  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(expire, Math.max(0, session.expiresAt - Date.now() - 5000));
    return () => window.clearTimeout(timeout);
  }, [session, expire]);
  useEffect(() => {
    let active = true;
    callbackCompletion ??= finishCognitoSignIn(config);
    void callbackCompletion.then(result => {
      if (active && result) { setSession(result); setStatus('Signed in. Open your group or review your account access to continue.'); }
    }).catch(error => {
      if (!active) return;
      const code = error instanceof CognitoSignInFailure ? error.code : 'HOSTED_ERROR';
      const observedAt = error instanceof CognitoSignInFailure ? error.observedAt : new Date().toISOString();
      const httpStatus = error instanceof CognitoSignInFailure ? error.httpStatus : undefined;
      console.info('Known Enough sign-in diagnostic', { environment: config.userPoolId, step: 'callback', code, observedAt,
        ...(httpStatus ? { httpStatus } : {}) });
      setStatus(`Sign-in could not be completed. Start again. Reference: ${code} at ${observedAt}.`);
    });
    return () => { active = false; };
  }, [config]);
  const groupInvite = new URLSearchParams(window.location.hash.slice(1)).get('groupInvite');
  if (groupInvite && /^[A-Za-z0-9_-]{32,80}$/.test(groupInvite)) {
    sessionStorage.setItem('ke-group-invite', JSON.stringify({ token: groupInvite, at: Date.now() }));
    const fragment = new URLSearchParams(window.location.hash.slice(1)); fragment.delete('groupInvite');
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (fragment.size ? '#' + fragment.toString() : ''));
  }
  const signIn = async (kind: CognitoSession['kind']) => {
    setStatus('');
    try { window.location.assign(await beginCognitoSignIn(config, kind)); }
    catch { setStatus('Sign-in is unavailable. Check the app configuration.'); }
  };
  const signOut = () => {
    if (!session) return;
    const url = cognitoLogoutUrl(config, session);
    loadEpoch.current++;
    setBackgroundTarget(null);
    clearCognitoSession(); setSession(null); setOwnerSnapshot(null); setPublicSnapshot(null);
    window.location.assign(url);
  };
  const load = async (targetId = decisionId) => {
    if (!session) return;
    const epoch = ++loadEpoch.current;
    setBackgroundTarget(null); setBackgroundNegotiation(false);
    setOwnerSnapshot(null); setPublicSnapshot(null);
    setBusy(true); setStatus('');
    try {
      const publicResponse = await cognitoApiFetch(config, session, `/decisions/${targetId}/public`, expire);
      if (!publicResponse.ok) throw new Error('unavailable');
      const publicValue = KnownEnough.PublicDecisionSnapshot.parse(await publicResponse.json());
      if (publicValue.frame.decisionId !== targetId) throw new Error('wrong decision');
      let ownerValue: KnownEnough.OwnerDecisionSnapshot | null = null;
      if (session.kind === 'participant') {
        const ownerResponse = await cognitoApiFetch(config, session, `/decisions/${targetId}/me`, expire);
        if (ownerResponse.status === 404) { setStatus('This account has not joined the decision yet. Redeem an invitation if you have one.'); }
        else if (!ownerResponse.ok) throw new Error('unavailable');
        else ownerValue = KnownEnough.OwnerDecisionSnapshot.parse(await ownerResponse.json());
        if (ownerValue && (ownerValue.publicSnapshot.contextToken !== publicValue.contextToken
          || ownerValue.publicSnapshot.semanticVersion !== publicValue.semanticVersion
          || ownerValue.publicSnapshot.publicRevision !== publicValue.publicRevision))
          throw new Error('stale snapshot');
      }
      if (epoch === loadEpoch.current) { setDecisionId(targetId); setRoomInput(targetId);
        const selected = ownerValue?.publicSnapshot ?? publicValue;
        const background = backgroundNegotiationAvailable(publicResponse);
        setPublicSnapshot(selected); setOwnerSnapshot(ownerValue); setBackgroundNegotiation(background);
        // A fresh signed read can resume result checking after a browser/device restart without submitting another job.
        if (background && ownerValue && selected.status === 'REASONING') setBackgroundTarget({ decisionId: targetId,
          contextToken: selected.contextToken, semanticVersion: selected.semanticVersion, ownerParticipantId: ownerValue.ownerParticipantId,
          expiresAt: new Date(Date.now() + 180000).toISOString() });
      }
    } catch { if (epoch === loadEpoch.current) setStatus('The shared decision is unavailable. Check your session or try again.'); }
    finally { if (epoch === loadEpoch.current) setBusy(false); }
  };
  const create = async () => {
    if (!session || session.kind !== 'participant' || !objective.trim()) return;
    const epoch = ++loadEpoch.current;
    setBusy(true); setStatus(''); setOwnerSnapshot(null); setPublicSnapshot(null);
    createRequest.current ??= { requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), scenario, objective: objective.trim() };
    try {
      const response = await cognitoApiFetch(config, session, '/decisions', expire, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createRequest.current) });
      if (!response.ok) {
        if (response.status < 500) createRequest.current = null;
        throw new Error('unavailable');
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('snapshot' in body)) throw new Error('invalid');
      const snapshot = KnownEnough.PublicDecisionSnapshot.parse(body.snapshot);
      if (epoch !== loadEpoch.current) return;
      createRequest.current = null; setDecisionId(snapshot.frame.decisionId); setRoomInput(snapshot.frame.decisionId);
      await load(snapshot.frame.decisionId);
    } catch { if (epoch === loadEpoch.current) setStatus('Creation is unavailable or its result is unknown. Retry the same request. Model services may still be disabled.'); }
    finally { if (epoch === loadEpoch.current) setBusy(false); }
  };
  const redeem = async () => {
    if (!session || !inviteToken) return;
    setBusy(true); setStatus('');
    try {
      const response = await cognitoApiFetch(config, session, `/decisions/${decisionId}/invitations/redeem`, expire, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), token: inviteToken }),
      });
      if (!response.ok) { setStatus('This invitation is invalid, expired, or unavailable to this account. Ask for a new link.'); return; }
      clearPendingCognitoInvitation(); setInviteToken(null); setStatus('Invitation accepted. Load the shared decision.');
    } catch { setStatus('The result is unknown. Keep this tab open and retry the same invitation.'); }
    finally { setBusy(false); }
  };
  const issue = async () => {
    if (!session || !invitee.trim()) return;
    setBusy(true); setStatus(''); setInviteLink('');
    try {
      const response = await cognitoApiFetch(config, session, `/decisions/${decisionId}/invitations`, expire, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), participantId: invitee.trim(),
          ...(replaceInvite ? { replaceActive: true } : {}) }),
      });
      if (response.status === 409) { setStatus('A live invitation may already exist. Replace it only if the prior link was lost.'); return; }
      if (!response.ok) throw new Error('unavailable');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string'
        || !/^[A-Za-z0-9_-]{1,80}$/.test(body.token)) throw new Error('invalid');
      setInviteLink(`${window.location.origin}${window.location.pathname}?decision=${encodeURIComponent(decisionId)}#invite=${encodeURIComponent(body.token)}`);
      setReplaceInvite(false); setStatus('Copy the one-time invitation link now. It will not be shown again.');
    } catch { setStatus('The result is unknown. Retry without replacement first; replace only if the previous link cannot be recovered.'); }
    finally { setBusy(false); }
  };
  if (!session) return <AuthEntry config={config} signIn={signIn} notice={status} />;
  return <main className="ke-home">
    <p className="local-note">Development demo · fictional templates and simulated assistant</p><header className="masthead ke-masthead"><div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div>
      {session.kind === 'participant' ? <ProfileDrawer key={session.accessToken} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} signOut={signOut} />
        : <button className="secondary" type="button" onClick={signOut}>Sign out</button>}</header>
    <p className="ke-privacy">Known Enough and its AI process your private inputs. Other people see only the shared choices, proposal and disclosures you authorize. An outcome may still reveal something about people’s needs. Use fictional, non-sensitive data in this preview.</p>
    {session && <>
      {session.kind === 'participant' && <GroupHomeDemo key={session.accessToken} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} openDecision={id => { setRoomInput(id); void load(id); }} />}
      <section className="ke-card"><p className="eyebrow">{session.kind === 'display' ? 'SHARED DISPLAY' : 'PARTICIPANT SESSION'}</p>
        <h2 ref={decisionHeading} tabIndex={-1}>Shared decision</h2><label htmlFor="connected-decision-id">Decision ID from your invitation</label>
        <input id="connected-decision-id" value={roomInput} maxLength={80} disabled={busy} onChange={event => { setBackgroundTarget(null); setRoomInput(event.target.value); setOwnerSnapshot(null); setPublicSnapshot(null); loadEpoch.current++; }} />
        <button type="button" onClick={() => void load(roomInput)} disabled={busy || !/^[A-Za-z0-9_-]{1,80}$/.test(roomInput)}>Load shared decision</button>
        {publicSnapshot && <><h3>{publicSnapshot.frame.title}</h3><p>{publicSnapshot.frame.objective}</p>
          <p>Status: {decisionStatusText(publicSnapshot.status)}</p>
          </>}
        {ownerSnapshot && <div className="local-note"><h3>Your private profile</h3>
          <p>{privateReadinessText(ownerSnapshot.ownInputReadiness)}
            Confirmed conditions: {ownerSnapshot.confirmedConstraints.filter(item => item.status === 'ACTIVE').length}.
            Private questions awaiting your answer: {ownerSnapshot.pendingQuestions.filter(question => question.status === 'PENDING').length}.
            Your current proposal approval: {ownerSnapshot.ownApproval ? 'recorded' : 'not recorded'}.</p>
          <p className="ke-help">Only your own private needs and questions appear here. Refresh after the decision or your group membership changes.</p></div>}
      </section>
      {session.kind === 'participant' && !publicSnapshot?.frame.decisionId.startsWith('groupdecision-') && <section className="ke-card"><h2>Optional fictional decision templates</h2>
        <p>For a new decision, use your group above. These two fictional templates require their preassigned test accounts. Each person still joins, confirms their needs and approves independently.</p>
        <label htmlFor="connected-scenario">Scenario</label><select id="connected-scenario" value={scenario} disabled={busy || !!createRequest.current} onChange={event => { setScenario(event.target.value as typeof scenario); setObjective(event.target.value === 'CHRISTMAS' ? 'Choose our synthetic Christmas trip together.' : 'Explore a hypothetical shared purchase together.'); }}>
          <option value="CHRISTMAS">Christmas trip</option><option value="SHARED_PURCHASE">Shared Purchase exploration</option></select>
        <label htmlFor="connected-objective">Public objective</label><textarea id="connected-objective" value={objective} maxLength={2000} disabled={busy || !!createRequest.current} onChange={event => setObjective(event.target.value)} />
        <p>This objective is shared. Keep personal limits in your private conversation.</p>
        <button disabled={busy || !objective.trim()} onClick={() => void create()}>{createRequest.current ? 'Retry creating the same decision' : 'Create AI frame for review'}</button>
      </section>}
      {publicSnapshot && <ConnectedDecision key={`${session.accessToken}:${publicSnapshot.contextToken}:${publicSnapshot.currentProposal?.proposalId ?? ''}:${ownerSnapshot?.ownerVersion ?? ''}:${ownerSnapshot?.draft?.draftId ?? ''}`}
        snapshot={publicSnapshot} owner={ownerSnapshot} backgroundNegotiation={backgroundNegotiation}
        onQueued={receipt => {
          if (!ownerSnapshot || currentSelection.current.decisionId !== publicSnapshot.frame.decisionId || currentSelection.current.token !== session.accessToken) return;
          setBackgroundTarget({ decisionId: publicSnapshot.frame.decisionId, contextToken: publicSnapshot.contextToken,
            semanticVersion: publicSnapshot.semanticVersion, ownerParticipantId: ownerSnapshot.ownerParticipantId, expiresAt: receipt.expiresAt });
        }} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} refresh={() => load()} />}
      <SimulatedSharedAssistant key={`${session.kind}:${session.accessToken}:${decisionId}`} snapshot={publicSnapshot}
        fetchPublic={async () => {
          const response = await cognitoApiFetch(config, session, `/decisions/${decisionId}/public`, expire);
          if (!response.ok) throw new Error('public view unavailable');
          const value = await response.json();
          const parsed = KnownEnough.PublicDecisionSnapshot.parse(value);
          if (parsed.frame.decisionId !== decisionId) throw new Error('wrong decision');
          return parsed;
        }}
        onFreshSnapshot={fresh => {
          setPublicSnapshot(fresh);
          setOwnerSnapshot(current => current && (current.publicSnapshot.contextToken !== fresh.contextToken
            || current.publicSnapshot.semanticVersion !== fresh.semanticVersion
            || current.publicSnapshot.publicRevision !== fresh.publicRevision) ? null : current);
        }} />
      {session.kind === 'participant' && !publicSnapshot?.frame.decisionId.startsWith('groupdecision-') && <section className="ke-card ke-invitation"><h2>Invitations</h2>
        {inviteToken && <><p>An invitation is waiting in this tab. Accept it with the account it was issued for.</p>
          <button type="button" onClick={() => void redeem()} disabled={busy}>Accept invitation</button>
          <button type="button" className="secondary" onClick={() => { clearPendingCognitoInvitation(); setInviteToken(null); }}>Discard invitation</button></>}
        <p>These invitations are for people already assigned to an optional fictional decision. Invite new people to your group above instead. Only the decision organizer can issue a link.</p>
        <label htmlFor="connected-invitee">Person in this fictional decision</label><select id="connected-invitee" value={invitee} onChange={event => setInvitee(event.target.value)}><option value="">Choose a person</option>{publicSnapshot?.frame.participants.filter(person => person.id !== ownerSnapshot?.ownerParticipantId).map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select>
        <label className="ke-checkbox"><input type="checkbox" checked={replaceInvite} onChange={event => setReplaceInvite(event.target.checked)} /> Replace an existing link</label>
        <button type="button" onClick={() => void issue()} disabled={busy || !invitee.trim()}>Issue invitation</button>
        {inviteLink && <><label htmlFor="connected-invite-link">One-time invitation link</label>
          <input id="connected-invite-link" readOnly value={inviteLink} onFocus={event => event.currentTarget.select()} />
          <button type="button" className="secondary" onClick={() => setInviteLink('')}>Hide link</button></>}
      </section>}
    </>}
    {busy && <LoadingSkeleton kind="inline" label="Checking or saving the decision" />}
    {!busy && status && <p role="status" className="local-note">{status}</p>}
  </main>;
}
