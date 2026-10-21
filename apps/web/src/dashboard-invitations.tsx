import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';
import { GroupIcon, LoadingSkeleton, PageIcon } from './app-chrome';

type InvitationRow = {
  id: string;
  invitation: Groups.InvitationSnapshot | null;
  fromLink: boolean;
};
type Feedback = { message: string; retry?: boolean };

export function DashboardInvitations({ api, invitations, token, preferencesKey, sessionKey, failure, busy, onBusyChange, onClearLink, onAccepted, onRetry }: {
  api: (path: string, init?: RequestInit) => Promise<Response>;
  invitations: Groups.InvitationSnapshot[];
  token: string;
  preferencesKey?: string | undefined;
  sessionKey?: string | undefined;
  failure: string | null;
  busy: boolean;
  onBusyChange: (value: boolean) => void;
  onClearLink: (expected: string) => void;
  onAccepted: (group: Groups.GroupSnapshot, invitationId: string) => void;
  onRetry: () => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const saved: unknown = preferencesKey ? JSON.parse(localStorage.getItem(`${preferencesKey}:declined-invitations`) ?? '[]') : [];
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)).slice(-64) : [];
    } catch { return []; }
  });
  const [link, setLink] = useState<{ token: string; id: string | null } | null>(null);
  const [postponed, setPostponed] = useState<string[]>(() => {
    try {
      if (!preferencesKey || !sessionKey) return [];
      const saved = JSON.parse(sessionStorage.getItem(`${preferencesKey}:postponed-invitations`) ?? 'null') as { session?: unknown; ids?: unknown } | null;
      return saved?.session === sessionKey && Array.isArray(saved.ids)
        ? saved.ids.filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)).slice(-64) : [];
    } catch { return []; }
  });
  const [clock, setClock] = useState(Date.now);
  const [working, setWorking] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const pending = useRef(false), mounted = useRef(true);
  const disclosure = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const now = Date.now();
    const next = invitations.reduce((expiry, invitation) => invitation.expiresAt > now ? Math.min(expiry, invitation.expiresAt) : expiry, Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(next - now + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [invitations, clock]);
  useEffect(() => {
    if (!token) { setLink(null); return; }
    let active = true;
    // The inbox id is the server's SHA-256 token hash. Match it without exposing the bearer link.
    void Promise.resolve().then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).then(value => {
      const id = Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
      if (active) setLink({ token, id });
    }).catch(() => { if (active) setLink({ token, id: null }); });
    return () => { active = false; };
  }, [token]);

  const linkReady = !token || link?.token === token;
  const linkId = token && link?.token === token ? link.id : null;
  useEffect(() => {
    if (token && linkId && invitations.some(invitation => invitation.id === linkId && invitation.expiresAt <= Math.max(clock, Date.now()))) {
      onClearLink(token);
    }
  }, [token, linkId, invitations, clock, onClearLink]);
  const inbox = [...new Map(invitations.map(invitation => [invitation.id, invitation])).values()];
  const rows: InvitationRow[] = inbox.filter(invitation => invitation.expiresAt > Math.max(clock, Date.now())
    && (!dismissed.includes(invitation.id) || invitation.id === linkId)).map(invitation => ({
    id: invitation.id, invitation, fromLink: invitation.id === linkId,
  }));
  if (token && linkReady && !inbox.some(invitation => invitation.id === linkId)) {
    rows.unshift({ id: linkId ?? 'invitation-link', invitation: null, fromLink: true });
  }
  const visibleRows = rows.filter(row => !postponed.includes(row.id));
  const laterCount = rows.length - visibleRows.length;
  function savePostponed(ids: string[]) {
    const next = [...new Set(ids)].slice(-64);
    setPostponed(next);
    if (!uncertain) setFeedback(null);
    try {
      if (preferencesKey && sessionKey) sessionStorage.setItem(`${preferencesKey}:postponed-invitations`, JSON.stringify({
        session: sessionKey, ids: next.filter(id => /^[a-f0-9]{64}$/.test(id)),
      }));
    } catch { /* Not now still applies in memory when tab storage is unavailable. */ }
  }
  function restorePostponed() {
    savePostponed(postponed.filter(id => !rows.some(row => row.id === id)));
    requestAnimationFrame(() => disclosure.current?.focus({ preventScroll: true }));
  }

  function dismiss(row: InvitationRow) {
    const next = [...new Set([...dismissed, row.id])].slice(-64);
    setDismissed(next);
    try { if (preferencesKey) localStorage.setItem(`${preferencesKey}:declined-invitations`, JSON.stringify(next.filter(id => /^[a-f0-9]{64}$/.test(id)))); }
    catch { /* Dismissal remains effective for this visit when browser storage is unavailable. */ }
    if (row.fromLink) onClearLink(token);
  }
  async function accept(row: InvitationRow) {
    if (pending.current || busy || !linkReady || uncertain === row.id) return;
    if (row.invitation && row.invitation.expiresAt <= Date.now()) {
      dismiss(row); setFeedback({ message: 'This invitation has expired. Ask the organizer for a new one.' }); return;
    }
    pending.current = true; setWorking(row.id); setFeedback(null); onBusyChange(true);
    let status = 0, reference: string | null = null;
    try {
      const body = row.invitation ? { groupId: row.invitation.groupId, invitationId: row.id } : { token };
      const response = await api('/groups/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      status = response.status;
      const id = response.headers.get('x-request-id') ?? response.headers.get('apigw-requestid');
      if (id && /^[A-Za-z0-9_-]{8,80}$/.test(id)) reference = id;
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { requestId?: unknown } | null;
        if (typeof error?.requestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(error.requestId)) reference = error.requestId;
        throw new Error('Invitation not accepted');
      }
      const result = await response.json() as { group?: unknown };
      const group = Groups.GroupSnapshot.parse(result.group);
      if (row.invitation && group.id !== row.invitation.groupId) throw new Error('Unexpected group');
      if (!mounted.current) return;
      if (row.fromLink) onClearLink(token);
      onAccepted(group, row.id);
    } catch {
      if (!mounted.current) return;
      if (status === 404 || status === 410) dismiss(row);
      if (!status || status >= 500 && status !== 507 || status >= 200 && status < 300) setUncertain(row.id);
      const message = status === 404 || status === 410 ? 'This invitation has expired or is no longer available. Ask the organizer for a new one.'
        : status === 401 ? 'Your session has expired. Sign in again to accept this invitation.'
          : status === 403 ? 'This invitation can’t be accepted with this account. Check who it was sent to.'
            : status === 409 ? 'This invitation changed. Refresh before trying again.'
              : status === 507 ? 'This group has reached its member limit. Ask the organizer for help.'
                : status === 429 ? 'Please wait a moment, then refresh before trying again.'
                  : 'We couldn’t confirm whether you joined. Refresh your groups to check before trying again.';
      setFeedback({ message: message + (reference ? ` Reference: ${reference}.` : ''), retry: status !== 401 && status !== 403 });
    } finally {
      pending.current = false;
      if (mounted.current) { setWorking(null); onBusyChange(false); }
    }
  }

  if (!linkReady) return <LoadingSkeleton kind="inline" label="Checking invitation link" />;
  const linkFailure = token && link?.token === token && link.id === null;
  return <>
    {rows.length > 0 && <section className="ke-dashboard-invitations" data-collapsed={visibleRows.length === 0} aria-labelledby="pending-invitations-heading" aria-busy={working !== null}>
      <header className="ke-invitations-heading"><h2 id="pending-invitations-heading">
        <button ref={disclosure} type="button" className="ke-invitations-disclosure" aria-expanded={visibleRows.length > 0} aria-controls="pending-invitations-content" disabled={busy || working !== null} onClick={() => {
          if (pending.current) return;
          if (visibleRows.length) savePostponed([...postponed, ...rows.map(row => row.id)]); else restorePostponed();
        }}><span>Invitations</span><span aria-hidden="true">·</span><span className="ke-count-badge" aria-label={`${rows.length} pending invitations`}>{rows.length}</span><PageIcon name="ChevronRight" /></button>
      </h2>
        <details className="ke-invitation-about"><summary aria-label="About invitations" title="About invitations"><PageIcon name="Info" /></summary><p>Accepting joins a group; it doesn’t approve a decision. Decline dismisses an invitation on this browser. Not now keeps it pending for later.</p></details>
      </header>
      <div id="pending-invitations-content" hidden={visibleRows.length === 0}>
      <ul className="ke-pending-invitations">{visibleRows.map(row => <li key={row.id}>
        <span className="ke-group-row-icon" aria-hidden="true"><GroupIcon /></span>
        <div className="ke-invitation-copy"><strong>{row.invitation?.groupName ?? 'Group invitation'}</strong>
          <span>{row.invitation ? `Invited by ${row.invitation.organizerName}` : 'Opened from a private invitation link'}
            {row.invitation && <small> · Expires {new Date(row.invitation.expiresAt).toLocaleDateString()}</small>}</span>
        </div>
        <div className="ke-invitation-row-actions">
          <button type="button" aria-label={`Accept invitation to ${row.invitation?.groupName ?? 'this group'}`} disabled={busy || working !== null || uncertain === row.id || row.fromLink && !!linkFailure} onClick={() => void accept(row)}>{working === row.id ? 'Joining…' : 'Accept'}</button>
          <button type="button" className="secondary" aria-label={`Decline invitation to ${row.invitation?.groupName ?? 'this group'}`} disabled={busy || working !== null} onClick={() => {
            if (pending.current) return;
            dismiss(row); setFeedback({ message: 'Invitation dismissed on this browser.' });
          }}>Decline</button>
          <button type="button" className="secondary ke-invitation-not-now" aria-label={`Postpone invitation to ${row.invitation?.groupName ?? 'this group'}`} disabled={busy || working !== null} onClick={() => {
            if (pending.current) return;
            savePostponed([...postponed, row.id]);
            requestAnimationFrame(() => disclosure.current?.focus({ preventScroll: true }));
          }}>Not now</button>
        </div>
      </li>)}</ul>
      {laterCount > 0 && <button type="button" className="secondary ke-invitations-later" disabled={busy || working !== null} onClick={restorePostponed}>
        <PageIcon name="ChevronRight" />Show {laterCount} {laterCount === 1 ? 'invitation' : 'invitations'} for later
      </button>}
      </div>
    </section>}
    {(feedback || failure || linkFailure) && <div className="ke-invitation-feedback" role="status">
      <p>{feedback?.message ?? (linkFailure ? 'We couldn’t read this invitation link. Refresh to check it again.' : failure)}</p>
      {(feedback?.retry || !feedback && (failure || linkFailure)) && <button type="button" className="secondary" disabled={busy || working !== null} onClick={() => { setFeedback(null); onRetry(); }}>Refresh groups</button>}
    </div>}
  </>;
}
