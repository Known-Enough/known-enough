import { useEffect, useRef, useState } from 'react';
import { GroupDecisions } from './group-decisions';
import { Groups } from '@deal-table/contracts';
export function GroupHome({ api, openDecision }: { api: (path: string, init?: RequestInit) => Promise<Response>;
  openDecision: (id: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<ReturnType<typeof Groups.AccountSnapshot.parse> | null>(null);
  const [groups, setGroups] = useState<Groups.GroupSnapshot[]>([]);
  const groupRequest = useRef<{ name: string; idempotencyKey: string } | null>(null);
  const [name, setName] = useState(''); const [groupName, setGroupName] = useState('');
  const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [replace, setReplace] = useState(false);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
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
  async function load() {
    setChecking(true);
    const response = await api('/account');
    if (!response.ok) { setChecking(false); setAvailable(false); throw new Error('Account information is unavailable.'); }
    const result = await response.json() as { account: unknown };
    const next = result.account ? Groups.AccountSnapshot.parse(result.account) : null;
    setAvailable(true); setChecking(false); setAccount(next); if (next?.status !== 'APPROVED') setGroups([]);
    if (next?.status === 'APPROVED') {
      const response = await api('/groups');
      if (!response.ok) { setGroups([]); throw new Error('Groups are unavailable. Refresh or sign in again.'); }
      const result = await response.json() as { groups: unknown[] };
      setGroups(result.groups.map(group => Groups.GroupSnapshot.parse(group)));
    }
  }
  useEffect(() => { let active = true; void load().catch(() => { if (active) { setChecking(false); setNotice('Groups are unavailable. Try refreshing; this preview may not include group onboarding.'); } });
    return () => { active = false; }; }, []); // The component is keyed to the authenticated session.
  async function action(path: string, body: unknown, after?: (result: Record<string, unknown>) => void) {
    setBusy(true); setNotice('');
    try {
      const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        setNotice(response.status === 409 ? 'The group or link changed. Refresh and review before trying again.'
          : response.status === 403 ? 'Account approval or organizer access is required.'
          : 'This action could not be completed. Check access, the recipient and link expiry.'); return;
      }
      const result = await response.json() as Record<string, unknown>; after?.(result); await load();
    } catch { setNotice('The result is unknown. Refresh before retrying; replace a lost invitation link explicitly.'); }
    finally { setBusy(false); }
  }
  return <section className="ke-card" aria-busy={busy}><h2>Your account and groups</h2>
    <p>Register through the sign-in page and verify your email. Then request access here. Global access approval and accepting a group invitation are separate.</p>
    <button className="secondary" disabled={busy} onClick={() => { void load().catch(() => setNotice('Refresh failed. Sign in again if needed.')); }}>Refresh account and groups</button>
    {available && !checking && !account && <><label htmlFor="group-display-name">Your display name</label><input id="group-display-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      <button disabled={busy || !name.trim()} onClick={() => void action('/account/register', { displayName: name })}>Request access</button></>}
    {account?.status === 'PENDING' && <p>Access request pending. The operator must approve it before you create or join groups.</p>}
    {account?.status === 'REJECTED' && <p>Your access request was declined. Contact the operator outside this app.</p>}
    {account?.status === 'DISABLED' && <p>Your access is disabled. Group and decision actions are unavailable.</p>}
    {account?.status === 'APPROVED' && <>
      <p>Access approved for {account.displayName}. Create a group or accept an invitation, then describe what your group should decide.</p>
      <label htmlFor="new-group-name">New group name</label><input id="new-group-name" value={groupName} maxLength={80} disabled={!!groupRequest.current} onChange={event => setGroupName(event.target.value)} />
      <button disabled={busy || !groupName.trim()} onClick={() => { groupRequest.current ??= { name: groupName, idempotencyKey: crypto.randomUUID() }; void action('/groups', groupRequest.current, () => { groupRequest.current = null; setGroupName(''); }); }}>Create group</button>
      {token && <><p>A group invitation is waiting. Accept it only if you want to join; it does not confirm a decision or approve a proposal.</p>
        <button disabled={busy} onClick={() => void action('/groups/accept', { token }, () => { setToken(''); sessionStorage.removeItem('ke-group-invite'); })}>Accept group invitation</button>
        <button className="secondary" onClick={() => { setToken(''); sessionStorage.removeItem('ke-group-invite'); }}>Discard group invitation</button></>}
      {groups.map(group => <article key={group.id}><h3>{group.name}</h3><ul>{group.members.map(member => <li key={member.id}>{member.displayName}{member.isOrganizer ? ' (organizer)' : ''}
        {group.isOrganizer && !member.isOrganizer && <button className="secondary" disabled={busy} onClick={() => void action(`/groups/${group.id}/remove`, { memberId: member.id, version: group.version })}>Remove {member.displayName}</button>}</li>)}</ul>
        <p>{group.pendingInvitations} pending invitation links. Joining or removing a member requires linked decisions to be reviewed with a new roster.</p>
        <GroupDecisions group={group} api={api} reload={load} openDecision={openDecision} />
        {group.isOrganizer && <><label htmlFor={`group-email-${group.id}`}>Recipient email</label><input id={`group-email-${group.id}`} type="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} />
          <label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /> Replace a lost link (the previous link stops working)</label>
          <button disabled={busy || !email.trim()} onClick={() => void action(`/groups/${group.id}/invitations`, { email, replace }, result => {
            if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,80}$/.test(result.token)) throw new Error('Invalid link');
            setLink(`${window.location.origin}${window.location.pathname}#groupInvite=${result.token}`); setEmail(''); setReplace(false);
          })}>Create invitation link</button></>}
      </article>)}
    </>}
    {link && <><p>Copy this recipient-bound link privately. It expires after 24 hours. No email has been sent. Share the link yourself only with the intended recipient.</p><label htmlFor="group-copy-link">Invitation link</label>
      <input id="group-copy-link" readOnly value={link} onFocus={event => event.currentTarget.select()} /><button className="secondary" onClick={() => setLink('')}>Hide invitation link</button></>}
    {(checking || busy || notice) && <p role="status">{checking ? 'Checking your account…' : busy ? 'Saving or checking the group…' : notice}</p>}
  </section>;
}
