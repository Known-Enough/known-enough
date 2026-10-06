import { useCallback, useEffect, useRef, useState } from 'react';
import { KnownEnough } from '@deal-table/contracts';
import {
  beginCognitoSignIn, clearCognitoSession, clearPendingCognitoInvitation, cognitoApiFetch, cognitoLogoutUrl,
  finishCognitoSignIn, readCognitoSession, readPendingCognitoInvitation, CognitoSignInFailure,
  type CognitoBrowserConfig, type CognitoSession,
} from './cognito-session';
import { SimulatedSharedAssistant } from './simulated-shared-assistant';
import { decisionStatusText, privateReadinessText } from './decision-copy';
import { GroupHome } from './group-home';
import { EmailRegistration } from './email-registration-form';
import { ConnectedDecision } from './connected-decision';

const DECISION_ID = 'christmas-decision';
let callbackCompletion: Promise<CognitoSession | null> | null = null;
export function ConnectedApp({ config }: { config: CognitoBrowserConfig }) {
  const initialId = new URLSearchParams(window.location.search).get('decision') ?? DECISION_ID;
  const [decisionId, setDecisionId] = useState(/^[A-Za-z0-9_-]{1,80}$/.test(initialId) ? initialId : DECISION_ID);
  const [roomInput, setRoomInput] = useState(decisionId);
  const [scenario, setScenario] = useState<'CHRISTMAS' | 'SHARED_PURCHASE'>('CHRISTMAS');
  const [objective, setObjective] = useState('Choose our synthetic Christmas trip together.');
  const loadEpoch = useRef(0);
  const createRequest = useRef<{ requestId: string; idempotencyKey: string; scenario: string; objective: string } | null>(null);
  const [session, setSession] = useState<CognitoSession | null>(() => readCognitoSession());
  const [publicSnapshot, setPublicSnapshot] = useState<KnownEnough.PublicDecisionSnapshot | null>(null);
  const [ownerSnapshot, setOwnerSnapshot] = useState<KnownEnough.OwnerDecisionSnapshot | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(() => readPendingCognitoInvitation());
  const [invitee, setInvitee] = useState('');
  const [replaceInvite, setReplaceInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const expire = useCallback(() => {
    loadEpoch.current++;
    clearCognitoSession(); setSession(null); setPublicSnapshot(null); setOwnerSnapshot(null);
    setStatus('Your session expired or access was denied. Sign in again.');
  }, []);
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
  if (groupInvite && /^[A-Za-z0-9_-]{32,80}$/.test(groupInvite)) sessionStorage.setItem('ke-group-invite', JSON.stringify({ token: groupInvite, at: Date.now() }));
  const signIn = async (kind: CognitoSession['kind']) => {
    setStatus('');
    try { window.location.assign(await beginCognitoSignIn(config, kind)); }
    catch { setStatus('Sign-in is unavailable. Check the app configuration.'); }
  };
  const signOut = () => {
    if (!session) return;
    const url = cognitoLogoutUrl(config, session);
    loadEpoch.current++;
    clearCognitoSession(); setSession(null); setOwnerSnapshot(null); setPublicSnapshot(null);
    window.location.assign(url);
  };
  const load = async (targetId = decisionId) => {
    if (!session) return;
    const epoch = ++loadEpoch.current;
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
        setPublicSnapshot(ownerValue?.publicSnapshot ?? publicValue); setOwnerSnapshot(ownerValue); }
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
  return <main className="ke-home">
    <header className="masthead ke-masthead"><div><p className="eyebrow">KNOWN ENOUGH</p><h1>Decide together</h1></div>
      {session && <button className="secondary" type="button" onClick={signOut}>Sign out</button>}</header>
    <p className="ke-privacy">Known Enough and its AI process your private inputs. Other people see only the shared choices, proposal and disclosures you authorize. An outcome may still reveal something about people’s needs. Use fictional, non-sensitive data in this preview.</p>
    {!session ? <section className="ke-card ke-auth-card"><h2>Sign in to the shared decision</h2>
      <p>New account? Choose Register with email below, then verify your address. After verification, use Sign in. If the provider sign-in page offers Sign up, return here to use email registration. Group invitations wait in this browser tab while you sign in. A shared display uses a separate account and can only read public information.</p>
      <div className="ke-private-actions"><button type="button" onClick={() => void signIn('participant')}>Sign in</button>
        <button type="button" className="secondary" onClick={() => void signIn('display')}>Shared display sign-in</button></div><EmailRegistration config={config} /></section> : <>
      {session.kind === 'participant' && <GroupHome key={session.accessToken} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} openDecision={id => { setRoomInput(id); void load(id); }} />}
      <section className="ke-card"><p className="eyebrow">{session.kind === 'display' ? 'SHARED DISPLAY' : 'PARTICIPANT SESSION'}</p>
        <h2>Shared decision</h2><label htmlFor="connected-decision-id">Decision ID from your invitation</label>
        <input id="connected-decision-id" value={roomInput} maxLength={80} disabled={busy} onChange={event => { setRoomInput(event.target.value); setOwnerSnapshot(null); setPublicSnapshot(null); loadEpoch.current++; }} />
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
        snapshot={publicSnapshot} owner={ownerSnapshot} api={(path, init) => cognitoApiFetch(config, session, path, expire, init)} refresh={() => load()} />}
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
    {(busy || status) && <p role="status" className="local-note">{busy ? 'Checking or saving the decision…' : status}</p>}
  </main>;
}
