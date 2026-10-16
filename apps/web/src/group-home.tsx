import { MemberAvatar } from './member-avatar';
import { RenameAction } from './rename-action';
import { useEffect, useRef, useState } from 'react';
import { GroupDecisions } from './group-decisions';
import { Groups } from '@deal-table/contracts';
import { GroupIcon, LoadingSkeleton, PageIcon } from './app-chrome';
import { ProfileModal, type ProfileTarget } from './profile-drawer';
type LoadFailure = { title: string; description: string; reference: string | null };
export function GroupHome({ api, openDecision, selectedGroupId, onOpenGroup, onBack, onDirtyChange }: { api: (path: string, init?: RequestInit) => Promise<Response>;
  openDecision: (id: string) => void; selectedGroupId?: string; onOpenGroup: (id: string) => void; onBack: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [childDirty, setChildDirty] = useState(false);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<ReturnType<typeof Groups.AccountSnapshot.parse> | null>(null);
  const [groups, setGroups] = useState<Groups.GroupSnapshot[]>([]);
  const [invitations, setInvitations] = useState<Groups.InvitationSnapshot[]>([]);
  const [invitationFailure, setInvitationFailure] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [activeMenuGroupId, setActiveMenuGroupId] = useState<string | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [renameGroupNotice, setRenameGroupNotice] = useState('');
  const renameGroupDialog = useRef<HTMLDialogElement | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteGroupNotice, setDeleteGroupNotice] = useState('');
  const deleteGroupDialog = useRef<HTMLDialogElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuActionRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const groupRequest = useRef<{ name: string; idempotencyKey: string; requestId: string } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [recipient, setRecipient] = useState(''); const [link, setLink] = useState('');
  useEffect(() => { onDirtyChange?.(childDirty || !!groupName.trim() || !!recipient.trim()); }, [childDirty, groupName, recipient, onDirtyChange]);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  useEffect(() => { if (activeMenuGroupId) menuActionRef.current?.focus(); }, [activeMenuGroupId]);
  useEffect(() => { const dialog = renameGroupDialog.current; if (renameGroupId) { if (dialog && !dialog.open) dialog.showModal(); } else dialog?.close(); }, [renameGroupId]);
  useEffect(() => { const dialog = deleteGroupDialog.current; if (deleteGroupId) { if (dialog && !dialog.open) dialog.showModal(); } else dialog?.close(); }, [deleteGroupId]);
  useEffect(() => {
    if (!activeMenuGroupId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setActiveMenuGroupId(null);
      menuTriggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const target = event.target;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setActiveMenuGroupId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [activeMenuGroupId]);
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
    setChecking(true); setLoadFailure(null); setInvitationFailure(null); if (!preserveLink) setLink('');
    let stage: 'account' | 'groups' | 'group' | 'invitations' = 'account';
    let httpStatus: number | null = null, reference: string | null = null;
    let emailConflict = false;
    const observe = (response: Response) => {
      httpStatus = response.status;
      const id = response.headers.get('apigw-requestid') ?? response.headers.get('x-amzn-requestid');
      reference = id && /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : null;
    };
    const diagnostic = (error: unknown) => {
      console.info('Known Enough group loading diagnostic', { stage, httpStatus,
        reason: error instanceof Error && error.message === 'Invalid API path' ? 'CLIENT_PATH_BLOCKED'
          : httpStatus === null ? 'CONNECTION_OR_TIMEOUT' : httpStatus >= 400 ? 'HTTP_ERROR' : 'RESPONSE_FORMAT', ...(reference ? { reference } : {}) });
    };
    try {
      const response = await api('/account', {signal: controller.signal});
      observe(response);
      if (!response.ok) throw new Error('Account unavailable');
      let result = await response.json() as { account: unknown };
      if (!result.account) {
        if (!current()) return;
        // Recover missed intake with the current verified server identity. The server
        // enforces email ownership and only creates a pending account, never approval.
        const registration = await api('/account/register', { method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'New member' }) });
        observe(registration);
        const value = await registration.json() as { account: unknown; registrationFailure?: unknown };
        if (!registration.ok) {
          emailConflict = registration.status === 409 && value.registrationFailure === 'EMAIL_ALREADY_LINKED';
          throw new Error('Account registration unavailable');
        }
        if (!value.account) throw new Error('Account registration unavailable');
        result = value;
      }
      const next = result.account ? Groups.AccountSnapshot.parse(result.account) : null;
      let nextGroups: Groups.GroupSnapshot[] = [];
      let nextInvitations: Groups.InvitationSnapshot[] = [];
      let nextInvitationFailure: string | null = null;
      if (next?.status === 'APPROVED') {
        stage = selectedGroupId ? 'group' : 'groups'; httpStatus = null; reference = null;
        const response = await api(selectedGroupId ? '/groups/' + selectedGroupId : '/groups', {signal: controller.signal});
        observe(response);
        if (!response.ok) throw new Error('Groups unavailable');
        const result = await response.json() as { groups?: unknown[]; group?: unknown };
        if (!selectedGroupId && !Array.isArray(result.groups)) throw new Error('Invalid groups response');
        nextGroups = selectedGroupId ? [Groups.GroupSnapshot.parse(result.group)] : result.groups!.map(group => Groups.GroupSnapshot.parse(group));
        if (!selectedGroupId) {
          stage = 'invitations'; httpStatus = null; reference = null;
          try {
            const pendingResponse = await api('/invitations', { signal: controller.signal }); observe(pendingResponse);
            if (!pendingResponse.ok) throw new Error('Invitations unavailable');
            const pending = await pendingResponse.json() as { invitations?: unknown[] };
            if (!Array.isArray(pending.invitations)) throw new Error('Invalid invitations response');
            nextInvitations = pending.invitations.map(value => Groups.InvitationSnapshot.parse(value));
          } catch (error) {
            if (!current()) return;
            diagnostic(error);
            nextInvitationFailure = 'Your groups are available, but invitations could not be checked. Try again.';
          }
        }
      }
      if (!current()) return;
      setAvailable(true); setAccount(next); setGroups(nextGroups); setInvitations(nextInvitations); setInvitationFailure(nextInvitationFailure); setNotice('');
      if (next?.status !== 'APPROVED') {setLink(''); setRecipient(''); setInvitations([]);}
    } catch (error) {
      if (!current()) return;
      setAvailable(false); setAccount(null); setGroups([]); setInvitations([]); setLink(''); setRecipient('');
      const missingGroup = stage === 'group' && (httpStatus === 403 || httpStatus === 404);
      setLoadFailure({ title: emailConflict ? 'This email already has an account' : missingGroup ? 'This group is unavailable' : stage === 'account' ? 'We couldn’t load your account' : stage === 'group' ? 'We couldn’t open this group' : stage === 'invitations' ? 'We couldn’t load your invitations' : 'We couldn’t load your groups',
        description: emailConflict ? 'Sign out and sign in with your original username, or use Forgot password on the sign-in screen. To create a separate account, use a different email address.'
          : missingGroup ? 'The link may no longer be available to your account. Go back to your groups to continue.'
          : httpStatus === 401 ? 'Your session has expired. Sign in again to continue.'
          : httpStatus === null ? 'We couldn’t reach the service. Check your connection and try again.'
          : stage === 'invitations' ? 'Your groups loaded, but invitations could not be checked. Refresh to try again.'
          : 'The service couldn’t load this view right now. Try again, or return to your groups.', reference });
      diagnostic(error);
    } finally {if (current()) setChecking(false);}
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {mounted.current = false; ++loadEpoch.current; loadAbort.current?.abort();};
  }, []); // The component is keyed to the authenticated session.
  async function action(path: string, body: unknown, after?: (result: Record<string, unknown>) => boolean | void,
    onDefinitiveFailure?: (status: number) => void, requestId?: string) {
    setBusy(true); setNotice('');
    try {
      const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) }, body: JSON.stringify(body) });
      if (!response.ok) {
        if ((response.status >= 400 && response.status < 500) || response.status === 507) onDefinitiveFailure?.(response.status);
        let reference = response.headers.get('x-request-id') ?? response.headers.get('apigw-requestid') ?? '';
        try {
          const errorBody = await response.clone().json() as { requestId?: unknown };
          if (typeof errorBody.requestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(errorBody.requestId)) reference = errorBody.requestId;
        } catch { /* The HTTP status remains useful when an error body is unavailable. */ }
        const message = response.status === 507 ? 'This pilot has reached its capacity. Ask the operator about capacity; retrying will not free space.'
          : response.status === 409 ? 'The group or link changed. Refresh and review before trying again.'
          : response.status === 403 ? 'Account approval or organizer access is required.'
          : 'This action could not be completed. Check access, the recipient and link expiry.';
        setNotice(message + (reference && /^[A-Za-z0-9_-]{8,80}$/.test(reference) ? ` Reference: ${reference}.` : '')); return;
      }
      const result = await response.json() as Record<string, unknown>; if (!mounted.current) return; if (after?.(result) !== true) await load(true);
    } catch { setNotice('The result is unknown. Refresh to check before trying again.'
      + (requestId ? ` Reference: ${requestId}.` : '')); }
    finally { setBusy(false); }
  }
  function openGroupMenu(groupId: string, trigger: HTMLButtonElement) {
    menuTriggerRef.current = trigger;
    setActiveMenuGroupId(groupId);
  }
  function toggleGroupMenu(groupId: string, trigger: HTMLButtonElement) {
    menuTriggerRef.current = trigger;
    setActiveMenuGroupId(current => current === groupId ? null : groupId);
  }
  const renameTarget = groups.find(group => group.id === renameGroupId) ?? null;
  const deleteTarget = groups.find(group => group.id === deleteGroupId) ?? null;
  const groupSections = [
    { heading: 'Groups you own', groups: groups.filter(group => group.isOrganizer) },
    { heading: 'Groups you’re a member of', groups: groups.filter(group => !group.isOrganizer) },
  ].filter(section => section.groups.length > 0);
  if (checking && !available) return <LoadingSkeleton kind={selectedGroupId ? 'group' : 'groups'} label={selectedGroupId ? 'Opening your group' : 'Loading your groups'}
    className={selectedGroupId ? 'ke-group-route-loading' : 'ke-group-home'} />;
  if (loadFailure) return <section className="ke-card ke-state-card ke-error-card" role="alert">
    <span className="ke-state-icon ke-warning-icon"><svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m14 6-11 19a2 2 0 0 0 2 3h22a2 2 0 0 0 2-3L18 6a2.3 2.3 0 0 0-4 0Z" /><path d="M16 13v6m0 4v1" strokeLinecap="round" /></svg></span>
    <h2>{loadFailure.title}</h2><p>{loadFailure.description}</p>
    <div className="ke-state-actions"><button type="button" onClick={() => void load()}>Try again</button>
      <button type="button" className="secondary" onClick={() => { if (selectedGroupId) onBack(); else void load(); }}>Back to groups</button></div>
    {loadFailure.reference && <small>Reference: {loadFailure.reference}</small>}
  </section>;
  return <section className={(selectedGroupId ? 'ke-group-page' : 'ke-group-home') + ' ke-load-reveal'} aria-busy={busy || checking}>
    {!selectedGroupId && <div className="ke-section-heading ke-groups-heading">
      <div className="ke-section-title"><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="UsersRound" /></span>
        <div><h2>{account?.status === 'APPROVED' ? 'Decision groups' : 'Account access'}</h2>
          {account?.status === 'APPROVED' && <p>Your shared decision spaces, all in one place.</p>}</div></div>
      <div className="ke-section-actions">
        {account?.status === 'APPROVED' && <button type="button" className={`ke-create-group-action${creating ? ' secondary' : ''}`} disabled={busy || checking}
          onClick={() => setCreating(value => !value)}>{creating ? <span>Cancel</span> : <><PageIcon name="Plus" /><span>Create group</span></>}</button>}
        <button type="button" className="secondary ke-refresh-button ke-refresh-icon" aria-label="Refresh account and groups" title="Refresh groups" disabled={busy} onClick={() => void load()}><PageIcon name="RefreshCw" /></button>
      </div>
    </div>}
    <fieldset className={selectedGroupId ? 'ke-group-detail-controls' : undefined} disabled={busy || checking}
      style={{border: 0, padding: 0, minWidth: 0}} aria-label={selectedGroupId ? 'Group details and actions' : 'Account and group actions'}>
    {available && !checking && !account && <p>Your account setup is still being completed. Refresh shortly, or contact the operator if it remains unavailable.</p>}
    {account?.status === 'PENDING' && <p>Your account is waiting for approval. You can edit your profile while the administrator reviews access.</p>}
    {account?.status === 'REJECTED' && <p>Your access request was declined. Contact the operator outside this app.</p>}
    {account?.status === 'DISABLED' && <p>Your access is disabled. Group and decision actions are unavailable.</p>}
    {account?.status === 'APPROVED' && <>
      {!selectedGroupId && <>
      {creating && <div className="ke-create-group-form"><div><label htmlFor="new-group-name">New group name</label>
        <input id="new-group-name" value={groupName} maxLength={80} disabled={!!groupRequest.current} onChange={event => setGroupName(event.target.value)} /></div>
        <button disabled={busy || !groupName.trim()} onClick={() => { const pending = groupRequest.current ?? { name: groupName, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }; groupRequest.current = pending; void action('/groups', { name: pending.name, idempotencyKey: pending.idempotencyKey }, result => {
        const group = Groups.GroupSnapshot.parse(result.group); groupRequest.current = null; setGroupName(''); onOpenGroup(group.id); return true;
      }, status => { if ((status >= 400 && status < 500) || status === 507) groupRequest.current = null; }, pending.requestId); }}>Create group</button></div>}
      {!groups.length && <div className="ke-empty-state"><span className="ke-state-icon"><GroupIcon /></span><h3>No groups yet.</h3><p>Start a group with the people you want to decide with, or accept an invitation.</p></div>}
      {token && <><p>A group invitation is waiting. Accepting joins the group; it does not confirm a decision or approve a proposal.</p>
        <button disabled={busy} onClick={() => void action('/groups/accept', { token }, result => { const group = Groups.GroupSnapshot.parse(result.group); setToken(''); sessionStorage.removeItem('ke-group-invite'); onOpenGroup(group.id); return true; })}>Accept group invitation</button>
        <button className="secondary" onClick={() => { setToken(''); sessionStorage.removeItem('ke-group-invite'); }}>Decline group invitation</button></>}
      <section className="ke-card ke-dashboard-invitations" aria-labelledby="pending-invitations-heading">
        <header className="ke-panel-heading"><div><h3 id="pending-invitations-heading"><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="Mail" /></span><span>Invitations for you</span></h3>
          <p className="ke-panel-subtitle">Invitations sent to you. Accept one to join the group.</p></div>
          {!invitationFailure && <span className="ke-count-badge" aria-label={`${invitations.length} pending invitations for you`}>{invitations.length}</span>}</header>
        {invitationFailure ? <div role="status"><p>{invitationFailure}</p>
          <button type="button" className="secondary" disabled={busy || checking} onClick={() => void load()}>Retry invitations</button></div>
          : invitations.length ? <ul className="ke-pending-invitations">{invitations.map(invitation => <li key={invitation.id}>
          <div><strong>{invitation.groupName}</strong><span>Invited by {invitation.organizerName}</span>
            <small>Expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>
          <button type="button" disabled={busy} onClick={() => void action('/groups/accept', { groupId: invitation.groupId, invitationId: invitation.id }, result => {
            const group = Groups.GroupSnapshot.parse(result.group); setInvitations(current => current.filter(value => value.id !== invitation.id)); onOpenGroup(group.id); return true;
          })}>Accept invitation</button>
        </li>)}</ul> : <p>No pending invitations.</p>}
      </section>
      {!!groups.length && <div className="ke-group-sections">{groupSections.map(section => <section className="ke-group-section" key={section.heading}>
        <h3>{section.heading}</h3><ul className="ke-group-list" aria-label={section.heading}>{section.groups.map(group => {
        const decisionCount = Array.isArray(group.decisions) ? group.decisions.length : null;
        const menuOpen = activeMenuGroupId === group.id;
        const menuId = `group-actions-${group.id}`;
        return <li key={group.id} className={`ke-group-row${menuOpen ? ' ke-group-row-menu-open' : ''}`}>
          <button type="button" className="secondary ke-group-row-open" aria-label={`Open group ${group.name}`} disabled={busy}
            onClick={() => onOpenGroup(group.id)}>
            <span className="ke-group-row-icon"><GroupIcon /></span>
            <span className="ke-group-row-copy"><span className="ke-group-row-name">{group.name}</span>
              <span className="ke-group-row-meta"><span>{group.members.length} {group.members.length === 1 ? 'member' : 'members'}</span>
                {decisionCount !== null && <><span className="ke-group-row-separator" aria-hidden="true">·</span><span>{decisionCount} {decisionCount === 1 ? 'decision' : 'decisions'}</span></>}</span>
            </span>
            <PageIcon name="ChevronRight" />
          </button>
          <div className="ke-group-row-actions">
          <button type="button" className="secondary ke-group-menu-trigger" aria-label={`Details and actions for ${group.name}`} aria-haspopup="dialog"
              aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} disabled={busy}
              onClick={event => { event.stopPropagation(); toggleGroupMenu(group.id, event.currentTarget); }}
              onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openGroupMenu(group.id, event.currentTarget); } }}>
              <PageIcon name="Ellipsis" />
            </button>
            {menuOpen && <div id={menuId} className="ke-group-actions-menu" role="dialog" aria-label={`${group.name} details and actions`} ref={menuRef}
              onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
                const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                  : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                if (items.length) items[nextIndex]?.focus();
              }}
              onBlur={event => {
                const next = event.relatedTarget;
                if (next instanceof Node && (event.currentTarget.contains(next) || menuTriggerRef.current?.contains(next))) return;
                setActiveMenuGroupId(null);
              }}>
              <h3 className="ke-group-menu-title">{group.name}</h3>
              <section className="ke-group-menu-section" aria-label="Members">
                <h4>Members <span>{group.members.length}</span></h4>
                <ul>{group.members.map(member => <li key={member.id}>{member.displayName}{member.isOrganizer ? <small>Organizer</small> : null}</li>)}</ul>
              </section>
              <section className="ke-group-menu-section" aria-label="Decisions">
                <h4>Decisions <span>{decisionCount ?? 0}</span></h4>
                {group.decisions.length ? <ul>{group.decisions.map(decision => <li key={decision.id}>{decision.title ?? 'Untitled decision'}{!decision.current && <small>Needs review</small>}</li>)}</ul>
                  : <p className="ke-group-menu-empty">No decisions yet.</p>}
              </section>
              <div className="ke-group-menu-actions">
                <button type="button" className="secondary ke-group-menu-item" role="menuitem" ref={menuActionRef}
                  onClick={event => { event.stopPropagation(); setActiveMenuGroupId(null); onOpenGroup(group.id); }}>Open group</button>
                {group.isOrganizer && <>
                  <button type="button" className="secondary ke-group-menu-item" role="menuitem"
                    onClick={event => { event.stopPropagation(); setActiveMenuGroupId(null); setRenameGroupValue(group.name); setRenameGroupNotice(''); setRenameGroupId(group.id); }}>Rename group</button>
                  <button type="button" className="secondary ke-group-menu-item ke-group-menu-delete" role="menuitem"
                    onClick={event => { event.stopPropagation(); setActiveMenuGroupId(null); setDeleteGroupNotice(''); setDeleteGroupId(group.id); }}>Delete group</button>
                </>}
              </div>
            </div>}
          </div>
        </li>;
      })}</ul></section>)}</div>}
      </>}
      {selectedGroupId && groups.map(group => {
        const organizer = group.members.find(member => member.isOrganizer);
        return <div className="ke-group-detail-stack" key={group.id}>
          <section className="ke-card ke-group-overview" aria-label="Group overview">
            <div className="ke-group-overview-copy">
              <p className="ke-eyebrow"><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="UsersRound" /></span><span>GROUP OVERVIEW</span></p>
              <h2>{group.name}</h2>{group.isOrganizer && <RenameAction name={group.name} save={async name => {
                const response = await api(`/groups/${group.id}/name`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: group.version, previousName: group.name, name }) });
                if (!response.ok) throw new Error('unavailable'); await load();
              }} />}
              <div className="ke-group-summary">
                <div><span>Organizer</span><strong>{organizer?.displayName ?? 'Group organizer'}</strong></div>
                <div><span>Members</span><strong>{group.members.length} {group.members.length === 1 ? 'member' : 'members'}</strong></div>
                <div><span>Pending invitations</span><strong>{group.pendingInvitations}</strong></div>
              </div>
            </div>
            <nav className="ke-group-overview-actions" aria-label="Group navigation">
              <button type="button" className="secondary ke-icon-action" onClick={onBack}><PageIcon name="ArrowLeft" />Back to groups</button>
              <button type="button" className="ke-refresh-button ke-icon-action" onClick={() => void load()}><PageIcon name="RefreshCw" />Refresh group</button>
            </nav>
          </section>

          <div className="ke-group-panels">
            <section className="ke-card ke-group-panel ke-members-panel" aria-labelledby={`members-heading-${group.id}`}>
              <header className="ke-panel-heading">
                <div><h2 id={`members-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="Users" /></span><span>Members</span></h2><p className="ke-panel-subtitle">Manage members and membership changes.</p></div>
                <span className="ke-count-badge" aria-label={`${group.members.length} members`}>{group.members.length}</span>
              </header>
              <ul className="ke-member-list">{group.members.map(member => <li key={member.id}>
                <button type="button" className="ke-member-profile-trigger" aria-label={`View ${member.displayName}'s profile`}
                  onClick={event => { profileTriggerRef.current = event.currentTarget; setProfileTarget({ kind: 'member', groupId: group.id, memberId: member.id }); }}>
                  <MemberAvatar api={api} groupId={group.id} memberId={member.id} name={member.displayName} revision={avatarRevision} />
                  <span className="ke-member-name">{member.displayName}{member.isOrganizer && <span className="ke-member-role">Organizer</span>}</span>
                </button>
                {group.isOrganizer && !member.isOrganizer && <button type="button" className="secondary ke-remove-member" disabled={busy}
                  onClick={() => void action(`/groups/${group.id}/remove`, { memberId: member.id, version: group.version })}>Remove {member.displayName}</button>}
              </li>)}</ul>
              <details className="ke-membership-note"><summary>About membership changes</summary>
                <p>Joining the group leaves existing decisions unchanged. The organizer can include new people in an ongoing decision without resetting earlier answers. Finished decisions keep their outcome. Removing members still requires the existing decision review.</p>
              </details>
            </section>

            <GroupDecisions group={group} api={api} reload={load} openDecision={openDecision} onDirtyChange={setChildDirty} startCollapsed />

            {group.isOrganizer && <section className="ke-card ke-group-panel ke-invitations-panel" aria-labelledby={`invitations-heading-${group.id}`}>
              <header className="ke-panel-heading"><div><h2 id={`invitations-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="Mail" /></span><span>Invite someone</span></h2>
                <p className="ke-panel-subtitle">Enter their Known Enough username or verified email.</p></div></header>
              <div className="ke-invitation-form">
                <div className="ke-invitation-email"><label htmlFor={`group-recipient-${group.id}`}>Username or email</label>
                  <input id={`group-recipient-${group.id}`} type="text" autoComplete="off" value={recipient} maxLength={254}
                    onChange={event => setRecipient(event.target.value)} /></div>
                <button type="button" className="ke-invitation-submit ke-icon-action" disabled={busy || !recipient.trim()} onClick={() => void action(`/groups/${group.id}/invitations`, { recipient, replace: false }, result => {
                  if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,80}$/.test(result.token)) throw new Error('Invalid invitation response');
                  setLink(`${window.location.origin}${window.location.pathname}#groupInvite=${result.token}`); setRecipient('');
                })}><PageIcon name="UserRoundPlus" />Send invitation</button>
              </div>
              {link && <div className="ke-invitation-result" role="status">
                <p>Invitation created. Existing approved accounts will see it under Invitations for you on their Groups page.</p>
                <details><summary>Share an invitation link</summary>
                  <label htmlFor={`group-copy-link-${group.id}`}>Private invitation link</label>
                  <input id={`group-copy-link-${group.id}`} readOnly value={link} onFocus={event => event.currentTarget.select()} />
                  <p>Share privately with the intended person if they need a link. It expires after 24 hours.</p>
                </details>
              </div>}
            </section>}
          </div>
        </div>;
      })}
    </>}
    </fieldset>
    <dialog ref={renameGroupDialog} className="ke-delete-dialog ke-group-action-dialog" aria-labelledby="rename-group-heading"
      onCancel={event => { event.preventDefault(); if (!busy) setRenameGroupId(null); }}>
      <form onSubmit={event => {
        event.preventDefault(); if (!renameTarget || busy || !renameGroupValue.trim()) return;
        void (async () => {
          const requestId = crypto.randomUUID(); setBusy(true); setRenameGroupNotice('');
          try {
            const response = await api(`/groups/${renameTarget.id}/name`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId },
              body: JSON.stringify({ version: renameTarget.version, previousName: renameTarget.name, name: renameGroupValue.trim() }) });
            if (!response.ok) throw new Error(String(response.status));
            setRenameGroupId(null); await load(true);
          } catch (error) {
            const status = error instanceof Error && /^\d+$/.test(error.message) ? Number(error.message) : 0;
            setRenameGroupNotice((status === 409 ? 'The group changed. Refresh and review its current name before trying again.'
              : status === 403 ? 'Only the organizer can rename this group.' : 'The group name could not be saved; refresh to check its current value.') + ` Reference: ${requestId}.`);
          } finally { setBusy(false); }
        })();
      }}>
        <h2 id="rename-group-heading">Rename group</h2>
        <label htmlFor="rename-group-name">Group name<input id="rename-group-name" value={renameGroupValue} maxLength={80} required disabled={busy}
          onChange={event => setRenameGroupValue(event.target.value)} /></label>
        {renameGroupNotice && <p role="status">{renameGroupNotice}</p>}
        <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setRenameGroupId(null)}>Cancel</button>
          <button type="submit" disabled={busy || !renameGroupValue.trim()}>Save name</button></div>
      </form>
    </dialog>
    <dialog ref={deleteGroupDialog} className="ke-delete-dialog ke-group-action-dialog" aria-labelledby="delete-group-heading"
      aria-describedby="delete-group-description" onCancel={event => { event.preventDefault(); if (!busy) setDeleteGroupId(null); }}>
      <h2 id="delete-group-heading">Delete group?</h2>
      <p id="delete-group-description">{deleteTarget ? `Delete “${deleteTarget.name}” for everyone in the group? Members will lose access to its saved decisions and drafts.` : 'This group will be removed for all its members.'}</p>
      <p className="ke-delete-note">This cannot be undone. Historical records are retained and the group will no longer appear in anyone’s group list.</p>
      {deleteGroupNotice && <p role="status">{deleteGroupNotice}</p>}
      <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setDeleteGroupId(null)}>Keep group</button>
        <button type="button" className="ke-group-delete-confirm" disabled={busy || !deleteTarget} onClick={() => {
          if (!deleteTarget || busy) return;
          const target = deleteTarget, requestId = crypto.randomUUID(); setBusy(true); setDeleteGroupNotice('');
          void (async () => {
            try {
              const response = await api(`/groups/${target.id}/delete`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId },
                body: JSON.stringify({ version: target.version }) });
              if (!response.ok) throw new Error(String(response.status));
              setGroups(current => current.filter(group => group.id !== target.id)); setDeleteGroupId(null);
              setNotice('The group was deleted for all members.');
            } catch (error) {
              const status = error instanceof Error && /^\d+$/.test(error.message) ? Number(error.message) : 0;
              setDeleteGroupNotice((status === 409 ? 'The group changed. Refresh the group list before trying again.'
                : status === 403 ? 'Only the organizer can delete this group.' : 'The result is unknown. Refresh the group list to check whether the group was deleted.') + ` Reference: ${requestId}.`);
            } finally { setBusy(false); }
          })();
        }}>Delete group</button></div>
    </dialog>
    {profileTarget && <ProfileModal api={api} open target={profileTarget} onClose={() => { setProfileTarget(null); setAvatarRevision(value => value + 1); }} restoreFocus={() => profileTriggerRef.current?.focus()} />}
    {(checking || busy) && <LoadingSkeleton kind="inline" label={checking ? 'Refreshing account and groups' : 'Updating the group'} />}
    {!checking && !busy && notice && <p role="status">{notice}</p>}
  </section>;
}
