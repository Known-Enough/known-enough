import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';
import { LoadingSkeleton, PageIcon, ProfileIcon } from './app-chrome';

type Profile = ReturnType<typeof Groups.OwnProfile.parse>;

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? first;
  if (words.length > 1) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return (first || 'KE').slice(0, 2).toUpperCase();
}

function statusLabel(status: Profile['status']) {
  if (status === 'PENDING') return 'Pending approval';
  if (status === 'APPROVED') return 'Approved';
  return 'Access declined';
}

export function ProfileDrawer({ api, signOut }: { api: (path: string, init?: RequestInit) => Promise<Response>; signOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [profile, setProfile] = useState<Profile | null>(null), [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const generation = useRef(0);
  const dirty = editing && (name !== profile?.displayName || description !== profile?.description);

  function close() {
    if (saving || (dirty && !window.confirm('Discard your unsaved profile changes?'))) return;
    generation.current++;
    setOpen(false);
    setEditing(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    heading.current?.focus();
    const epoch = ++generation.current, controller = new AbortController();
    setBusy(true);
    setNotice('');
    setProfile(null);
    void api('/account/profile', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const result = Groups.OwnProfile.parse((await response.json()).profile);
      if (generation.current === epoch) setProfile(result);
    }).catch(() => {
      if (generation.current === epoch) setNotice('Your profile is unavailable. Close this panel and try again.');
    }).finally(() => {
      if (generation.current === epoch) setBusy(false);
    });
    return () => { controller.abort(); generation.current++; };
  }, [open]);

  async function update(path: string, body: unknown) {
    const epoch = generation.current;
    setBusy(true);
    setSaving(true);
    setNotice('');
    try {
      const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 409 ? 'changed' : response.status === 422 ? 'invalid' : response.status === 403 ? 'denied' : 'unavailable');
      const next = Groups.OwnProfile.parse((await response.json()).profile);
      if (generation.current !== epoch) return;
      setProfile(next);
      setEditing(false);
      setNotice('Profile saved.');
    } catch (error) {
      if (generation.current === epoch) setNotice(error instanceof Error && error.message === 'changed'
        ? 'Your profile changed in another session. Close and reopen it before saving.'
        : error instanceof Error && error.message === 'invalid' ? 'Check the name and description, or choose an RGB/RGBA PNG up to 128 × 128 pixels and 16 KB.'
        : error instanceof Error && error.message === 'denied' ? 'Your access changed. Close this panel and refresh your account.'
        : 'The save result is uncertain. Close and reopen your profile before retrying.');
    } finally {
      if (generation.current === epoch) { setBusy(false); setSaving(false); }
    }
  }

  async function upload(file: File | undefined) {
    if (!file || !profile || busy) return;
    if (file.type !== 'image/png' || file.size > 16384) { setNotice('Choose a PNG up to 128 × 128 pixels and 16 KB.'); return; }
    const epoch = generation.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation.current === epoch) await update('/account/profile/image', { version: profile.version, bytesBase64: btoa(String.fromCharCode(...bytes)) });
    } catch {
      if (generation.current === epoch) setNotice('The picture could not be read. Choose another PNG.');
    }
  }

  return <>
    <button ref={trigger} type="button" className="ke-profile-trigger secondary" aria-label="Open your profile" onClick={() => setOpen(true)}>
      {profile?.image ? <img alt="" src={'data:image/png;base64,' + profile.image.bytesBase64} /> : profile ? <span aria-hidden="true">{initials(profile.displayName)}</span> : <ProfileIcon />}
    </button>
    <dialog ref={dialog} className="ke-profile-drawer" aria-labelledby="profile-title" onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === dialog.current) close(); }}>
      <div className="ke-profile-shell">
        <header className="ke-profile-header">
          <h2 id="profile-title" ref={heading} tabIndex={-1}>Your profile</h2>
          <button type="button" className="secondary ke-profile-close" aria-label="Close profile" title="Close profile" disabled={saving} onClick={close}><PageIcon name="X" /></button>
        </header>
        <div className="ke-profile-main" aria-busy={busy}>
          {!profile && busy && <LoadingSkeleton kind="profile" label="Loading your profile details" />}
          {profile && <>
            <section className="ke-profile-summary" aria-label="Profile summary">
              <div className="ke-profile-avatar" aria-hidden="true">
                {profile.image ? <img alt="" src={'data:image/png;base64,' + profile.image.bytesBase64} /> : <span>{initials(profile.displayName)}</span>}
              </div>
              <div className="ke-profile-summary-copy">
                <h3>{profile.displayName}</h3>
                <span className={`ke-profile-status is-${profile.status.toLowerCase()}`}><PageIcon name="ShieldCheck" />{statusLabel(profile.status)}</span>
              </div>
            </section>

            {editing ? <form className="ke-profile-edit-form" onSubmit={event => { event.preventDefault(); void update('/account/profile', { version: profile.version, displayName: name, description }); }}>
              <section className="ke-profile-section">
                <h3><PageIcon name="UserRound" />Edit profile</h3>
                <label htmlFor="profile-name">Display name</label>
                <input id="profile-name" value={name} maxLength={80} required disabled={busy} onChange={event => setName(event.target.value)} />
                <label htmlFor="profile-description">Description <span>· only you</span></label>
                <textarea id="profile-description" value={description} maxLength={280} disabled={busy} onChange={event => setDescription(event.target.value)} />
                <p className="ke-profile-helper">Your name is visible to group members. Your description and picture are private to this profile.</p>
                <div className="ke-profile-form-actions">
                  <button disabled={busy || !name.trim()}><PageIcon name="Check" />Save profile</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel edits</button>
                </div>
              </section>
            </form> : <>
              <section className="ke-profile-section" aria-labelledby="profile-account-heading">
                <h3 id="profile-account-heading"><PageIcon name="UserRound" />Account details</h3>
                <dl className="ke-profile-details">
                  <div><dt>Sign-in username</dt><dd>{profile.loginUsername ?? 'Managed by your sign-in provider'}</dd></div>
                </dl>
                <p className="ke-profile-helper">Your username is managed by your sign-in provider and can’t be changed here.</p>
              </section>
              <section className="ke-profile-section" aria-labelledby="profile-description-heading">
                <h3 id="profile-description-heading"><PageIcon name="FileText" />Description</h3>
                <p className="ke-profile-description">{profile.description || 'No description added yet.'}</p>
                <p className="ke-profile-helper">Visible only to you.</p>
              </section>
              <section className="ke-profile-section ke-profile-photo-section" aria-label="Profile photo">
                <button type="button" className="secondary ke-profile-change-photo" aria-describedby="profile-picture-help" disabled={busy} onClick={() => pictureInput.current?.click()}><PageIcon name="Camera" />Change photo</button>
                <input ref={pictureInput} id="profile-picture" className="ke-profile-file-input" type="file" accept="image/png" disabled={busy} aria-describedby="profile-picture-help" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
                <p id="profile-picture-help" className="ke-profile-helper">PNG only · RGB/RGBA · 128 × 128 px maximum · 16 KB maximum. Your photo is private to this profile.</p>
                {profile.image && <button type="button" className="secondary ke-profile-remove-photo" disabled={busy} onClick={() => void update('/account/profile/image', { version: profile.version, bytesBase64: null })}>Remove picture</button>}
              </section>
              <button type="button" className="ke-profile-edit-button" disabled={busy} onClick={() => { setName(profile.displayName); setDescription(profile.description); setEditing(true); }}><PageIcon name="Pencil" />Edit profile</button>
            </>}
          </>}
          {profile && busy && <LoadingSkeleton kind="inline" label="Saving your profile" />}
          {!busy && notice && <p className="ke-profile-notice" role="status" aria-live="polite">{notice}</p>}
        </div>
        <footer className="ke-profile-footer">
          <button type="button" className="secondary ke-profile-signout" disabled={busy} onClick={signOut}><PageIcon name="LogOut" />Sign out</button>
        </footer>
      </div>
    </dialog>
  </>;
}
