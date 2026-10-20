import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Groups } from '@deal-table/contracts';
import { PageIcon } from './app-chrome';
import { MemberAvatar } from './member-avatar';
import { Modal } from './modal';

type Member = Groups.GroupSnapshot['members'][number];
type Api = (path: string, init?: RequestInit) => Promise<Response>;
const PAGE_SIZE = 12;
const names = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function MemberCard({ member, groupId, api, revision, canRemove, busy, onProfile, onRemove }: {
  member: Member; groupId: string; api: Api; revision: number; canRemove: boolean; busy: boolean;
  onProfile: (memberId: string, trigger: HTMLButtonElement) => void; onRemove: (member: Member, trigger: HTMLButtonElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLLIElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function menuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return <li ref={root} className="ke-member-card">
    <button type="button" className="ke-member-profile-trigger" aria-label={`View ${member.displayName}'s profile`}
      onClick={event => onProfile(member.id, event.currentTarget)}>
      <MemberAvatar api={api} groupId={groupId} memberId={member.id} name={member.displayName} revision={revision} />
      <span className="ke-member-name"><span className="ke-member-display-name" title={member.displayName}>{member.displayName}</span>
        {member.isOrganizer && <span className="ke-member-role">Organizer</span>}</span>
    </button>
    <div className="ke-decision-menu-wrap ke-member-menu" onKeyDown={menuKey}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" className="ke-group-menu-trigger ke-member-menu-trigger" disabled={busy}
        aria-label={`Actions for ${member.displayName}`} aria-expanded={open} aria-haspopup="menu" aria-controls={`member-actions-${groupId}-${member.id}`}
        onClick={() => setOpen(value => !value)} onKeyDown={event => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        }}><PageIcon name="Ellipsis" /></button>
      <div ref={menu} id={`member-actions-${groupId}-${member.id}`} className="ke-decision-actions-menu ke-member-actions-menu" role="menu" aria-label={`Actions for ${member.displayName}`} hidden={!open}>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); if (trigger.current) onProfile(member.id, trigger.current); }}>View profile</button>
        {canRemove && <button type="button" role="menuitem" className="ke-decision-menu-delete" disabled={busy}
          onClick={() => { setOpen(false); if (trigger.current) onRemove(member, trigger.current); }}>Remove from group</button>}
      </div>
    </div>
  </li>;
}

export function GroupMembers({ group, api, revision, busy, onProfile, onRemove }: {
  group: Groups.GroupSnapshot; api: Api; revision: number; busy: boolean;
  onProfile: (memberId: string, trigger: HTMLButtonElement) => void; onRemove: (memberId: string) => void;
}) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [removingId, setRemovingId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null), removeTrigger = useRef<HTMLButtonElement | null>(null);
  const filtered = useMemo(() => {
    const value = query.normalize('NFKC').trim().toLocaleLowerCase();
    return group.members.filter(member => member.displayName.normalize('NFKC').toLocaleLowerCase().includes(value))
      .sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer) || names.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id));
  }, [group.members, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const removing = group.isOrganizer ? group.members.find(member => member.id === removingId && !member.isOrganizer) : undefined;
  useEffect(() => {
    if (removing) { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }
    else dialog.current?.close();
  }, [removing]);
  function closeRemoval() { dialog.current?.close(); setRemovingId(null); removeTrigger.current?.focus(); }
  function clearSearch() { setQuery(''); setPage(1); search.current?.focus(); }
  return <section className="ke-card ke-group-panel ke-members-panel" aria-labelledby={`members-heading-${group.id}`}>
    <header className="ke-panel-heading"><h2 id={`members-heading-${group.id}`}><span className="ke-heading-icon" aria-hidden="true"><PageIcon name="Users" /></span>
      <span>Members <span className="ke-member-count">· {group.members.length}</span></span></h2></header>
    <div className="ke-members-toolbar">
      <div className="ke-group-search ke-member-search"><PageIcon name="Search" />
        <input ref={search} type="search" aria-label="Search members" placeholder="Search members..." value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }} />
        {!!query && <button type="button" className="ke-group-search-clear" aria-label="Clear member search" title="Clear search" onClick={clearSearch}><PageIcon name="X" /></button>}
      </div>
      {!!query.trim() && <small role="status">{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</small>}
    </div>
    {visible.length ? <ul className="ke-member-list">{visible.map(member => <MemberCard key={member.id} member={member} groupId={group.id} api={api} revision={revision}
      canRemove={group.isOrganizer && !member.isOrganizer} busy={busy} onProfile={onProfile} onRemove={(target, trigger) => {
        removeTrigger.current = trigger;
        setRemovingId(target.id);
      }} />)}</ul> : <div className="ke-member-empty" role="status"><h3>{query.trim() ? 'No matching members' : 'No members to show'}</h3>
      {query.trim() && <><p>Try another name, or clear your search.</p><button type="button" className="secondary" onClick={clearSearch}>Clear search</button></>}</div>}
    {pages > 1 && <nav className="ke-members-pagination" aria-label="Members pagination">
      <button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span role="status" aria-live="polite">Page {currentPage} of {pages}</span>
      <button type="button" className="secondary" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
    </nav>}
    <details className="ke-membership-note"><summary>About membership changes</summary>
      <p>New members join unfinished decisions automatically. Saved answers stay in place, and finished decisions keep their outcome. Removing someone may require an update to unfinished decisions.</p>
    </details>
    <Modal ref={dialog} className="ke-delete-dialog ke-group-action-dialog" aria-labelledby={`remove-member-heading-${group.id}`}
      onCancel={event => { event.preventDefault(); if (!busy) closeRemoval(); }}>
      <h2 id={`remove-member-heading-${group.id}`}>Remove from group?</h2>
      <p>Remove {removing?.displayName} from “{group.name}”? They will lose access to this group. You may need to update unfinished decisions to reflect who is taking part.</p>
      <div className="ke-wizard-actions"><button type="button" className="secondary" disabled={busy} onClick={closeRemoval}>Cancel</button>
        <button type="button" disabled={busy || !removing} onClick={() => {
          if (!removing || busy) return;
          const id = removing.id; closeRemoval(); onRemove(id);
        }}>Remove from group</button></div>
    </Modal>
  </section>;
}
