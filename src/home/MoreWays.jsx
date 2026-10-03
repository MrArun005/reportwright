'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function call(url, init) {
  const res = await fetch(url, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out;
}

/** Other ways to start a report: a dashboard, an ActiveReports file, or a description for AI.
 *  Lives inside the New report form, so every control here is type="button". */
export default function MoreWays({ name }) {
  const router = useRouter();
  const file = useRef(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [ai, setAi] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [sample, setSample] = useState('');
  const title = () => name?.trim() || 'Untitled report';

  const run = async (what, fn) => {
    setBusy(what); setErr(null); setWarnings(null);
    try { await fn(); } catch (e) { setErr(e.message); setBusy(null); }
  };
  const dashboard = () => run('dashboard', async () => {
    const { id } = await call('/api/reports', json({ name: title(), template: 'dashboard' }));
    router.push(`/designer/${id}`);
  });
  const importFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    run('import', async () => {
      // the file name names the report, so drill-through links between imported reports find their target
      const fileName = encodeURIComponent(f.name.replace(/\.(rdlx-json|rdlx|json)$/i, ''));
      const { id, warnings: w } = await call(`/api/reports/import?name=${fileName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await f.text() });
      if (w?.length) { setWarnings({ id, list: w }); setBusy(null); } else router.push(`/designer/${id}`);
    });
  };
  const draft = () => {
    run('ai', async () => {
      let rows;
      if (sample.trim()) {
        try { rows = JSON.parse(sample); } catch { throw new Error('The sample data is not valid JSON.'); }
      }
      const { definition, warnings: w } = await call('/api/ai/report', json({ prompt, sample: rows }));
      const { id } = await call('/api/reports', json({ name: definition.name || title(), definition }));
      if (w?.length) { setWarnings({ id, list: w }); setBusy(null); } else router.push(`/designer/${id}`);
    });
  };

  return (
    <div className="more-ways" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" className="btn" onClick={dashboard} disabled={!!busy}>{busy === 'dashboard' ? 'Creating…' : 'New dashboard'}</button>
      <button type="button" className="btn" onClick={() => file.current?.click()} disabled={!!busy} title="Open an ActiveReportsJS .rdlx-json file">{busy === 'import' ? 'Importing…' : 'Import ActiveReports file'}</button>
      <input ref={file} type="file" accept=".rdlx-json,.json,application/json" hidden onChange={importFile} aria-label="ActiveReports file to import" />
      <button type="button" className="btn" aria-expanded={ai} onClick={() => setAi(v => !v)} disabled={!!busy && busy !== 'ai'}>Describe a report (AI)</button>
      {ai && (
        <div style={{ display: 'grid', gap: 6, width: '100%', maxWidth: 640 }}>
          <label className="hint" htmlFor="ai-prompt">What should the report show?</label>
          <textarea id="ai-prompt" className="textarea" rows={3} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Monthly sales by region, a column chart, and a table with totals" />
          <label className="hint" htmlFor="ai-sample">Sample rows as JSON (optional; sent to the AI service)</label>
          <textarea id="ai-sample" className="textarea" rows={3} value={sample} onChange={e => setSample(e.target.value)} placeholder='[{"month": "Jan", "region": "North", "sales": 120}]' />
          <div><button type="button" className="btn primary" onClick={draft} disabled={!!busy || !prompt.trim()}>{busy === 'ai' ? 'Drafting… (up to a minute)' : 'Draft the report'}</button></div>
        </div>
      )}
      {err && <span className="err" role="alert">{err}</span>}
      {warnings && (
        <div role="status" style={{ width: '100%' }}>
          <span className="hint">The report was created with {warnings.list.length} note{warnings.list.length === 1 ? '' : 's'}:</span>
          <ul className="hint" style={{ margin: '4px 0 6px 18px', maxHeight: 160, overflow: 'auto' }}>{warnings.list.slice(0, 50).map((w, i) => <li key={i}>{w}</li>)}</ul>
          <button type="button" className="btn primary sm" onClick={() => router.push(`/designer/${warnings.id}`)}>Open in the designer</button>
        </div>
      )}
    </div>
  );
}
