'use client';
// Access to a report, a folder or the top level: the folder it is in, inheritance, and grants to users and groups.
// Opened only for people who manage the thing (the home page hides the button otherwise); the API checks again.
import { useEffect, useState } from 'react';
import { t } from '@/i18n/index.js';

const LEVELS = ['view', 'edit', 'manage'];

/** Past this a read gives up with an error and a Retry (a busy server held it: never "Loading…" for good). */
const READ_TIMEOUT_MS = 15000;
async function call(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    signal: method === 'GET' ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * @param {{ kind: 'report'|'folder'|'root', id: string, name: string, folders: { id: string, name: string, parent: string|null, access: string }[],
 *   accounts: boolean, canDelete?: boolean, lang: string, onClose: () => void }} props
 */
export default function Share({ kind, id, name, folders, accounts, canDelete = false, lang, onClose }) {
  const T = (k, v) => t(lang, k, v);
  const url = kind === 'report' ? `/api/reports/${encodeURIComponent(id)}/access` : `/api/folders/${encodeURIComponent(id)}`;
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState({ type: 'user', name: '', level: 'view' });

  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    call(url).then(r => { if (!live) return; if (Array.isArray(r?.grants)) setRec(r); else setErr(T('accessUnreadable')); },
      e => live && setErr(e.name === 'TimeoutError' || e.name === 'AbortError' ? T('accessSlow') : e.message));
    return () => { live = false; };
  }, [url, tries]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  // where it may go: folders the user can add to (edit), never a folder into itself or below itself
  const below = new Set(kind === 'folder' ? [id] : []);
  for (let grew = true; grew;) { grew = false; for (const f of folders) if (f.parent && below.has(f.parent) && !below.has(f.id)) { below.add(f.id); grew = true; } }
  const targets = folders.filter(f => (kind === 'folder' ? f.access === 'manage' : f.access !== 'view') && !below.has(f.id));
  const path = (f) => { const out = []; for (let x = f, i = 0; x && i < 32; i++, x = folders.find(y => y.id === x.parent)) out.unshift(x.name); return out.join(' / '); };

  const add = (e) => {
    e.preventDefault();
    const n = who.name.trim();
    if (!n) return;
    const to = `${who.type}:${who.type === 'user' ? n.toLowerCase() : n}`;
    setRec({ ...rec, grants: [...rec.grants.filter(g => g.to !== to), { to, level: who.level }] });
    setWho({ ...who, name: '' });
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { grants: rec.grants };
      if (kind !== 'root') body.inherit = rec.inherit;
      if (kind === 'report') body.folder = rec.folder || null;
      if (kind === 'folder') body.parent = rec.parent || null;
      await call(url, kind === 'report' ? 'PUT' : 'PATCH', body);
      window.location.reload();
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(T(kind === 'report' ? 'confirmDeleteReport' : 'confirmDeleteFolder', { name }))) return;
    setBusy(true); setErr(null);
    try {
      await call(kind === 'report' ? `/api/reports/${encodeURIComponent(id)}` : url, 'DELETE');
      window.location.reload();
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  const label = (to) => (to === 'group:everyone' ? T('everyoneGroup') : to === 'group:public' ? T('publicGroup') : to === 'group:designers' ? T('ux_designersGroup') : to.replace(/^user:/, '').replace(/^group:/, `${T('grantGroup')}: `));

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={T('accessOf', { name })}>
        <header>{T('accessOf', { name })}</header>
        <div className="dbody">
          {!rec && !err && <span className="hint">{T('loading')}</span>}
          {rec && kind !== 'root' && (
            <label className="field">
              <span>{kind === 'report' ? T('folder') : T('parentFolder')}</span>
              <select className="select" value={(kind === 'report' ? rec.folder : rec.parent) || ''} onChange={e => setRec({ ...rec, [kind === 'report' ? 'folder' : 'parent']: e.target.value || null })}>
                <option value="">{T('topLevel')}</option>
                {targets.map(f => <option key={f.id} value={f.id}>{path(f)}</option>)}
              </select>
            </label>
          )}
          {rec && accounts && (
            <>
              {kind === 'root' ? <p className="hint" style={{ margin: 0 }}>{T('topAccessHint')}</p> : (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={rec.inherit} onChange={e => setRec({ ...rec, inherit: e.target.checked })} />
                  <span>{T('inheritAccess')}</span>
                </label>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label={T('peopleAndGroups')}>
                <thead><tr>{[T('peopleAndGroups'), T('accessLevel'), ''].map((h, i) => <th key={i} scope="col" style={{ textAlign: 'start', fontSize: 12, color: 'var(--muted)', fontWeight: 500, padding: '4px 8px' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {rec.grants.map(g => (
                    <tr key={g.to} style={{ borderTop: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '6px 8px' }}>{label(g.to)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <select className="select" aria-label={T('levelOf', { name: label(g.to) })} value={g.level} style={{ width: 'auto' }}
                          onChange={e => setRec({ ...rec, grants: rec.grants.map(x => (x.to === g.to ? { ...x, level: e.target.value } : x)) })}>
                          {LEVELS.map(l => <option key={l} value={l}>{T(`level_${l}`)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'end' }}>
                        <button type="button" className="btn sm danger" aria-label={T('removeGrant', { name: label(g.to) })} onClick={() => setRec({ ...rec, grants: rec.grants.filter(x => x.to !== g.to) })}>{T('remove')}</button>
                      </td>
                    </tr>
                  ))}
                  {!rec.grants.length && <tr><td colSpan={3} className="hint" style={{ padding: '6px 8px' }}>{T('noGrants')}</td></tr>}
                </tbody>
              </table>
              <form onSubmit={add} aria-label={T('addGrant')} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                <label className="field">
                  <span>{T('grantType')}</span>
                  <select className="select" value={who.type} onChange={e => setWho({ ...who, type: e.target.value })}>
                    <option value="user">{T('grantUser')}</option>
                    <option value="group">{T('grantGroup')}</option>
                  </select>
                </label>
                <label className="field" style={{ flex: 1, minWidth: 200 }}>
                  <span>{who.type === 'user' ? T('email') : T('groupName')}</span>
                  <input className="input" value={who.name} onChange={e => setWho({ ...who, name: e.target.value })} placeholder={who.type === 'user' ? 'name@example.com' : 'finance'} list={who.type === 'group' ? 'pw-groups' : undefined} />
                  <datalist id="pw-groups"><option value="everyone" /><option value="designers" /><option value="public" /></datalist>
                </label>
                <label className="field">
                  <span>{T('accessLevel')}</span>
                  <select className="select" value={who.level} onChange={e => setWho({ ...who, level: e.target.value })}>
                    {LEVELS.map(l => <option key={l} value={l}>{T(`level_${l}`)}</option>)}
                  </select>
                </label>
                <button className="btn">{T('addGrant')}</button>
              </form>
              <p className="hint" style={{ margin: 0 }}>{T('levelsHint')}</p>
            </>
          )}
          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}{!rec && <> <button type="button" className="btn sm" onClick={() => setTries(n => n + 1)}>{T('r4_retry')}</button></>}</p>}
        </div>
        <footer>
          {canDelete && <button type="button" className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={remove} disabled={busy}>{kind === 'report' ? T('deleteReport') : T('deleteFolder')}</button>}
          <button type="button" className="btn" onClick={onClose}>{T('cancel')}</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !rec}>{T('save')}</button>
        </footer>
      </div>
    </div>
  );
}
