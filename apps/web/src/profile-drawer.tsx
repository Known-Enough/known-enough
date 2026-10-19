import { Modal } from './modal';
import { avatarRead } from './member-avatar';
import { avatarUpload } from './avatar-upload';
import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';
import { LoadingSkeleton, PageIcon, ProfileIcon } from './app-chrome';

type OwnerProfile = ReturnType<typeof Groups.OwnProfile.parse>;
type ProfileImage = { mimeType: 'image/png'; width: number; height: number; bytesBase64: string };
type ProfileView = { displayName: string; description: string; image: ProfileImage | null; version: number | null };
export type ProfileTarget = { kind: 'owner' } | { kind: 'member'; groupId: string; memberId: string };
type Api = (path: string, init?: RequestInit) => Promise<Response>;

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? first;
  if (words.length > 1) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return (first || 'KE').slice(0, 2).toUpperCase();
}
function ownerView(profile: OwnerProfile): ProfileView {
  const { displayName, description, image, version } = profile;
  return { displayName, description, version, image: image ? { mimeType: image.mimeType, width: image.width, height: image.height, bytesBase64: image.bytesBase64 } : null };
}

export function ProfileModal({ api, open, target, onClose, restoreFocus, onOwnerProfile }: {
  api: Api; open: boolean; target: ProfileTarget | null; onClose: () => void; restoreFocus?: () => void;
  onOwnerProfile?: (profile: ProfileView) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), pictureInput = useRef<HTMLInputElement>(null);
  const apiRef = useRef(api); apiRef.current = api;
  const [profile, setProfile] = useState<ProfileView | null>(null), [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const generation = useRef(0);
  const owner = target?.kind === 'owner';
  const dirty = owner && editing && (name !== profile?.displayName || description !== profile?.description);
  const key = target?.kind === 'owner' ? 'owner' : target ? `member:${target.groupId}:${target.memberId}` : '';
  const groupId = target?.kind === 'member' ? target.groupId : '';
  const memberId = target?.kind === 'member' ? target.memberId : '';

  function close() {
    if (saving || (dirty && !window.confirm('Discard your unsaved profile changes?'))) return;
    generation.current++;
    setEditing(false);
    dialog.current?.close();
    onClose();
    restoreFocus?.();
  }

  useEffect(() => {
    const element = dialog.current;
    if (!open || !target) { element?.close(); return; }
    element?.showModal(); heading.current?.focus();
    const epoch = ++generation.current, controller = new AbortController();
    setBusy(true); setNotice(''); setProfile(null); setEditing(false);
    const path = owner ? '/account/profile' : `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/profile`;
    void apiRef.current(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json() as { profile: unknown };
      const next = owner ? ownerView(Groups.OwnProfile.parse(body.profile)) : (() => {
        const value = Groups.GroupMemberProfile.parse(body.profile);
        return { displayName: value.displayName, description: value.description, image: value.image, version: null };
      })();
      if (generation.current === epoch) { setProfile(next); if (owner) onOwnerProfile?.(next); }
    }).catch(() => {
      if (generation.current === epoch) setNotice(owner ? 'Your profile is unavailable. Try again.' : 'This profile is unavailable.');
    }).finally(() => { if (generation.current === epoch) setBusy(false); });
    return () => { controller.abort(); generation.current++; };
  }, [open, key, owner, groupId, memberId]);

  async function update(path: string, body: unknown, keepEditing = false) {
    if (!owner || !profile || profile.version === null) return;
    const epoch = generation.current;
    setBusy(true); setSaving(true); setNotice('');
    try {
      const response = await apiRef.current(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 409 ? 'changed' : response.status === 422 ? 'invalid' : response.status === 403 ? 'denied' : 'unavailable');
      const next = ownerView(Groups.OwnProfile.parse((await response.json()).profile));
      if (generation.current !== epoch) return;
      setProfile(next); onOwnerProfile?.(next); setEditing(keepEditing); setNotice('Saved.');
    } catch (error) {
      if (generation.current === epoch) setNotice(error instanceof Error && error.message === 'changed'
        ? 'Your profile changed in another session. Close and reopen it before saving.'
        : error instanceof Error && error.message === 'invalid' ? 'Check the name and bio, or choose an RGB/RGBA PNG up to 128 × 128 pixels and 16 KB.'
        : error instanceof Error && error.message === 'denied' ? 'Your access changed. Refresh your account before editing.'
        : 'The save result is uncertain. Close and reopen your profile before retrying.');
    } finally { if (generation.current === epoch) { setBusy(false); setSaving(false); } }
  }

  async function upload(file: File | undefined) {
    if (!file || !owner || !profile || profile.version === null || busy) return;
    const epoch = generation.current; setBusy(true); setSaving(true); setNotice('Resizing your photo…');
    try {
      const bytesBase64 = await avatarUpload(file);
      if (generation.current === epoch) await update('/account/profile/image', { version: profile.version, bytesBase64 }, true);
    } catch (error) { if (generation.current === epoch) setNotice((error instanceof Error ? error.message : 'The picture could not be read.') + ' Your saved photo is kept.'); }
    finally { if (generation.current === epoch) { setBusy(false); setSaving(false); } }
  }

  return <Modal closeButton={false} ref={dialog} className="ke-profile-modal" aria-labelledby="profile-title" onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="ke-profile-shell">
      <header className="ke-profile-header"><h2 id="profile-title" ref={heading} tabIndex={-1}>Profile</h2>
        <button type="button" className="secondary ke-profile-close" aria-label="Close profile" title="Close profile" disabled={saving} onClick={close}><PageIcon name="X" /></button>
      </header>
      <div className="ke-profile-main" aria-busy={busy}>
        {!profile && busy && <LoadingSkeleton kind="profile" label="Loading profile" />}
        {profile && <>
          <section className="ke-profile-summary" aria-label="Profile summary">
            <div className="ke-profile-avatar" aria-hidden="true">{profile.image
              ? <img alt="" src={`data:image/png;base64,${profile.image.bytesBase64}`} />
              : <span>{initials(profile.displayName)}</span>}</div>
            <div className="ke-profile-summary-copy"><h3>{profile.displayName}</h3></div>
          </section>
          {editing && owner ? <form className="ke-profile-edit-form" onSubmit={event => {
            event.preventDefault(); void update('/account/profile', { version: profile.version, displayName: name, description });
          }}>
            <label htmlFor="profile-name">Display name</label>
            <input id="profile-name" value={name} maxLength={80} required disabled={busy} onChange={event => setName(event.target.value)} />
            <label htmlFor="profile-description">Bio</label>
            <textarea id="profile-description" value={description} maxLength={280} disabled={busy} onChange={event => setDescription(event.target.value)} />
            <div className="ke-profile-photo-editor">
              <button type="button" className="secondary ke-profile-change-photo" aria-describedby="profile-picture-help" disabled={busy} onClick={() => pictureInput.current?.click()}><PageIcon name="Camera" />Change photo</button>
              <input ref={pictureInput} id="profile-picture" className="ke-profile-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-describedby="profile-picture-help" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
              {profile.image && <button type="button" className="secondary ke-profile-remove-photo" disabled={busy} onClick={() => void update('/account/profile/image', { version: profile.version, bytesBase64: null }, true)}>Remove photo</button>}
              <p id="profile-picture-help" className="ke-profile-helper">PNG, JPEG or WebP · up to 20 MB · resized automatically to fit the saved avatar limit</p>
            </div>
            <div className="ke-profile-form-actions"><button type="submit" disabled={busy || !name.trim()}><PageIcon name="Check" />Save</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
          </form> : <>
            <p className="ke-profile-bio">{profile.description || 'No bio yet.'}</p>
            {owner && <button type="button" className="ke-profile-edit-button" disabled={busy} onClick={() => {
              setName(profile.displayName); setDescription(profile.description); setEditing(true);
            }}><PageIcon name="Pencil" />Edit profile</button>}
          </>}
        </>}
        {!busy && notice && <p className="ke-profile-notice" role="status" aria-live="polite">{notice}</p>}
      </div>
    </div>
  </Modal>;
}

