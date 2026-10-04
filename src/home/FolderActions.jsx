'use client';
// Small client pieces of the home page: a button that opens the access dialog, and the new-folder form.
import { useState } from 'react';
import Share from './Share.jsx';
import { t } from '@/i18n/index.js';

/** @param {{ label: string, className?: string } & Omit<Parameters<typeof Share>[0], 'onClose'>} props */
export function ShareButton({ label, className = 'btn sm', ...props }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">{label}</button>
      {open && <Share {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** @param {{ parent: string|null, lang: string }} props */
export function NewFolder({ parent, lang }) {
  const T = (k, v) => t(lang, k, v);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), parent }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      window.location.reload();
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <form onSubmit={create} className="newrep" aria-label={T('newFolder')}>
      <input className="input" placeholder={T('newFolderPlaceholder')} aria-label={T('newFolderName')} value={name} onChange={e => setName(e.target.value)} />
      <button className="btn" disabled={busy || !name.trim()}>{T('newFolder')}</button>
      {err && <span className="err" role="alert">{err}</span>}
    </form>
  );
}
