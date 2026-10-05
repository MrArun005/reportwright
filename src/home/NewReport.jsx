'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MoreWays from './MoreWays.jsx';
import { t } from '@/i18n/index.js';

export default function NewReport({ lang, folder = null }) {
  const T = (k, v) => t(lang, k, v);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const router = useRouter();
  const input = useRef(null);
  const create = async (e) => {
    e.preventDefault();
    // a report needs a name: no silent "untitled-report-3"
    if (!name.trim()) { setErr(T('ux_nameFirst')); input.current?.focus(); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), folder }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = await res.json();
      router.push(`/designer/${id}${lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : ''}`);
    } catch (ex) { setErr(T('notCreated', { message: ex.message })); setBusy(false); }
  };
  return (
    <form onSubmit={create} className="newrep">
      <input ref={input} className="input" aria-invalid={err && !name.trim() ? true : undefined} placeholder={T('newReportPlaceholder')} value={name} onChange={e => setName(e.target.value)} aria-label={T('newReportName')} />
      <button className="btn primary" disabled={busy}>{busy ? T('creating') : T('newReport')}</button>
      {err && <span className="err">{err}</span>}
      <MoreWays name={name} lang={lang} folder={folder} />
    </form>
  );
}
