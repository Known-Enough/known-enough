import { useEffect, useRef, useState } from 'react';
import { GroupDecisions } from './group-decisions';
import { Groups } from '@deal-table/contracts';
import { GroupIcon } from './app-chrome';
type LoadFailure = { title: string; description: string; reference: string | null };
export function GroupHome({ api, openDecision, selectedGroupId, onOpenGroup, onBack }: { api: (path: string, init?: RequestInit) => Promise<Response>;
  openDecision: (id: string) => void; selectedGroupId?: string; onOpenGroup: (id: string) => void; onBack: () => void }) {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<ReturnType<typeof Groups.AccountSnapshot.parse> | null>(null);
  const [groups, setGroups] = useState<Groups.GroupSnapshot[]>([]);
  const groupRequest = useRef<{ name: string; idempotencyKey: string } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [replace, setReplace] = useState(false);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [token, setToken] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get('groupInvite');
    if (value && /^[A-Za-z0-9_-]{32,80}$/.test(value)) {
      sessionStorage.setItem('ke-group-invite', JSON.stringify({ token: value, at: Date.now() }));
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    try { const stored = JSON.parse(sessionStorage.getItem('ke-group-invite') ?? 'null');
      if (stored && typeof stored.token === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(stored.token)
        && Number.isFinite(stored.at) && stored.at <= Date.now() && Date.now() - stored.at < 86400000) return stored.token as string;
    } catch { /* Invalid or expired tab-local link is discarded. */ }
    sessionStorage.removeItem('ke-group-invite'); return '';
  });
  useEffect(() => {
    const capture = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get('groupInvite');
      if (!value || !/^[A-Za-z0-9_-]{32,80}$/.test(value)) return;
      sessionStorage.setItem('ke-group-invite', JSON.stringify({ token: value, at: Date.now() }));
      setToken(value);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);
  const loadEpoch = useRef(0); const loadAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  async function load(preserveLink = false) {
    const epoch = ++loadEpoch.current; loadAbort.current?.abort();
    const controller = new AbortController(); loadAbort.current = controller;
    const current = () => mounted.current && epoch === loadEpoch.current;
    setChecking(true); setLoadFailure(null); if (!preserveLink) setLink('');
    let stage: 'account' | 'groups' | 'group' = 'account';
    let httpStatus: number | null = null, reference: string | null = null;
    const observe = (response: Response) => {
      httpStatus = response.status;
      const id = response.headers.get('apigw-requestid') ?? response.headers.get('x-amzn-requestid');
      reference = id && /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : null;
    };
    try {
      const response = await api('/account', {signal: controller.signal});
      observe(response);
      if (!response.ok) throw new Error('Account unavailable');
      const result = await response.json() as { account: unknown };
      const next = result.account ? Groups.AccountSnapshot.parse(result.account) : null;
      let nextGroups: Groups.GroupSnapshot[] = [];
      if (next?.status === 'APPROVED') {
        stage = selectedGroupId ? 'group' : 'groups'; httpStatus = null; reference = null;
        const response = await api(selectedGroupId ? '/groups/' + selectedGroupId : '/groups', {signal: controller.signal});
        observe(response);
        if (!response.ok) throw new Error('Groups unavailable');
        const result = await response.json() as { groups?: unknown[]; group?: unknown };
        if (!selectedGroupId && !Array.isArray(result.groups)) throw new Error('Invalid groups response');
        nextGroups = selectedGroupId ? [Groups.GroupSnapshot.parse(result.group)] : result.groups!.map(group => Groups.GroupSnapshot.parse(group));
      }
      if (!current()) return;
      setAvailable(true); setAccount(next); setGroups(nextGroups); setNotice('');
      if (next?.status !== 'APPROVED') {setLink(''); setEmail(''); setReplace(false);}
    } catch {
      if (!current()) return;
      setAvailable(false); setAccount(null); setGroups([]); setLink(''); setEmail(''); setReplace(false);
      const missingGroup = stage === 'group' && (httpStatus === 403 || httpStatus === 404);
      setLoadFailure({ title: missingGroup ? 'This group is unavailable' : stage === 'account' ? 'We couldn’t load your account' : stage === 'group' ? 'We couldn’t open this group' : 'We couldn’t load your groups',
        description: missingGroup ? 'The link may no longer be available to your account. Go back to your groups to continue.'
          : httpStatus === 401 ? 'Your session has expired. Sign in again to continue.'
          : httpStatus === null ? 'We couldn’t reach the service. Check your connection and try again.'
          : 'The service couldn’t load this view right now. Try again, or return to your groups.', reference });
      console.info('Known Enough group loading diagnostic', { stage, httpStatus,
        reason: httpStatus === null ? 'CONNECTION_OR_TIMEOUT' : httpStatus >= 400 ? 'HTTP_ERROR' : 'RESPONSE_FORMAT', ...(reference ? { reference } : {}) });
    } finally {if (current()) setChecking(false);}
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {mounted.current = false; ++loadEpoch.current; loadAbort.current?.abort();};
  }, []); // The component is keyed to the authenticated session.
  async function action(path: string, body: unknown, after?: (result: Record<string, unknown>) => boolean | void) {
    setBusy(true); setNotice('');
    try {
      const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        setNotice(response.status === 507 ? 'This pilot has reached its capacity. Ask the operator about capacity; retrying will not free space.'
          : response.status === 409 ? 'The group or link changed. Refresh and review before trying again.'
          : response.status === 403 ? 'Account approval or organizer access is required.'
          : 'This action could not be completed. Check access, the recipient and link expiry.'); return;
      }
      const result = await response.json() as Record<string, unknown>; if (!mounted.current) return; if (after?.(result) !== true) await load(true);
    } catch { setNotice('The result is unknown. Refresh before retrying; replace a lost invitation link explicitly.'); }
    finally { setBusy(false); }
  }
  if (checking) return <section className="ke-card ke-state-card" aria-busy="true" role="status"><span className="ke-state-icon"><GroupIcon /></span><h2>{selectedGroupId ? 'Opening your group…' : 'Loading your groups…'}</h2><p>Getting the latest account and group information.</p></section>;
  if (loadFailure) return <section className="ke-card ke-state-card ke-error-card" role="alert">
    <span className="ke-state-icon ke-warning-icon"><svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m14 6-11 19a2 2 0 0 0 2 3h22a2 2 0 0 0 2-3L18 6a2.3 2.3 0 0 0-4 0Z" /><path d="M16 13v6m0 4v1" strokeLinecap="round" /></svg></span>
    <h2>{loadFailure.title}</h2><p>{loadFailure.description}</p>
    <div className="ke-state-actions"><button type="button" onClick={() => void load()}>Try again</button>
      <button type="button" className="secondary" onClick={() => { if (selectedGroupId) onBack(); else void load(); }}>Back to groups</button></div>
    {loadFailure.reference && <small>Reference: {loadFailure.reference}</small>}
  </section>;
  return <section className={'ke-card ke-group-home' + (!selectedGroupId && account?.status === 'APPROVED' && !groups.length ? ' ke-group-home-empty' : '')} aria-busy={busy}><div className="ke-section-heading"><h2>{account?.status === 'APPROVED' ? selectedGroupId ? groups[0]?.name ?? 'Your group' : 'Your groups' : 'Account access'}</h2>
    {selectedGroupId && <button className="secondary" disabled={busy} onClick={onBack}>Back to groups</button>}
    <button className="secondary ke-refresh-button" disabled={busy} onClick={() => void load()}>Refresh account and groups</button></div>
    <fieldset disabled={busy || checking} style={{border: 0, padding: 0, minWidth: 0}} aria-label="Account and group actions">
    {available && !checking && !account && <p>Your account setup is still being completed. Refresh shortly, or contact the operator if it remains unavailable.</p>}
    {account?.status === 'PENDING' && <p>Your account is waiting for approval. You can edit your profile while the administrator reviews access.</p>}
    {account?.status === 'REJECTED' && <p>Your access request was declined. Contact the operator outside this app.</p>}
    {account?.status === 'DISABLED' && <p>Your access is disabled. Group and decision actions are unavailable.</p>}
    {account?.status === 'APPROVED' && <>
      {!selectedGroupId && <>
      {!groups.length && <div className="ke-empty-state"><span className="ke-state-icon"><GroupIcon /></span><h3>No groups yet</h3><p>Start a group with the people you want to decide with, or accept an invitation.</p></div>}
      <>{!creating && <button disabled={busy} onClick={() => setCreating(true)}>Create group</button>}{creating && <>
      <label htmlFor="new-group-name">New group name</label><input id="new-group-name" value={groupName} maxLength={80} disabled={!!groupRequest.current} onChange={event => setGroupName(event.target.value)} />
      <button disabled={busy || !groupName.trim()} onClick={() => { groupRequest.current ??= { name: groupName, idempotencyKey: crypto.randomUUID() }; void action('/groups', groupRequest.current, result => {
        const group = Groups.GroupSnapshot.parse(result.group); groupRequest.current = null; setGroupName(''); onOpenGroup(group.id); return true;
      }); }}>Create group</button></>}</>
      {token && <><p>A group invitation is waiting. Accepting joins the group; it does not confirm a decision or approve a proposal.</p>
        <button disabled={busy} onClick={() => void action('/groups/accept', { token }, result => { const group = Groups.GroupSnapshot.parse(result.group); setToken(''); sessionStorage.removeItem('ke-group-invite'); onOpenGroup(group.id); return true; })}>Accept group invitation</button>
        <button className="secondary" onClick={() => { setToken(''); sessionStorage.removeItem('ke-group-invite'); }}>Decline group invitation</button></>}
      <div className="ke-group-grid">{groups.map(group => <article key={group.id} className="ke-group-tile"><span className="ke-group-tile-icon"><GroupIcon /></span><h3>{group.name}</h3><p>{group.members.length} {group.members.length === 1 ? 'member' : 'members'}</p><button disabled={busy} onClick={() => onOpenGroup(group.id)}>Open group</button></article>)}</div>
      </>}
      {selectedGroupId && <>
      {groups.map(group => <article key={group.id}><details><summary>Group members and membership changes</summary><ul>{group.members.map(member => <li key={member.id}>{member.displayName}{member.isOrganizer ? ' (organizer)' : ''}
        {group.isOrganizer && !member.isOrganizer && <button className="secondary" disabled={busy} onClick={() => void action(`/groups/${group.id}/remove`, { memberId: member.id, version: group.version })}>Remove {member.displayName}</button>}</li>)}</ul>
        <p>{group.pendingInvitations} pending invitation links. Joining or removing a member requires linked decisions to be reviewed with a new roster.</p>
        </details><GroupDecisions group={group} api={api} reload={load} openDecision={openDecision} startCollapsed />
        {group.isOrganizer && <details><summary>Invite someone</summary><label htmlFor={`group-email-${group.id}`}>Recipient email</label><input id={`group-email-${group.id}`} type="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} />
          <label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /> Replace a lost link (the previous link stops working)</label>
          <button disabled={busy || !email.trim()} onClick={() => void action(`/groups/${group.id}/invitations`, { email, replace }, result => {
            if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,80}$/.test(result.token)) throw new Error('Invalid link');
            setLink(`${window.location.origin}${window.location.pathname}#groupInvite=${result.token}`); setEmail(''); setReplace(false);
          })}>Create invitation link</button></details>}
      </article>)}
      </>}
    </>}
    {link && <><p>Copy this recipient-bound link privately. It expires after 24 hours. No email has been sent. Share the link yourself only with the intended recipient.</p><label htmlFor="group-copy-link">Invitation link</label>
      <input id="group-copy-link" readOnly value={link} onFocus={event => event.currentTarget.select()} /><button className="secondary" onClick={() => setLink('')}>Hide invitation link</button></>}
    </fieldset>
    {(checking || busy || notice) && <p role="status">{checking ? 'Checking your account…' : busy ? 'Saving or checking the group…' : notice}</p>}
  </section>;
}
