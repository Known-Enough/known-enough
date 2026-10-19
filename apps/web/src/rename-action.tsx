import { Modal } from './modal';
import { useRef, useState, type ReactNode } from 'react';
export function RenameAction({ name, save, renderTrigger }: { name: string; save: (name: string) => Promise<void>; renderTrigger?: (open: () => void) => ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const open = () => { setValue(name); setNotice(''); dialog.current?.showModal(); };
  return <>{renderTrigger ? renderTrigger(open) : <button type="button" className="secondary" onClick={open}>Rename</button>}
    <Modal ref={dialog} className="ke-step-dialog" aria-label={`Rename ${name}`} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); if (busy || !value.trim() || value.trim().length > 80) return; setBusy(true); setNotice(''); void save(value.trim()).then(() => dialog.current?.close()).catch(() => setNotice('The name could not be saved. Refresh to check the current name before retrying. Your text is kept.')).finally(() => setBusy(false)); }}>
        <h2>Rename</h2><label>Name<input value={value} maxLength={80} required disabled={busy} onChange={event => setValue(event.target.value)} /></label>
        <p>Use 1–80 characters. Renaming keeps the decision’s choices and saved answers.</p>
        <button type="submit" disabled={busy || !value.trim() || value.trim().length > 80}>Save name</button><button type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </Modal></>;
}
