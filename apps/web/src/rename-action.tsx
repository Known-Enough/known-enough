import { useRef, useState } from 'react';
export function RenameAction({ name, save }: { name: string; save: (name: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  return <><button type="button" className="secondary" onClick={() => { setValue(name); setNotice(''); dialog.current?.showModal(); }}>Rename</button>
    <dialog ref={dialog} className="ke-step-dialog" aria-label={`Rename ${name}`} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); if (busy || !value.trim()) return; setBusy(true); setNotice(''); void save(value.trim()).then(() => dialog.current?.close()).catch(() => setNotice('The name could not be saved. Refresh to check the current name before retrying. Your text is kept.')).finally(() => setBusy(false)); }}>
        <h2>Rename</h2><label>Name<input value={value} maxLength={80} required disabled={busy} onChange={event => setValue(event.target.value)} /></label>
        <button type="submit" disabled={busy || !value.trim()}>Save name</button><button type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </dialog></>;
}
