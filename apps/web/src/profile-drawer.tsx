import { useEffect, useRef, useState } from 'react';
import { Groups } from '@deal-table/contracts';
import { ProfileIcon } from './app-chrome';
type Profile = ReturnType<typeof Groups.OwnProfile.parse>;
export function ProfileDrawer({ api, signOut }: { api: (path: string, init?: RequestInit) => Promise<Response>; signOut: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false), [profile, setProfile] = useState<Profile | null>(null), [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const generation = useRef(0);
  const dirty = editing && (name !== profile?.displayName || description !== profile?.description);
  function close() {
    if (busy || (dirty && !window.confirm('Discard your unsaved profile changes?'))) return;
    generation.current++; setOpen(false); setEditing(false); trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal(); heading.current?.focus();
    const epoch = ++generation.current, controller = new AbortController(); setBusy(true); setNotice(''); setProfile(null);
    void api('/account/profile', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const result = Groups.OwnProfile.parse((await response.json()).profile);
      if (generation.current === epoch) setProfile(result);
    }).catch(() => { if (generation.current === epoch) setNotice('Your profile is unavailable. Close this panel and try again.'); })
      .finally(() => { if (generation.current === epoch) setBusy(false); });
    return () => { controller.abort(); generation.current++; };
  }, [open]);
  async function update(path: string, body: unknown) {
    const epoch = generation.current; setBusy(true); setNotice('');
    try {
      const response = await api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 409 ? 'changed' : response.status === 422 ? 'invalid' : response.status === 403 ? 'denied' : 'unavailable');
      const next = Groups.OwnProfile.parse((await response.json()).profile);
      if (generation.current !== epoch) return;
      setProfile(next); setEditing(false); setNotice('Profile saved.');
    } catch (error) {
      if (generation.current === epoch) setNotice(error instanceof Error && error.message === 'changed'
        ? 'Your profile changed in another session. Close and reopen it before saving.'
        : error instanceof Error && error.message === 'invalid' ? 'Check the name and description, or choose an RGB/RGBA PNG up to 128 × 128 pixels and 16 KB.'
        : error instanceof Error && error.message === 'denied' ? 'Your access changed. Close this panel and refresh your account.'
        : 'The save result is uncertain. Close and reopen your profile before retrying.');
    } finally { if (generation.current === epoch) setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file || !profile || busy) return;
    if (file.type !== 'image/png' || file.size > 16384) { setNotice('Choose a PNG up to 128 × 128 pixels and 16 KB.'); return; }
    const epoch = generation.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation.current === epoch) await update('/account/profile/image', { version: profile.version, bytesBase64: btoa(String.fromCharCode(...bytes)) });
    } catch { if (generation.current === epoch) setNotice('The picture could not be read. Choose another PNG.'); }
  }
  return <>
    <button ref={trigger} type="button" className="ke-profile-trigger secondary" aria-label="Open your profile" onClick={() => setOpen(true)}>
      {profile?.image ? <img alt="" src={'data:image/png;base64,' + profile.image.bytesBase64} /> : profile ? <span aria-hidden="true">{profile.displayName.slice(0, 1)}</span> : <ProfileIcon />}
    </button>
    <dialog ref={dialog} className="ke-profile-drawer" aria-labelledby="profile-title" onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === dialog.current) close(); }}>
      <div className="ke-profile-content" aria-busy={busy}>
        <button type="button" className="secondary" disabled={busy} onClick={close}>Close profile</button>
        <h2 id="profile-title" ref={heading} tabIndex={-1}>Your profile</h2>
        {profile && <>
          {profile.image && <img className="ke-profile-image" alt="Your profile picture" src={'data:image/png;base64,' + profile.image.bytesBase64} />}
          <p>{profile.status === 'PENDING' ? 'Your account is waiting for approval.' : profile.status === 'APPROVED' ? 'Access approved' : 'Your access request was declined.'}</p>
          <p>Sign-in username: {profile.loginUsername ?? 'managed by your sign-in provider'}. It cannot be changed here.</p>
          {editing ? <form onSubmit={event => { event.preventDefault(); void update('/account/profile', { version: profile.version, displayName: name, description }); }}>
            <label htmlFor="profile-name">Display name</label><input id="profile-name" value={name} maxLength={80} required disabled={busy} onChange={event => setName(event.target.value)} />
            <label htmlFor="profile-description">Description · only you</label><textarea id="profile-description" value={description} maxLength={280} disabled={busy} onChange={event => setDescription(event.target.value)} />
            <p>Your name is visible to group members. Your description and picture are private to this profile.</p>
            <button disabled={busy || !name.trim()}>Save profile</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel edits</button>
          </form> : <><h3>{profile.displayName}</h3><p>{profile.description || 'No description yet.'}</p>
            <button type="button" disabled={busy} onClick={() => { setName(profile.displayName); setDescription(profile.description); setEditing(true); }}>Edit profile</button>
            <label htmlFor="profile-picture">Change private picture · PNG, up to 128 × 128 and 16 KB</label>
            <input id="profile-picture" type="file" accept="image/png" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
            {profile.image && <button type="button" className="secondary" disabled={busy} onClick={() => void update('/account/profile/image', { version: profile.version, bytesBase64: null })}>Remove picture</button>}
          </>}
        </>}
        {(busy || notice) && <p role="status">{busy ? 'Loading or saving your profile…' : notice}</p>}
        <button type="button" className="secondary" disabled={busy} onClick={signOut}>Sign out</button>
      </div>
    </dialog>
  </>;
}