export function ProfileDrawer({ api, signOut }: { api: Api; signOut: () => void }) {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), profileAction = useRef<HTMLButtonElement>(null), signOutAction = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false), [profileOpen, setProfileOpen] = useState(false), [avatar, setAvatar] = useState<ProfileView | null>(null);
  const avatarApi = useRef(api); avatarApi.current = api;
  useEffect(() => {
    const controller = new AbortController();
    void avatarRead(controller.signal, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        let status: number | null = null;
        try {
          const response = await avatarApi.current('/account/profile', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), cache: 'no-store' });
          status = response.status;
          if (!response.ok) {
            if ((status === 429 || status >= 500) && attempt < 2) continue;
            throw new Error('Unavailable');
          }
          const next = ownerView(Groups.OwnProfile.parse((await response.json()).profile));
          if (!controller.signal.aborted) setAvatar(current => current?.version != null && next.version != null && current.version > next.version ? current : next);
          return;
        } catch (error) {
          if (controller.signal.aborted || status !== null || attempt === 2) throw error;
        }
      }
    }).catch(() => { if (!controller.signal.aborted) console.info('Known Enough avatar loading diagnostic', { stage: 'account', reason: 'PROFILE_UNAVAILABLE' }); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    profileAction.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); trigger.current?.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [profileAction.current, signOutAction.current].filter((item): item is HTMLButtonElement => !!item);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    };
    const pointer = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('keydown', keydown); document.addEventListener('pointerdown', pointer);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', pointer); };
  }, [menuOpen]);
  function openOwnProfile() { setMenuOpen(false); setProfileOpen(true); }
  return <div ref={root} className="ke-account-menu">
    <button ref={trigger} type="button" className="ke-profile-trigger secondary" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
      {avatar?.image ? <img alt="" src={`data:image/png;base64,${avatar.image.bytesBase64}`} /> : avatar ? <span aria-hidden="true">{initials(avatar.displayName)}</span> : <ProfileIcon />}
    </button>
    {menuOpen && <div className="ke-account-dropdown" role="menu" aria-label="Account menu">
      <button ref={profileAction} type="button" role="menuitem" onClick={openOwnProfile}><PageIcon name="UserRound" />Your profile</button>
      <button ref={signOutAction} type="button" role="menuitem" onClick={() => { setMenuOpen(false); signOut(); }}><PageIcon name="LogOut" />Sign out</button>
    </div>}
    <ProfileModal api={api} open={profileOpen} target={profileOpen ? { kind: 'owner' } : null} onClose={() => setProfileOpen(false)} restoreFocus={() => trigger.current?.focus()} onOwnerProfile={setAvatar} />
  </div>;
}
