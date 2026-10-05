'use client';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';
import { signOutAndGo } from './Account.jsx';

/** The Account page's known browsers (GET/DELETE /api/account/devices) and "sign out everywhere". */
export default function Devices({ lang }) {
  const T = (k, v) => t(lang, k, v);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = () => fetch('/api/account/devices').then(r => r.json()).then(d => setList(d.devices || []), e => setError(String(e.message || e)));
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    const r = await fetch('/api/account/devices', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    load();
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString(lang); } catch { return iso; } };
  return (
    <section aria-labelledby="devices-title" style={{ marginTop: 28 }}>
      <h2 id="devices-title">{T('devicesTitle')}</h2>
      <p className="hint">{T('devicesHint')}</p>
      {error && <p role="alert" className="vmsg">{error}</p>}
      {list && !list.length && <p className="hint">{T('devicesNone')}</p>}
      {list?.length > 0 && (
        <ul data-testid="devices" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
          {list.map(d => (
            <li key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
              <span><span style={{ overflowWrap: 'anywhere' }}>{d.ua || d.id}</span> <span className="hint">· {T('deviceLastUsed', { at: when(d.lastUsed) })}</span></span>
              <button className="btn sm" onClick={() => remove(d.id)}>{T('deviceRemove')}</button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn sm" onClick={() => signOutAndGo({ everywhere: true })}>{T('signOutEverywhere')}</button>
    </section>
  );
}
