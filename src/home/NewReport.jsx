'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MoreWays from './MoreWays.jsx';

export default function NewReport() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() || 'Untitled report' }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = await res.json();
      router.push(`/designer/${id}`);
    } catch (ex) { setErr(`The report was not created: ${ex.message}`); setBusy(false); }
  };
  return (
    <form onSubmit={create} className="newrep">
      <input className="input" placeholder="Name a new report" value={name} onChange={e => setName(e.target.value)} aria-label="New report name" />
      <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'New report'}</button>
      {err && <span className="err">{err}</span>}
      <MoreWays name={name} />
    </form>
  );
}
