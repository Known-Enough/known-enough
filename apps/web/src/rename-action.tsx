import { Modal } from './modal';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageIcon } from './app-chrome';
export function RenameAction({ name, save, renderTrigger, inline = false, onDirtyChange }: { name: string; save: (name: string) => Promise<void>; renderTrigger?: (open: () => void) => ReactNode; inline?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), display = useRef<HTMLDivElement>(null);
  const dimensions = useRef({ width: 0, height: 0 }), saving = useRef(false), inlineSave = useRef(save);
  useEffect(() => { if (inline && editing) { input.current?.focus(); input.current?.select(); } }, [inline, editing]);
  useEffect(() => { if (inline) onDirtyChange?.(editing && (busy || value !== name)); }, [inline, editing, busy, value, name, onDirtyChange]);
  useEffect(() => () => { if (inline) onDirtyChange?.(false); }, [inline, onDirtyChange]);
  const restoreFocus = () => requestAnimationFrame(() => trigger.current?.focus());
  const open = () => {
    setValue(name); setNotice('');
    if (inline) {
      inlineSave.current = save;
      const box = display.current?.getBoundingClientRect();
      const available = display.current?.closest('.ke-group-title-row')?.getBoundingClientRect().width;
      if (box) dimensions.current = { width: Math.min(available || box.width, Math.max(320, box.width)), height: box.height };
      setEditing(true);
    }
    else dialog.current?.showModal();
  };
  function cancelInline() {
    if (saving.current) return;
    setValue(name); setNotice(''); setEditing(false); restoreFocus();
  }
  async function saveInline() {
    if (saving.current) return;
    if (!value.trim() || value.trim().length > 80) { setNotice('Use 1–80 characters for the group name.'); input.current?.focus(); return; }
    saving.current = true; setBusy(true); setNotice('');
    try { await inlineSave.current(value.trim()); setEditing(false); restoreFocus(); }
    catch { setNotice('We couldn’t confirm the new name. Refresh to check it before trying again.'); }
    finally { saving.current = false; setBusy(false); }
  }
  if (inline) return <div className="ke-inline-rename">
    {editing ? <form className="ke-inline-name-row" aria-label="Rename group" aria-busy={busy}
      style={{ width: dimensions.current.width || undefined, minHeight: dimensions.current.height || undefined }}
      onSubmit={event => { event.preventDefault(); void saveInline(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelInline(); } }}>
      <input ref={input} className="ke-inline-name-input" aria-label="Group name" aria-describedby={notice ? 'inline-group-name-notice' : undefined}
        value={value} minLength={1} maxLength={80} required disabled={busy} onChange={event => { setValue(event.target.value); setNotice(''); }} />
      <button type="submit" className="secondary ke-inline-name-control" disabled={busy || !value.trim() || value.trim().length > 80}
        aria-label={busy ? 'Saving group name' : 'Save group name'} title="Save name" data-saving={busy}><PageIcon name={busy ? 'RefreshCw' : 'Check'} /></button>
      <button type="button" className="secondary ke-inline-name-control" disabled={busy} aria-label="Cancel group rename" title="Cancel" onClick={cancelInline}><PageIcon name="X" /></button>
      {busy && <span className="ke-sr-only" role="status">Saving name…</span>}
    </form> : <div ref={display} className="ke-inline-name-row"><h1 title={name}>{name}</h1>
      <button ref={trigger} type="button" className="secondary ke-inline-name-control" aria-label="Rename group" title="Rename group" onClick={open}><PageIcon name="Pencil" /></button>
      <span aria-hidden="true" className="ke-inline-name-spacer" />
    </div>}
    {editing && notice && <p id="inline-group-name-notice" className="ke-inline-name-notice" role="status">{notice}</p>}
  </div>;
  return <>{renderTrigger ? renderTrigger(open) : <button type="button" className="secondary" onClick={open}>Rename</button>}
    <Modal ref={dialog} className="ke-step-dialog" aria-label={`Rename ${name}`} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); if (busy || !value.trim() || value.trim().length > 80) return; setBusy(true); setNotice(''); void save(value.trim()).then(() => dialog.current?.close()).catch(() => setNotice('We couldn’t confirm the new name. Refresh to check it before trying again.')).finally(() => setBusy(false)); }}>
        <h2>Rename</h2><label>Name<input value={value} maxLength={80} required disabled={busy} onChange={event => setValue(event.target.value)} /></label>
        <p>Use 1–80 characters. Only the name changes.</p>
        <button type="submit" disabled={busy || !value.trim() || value.trim().length > 80}>Save name</button><button type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </Modal></>;
}
