'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/i18n/index.js';

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function call(url, init) {
  const res = await fetch(url, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out;
}

/** Other ways to start a report: a dashboard, an ActiveReports file, or a description for AI.
 *  Lives inside the New report form, so every control here is type="button". */
export default function MoreWays({ name, lang, folder = null }) {
  const T = (k, v) => t(lang, k, v);
  const q = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const router = useRouter();
  const file = useRef(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [ai, setAi] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [sample, setSample] = useState('');
  const [assessment, setAssessment] = useState(null);
  const assessFiles = useRef(null);
  const title = () => name?.trim() || T('untitled');

  const run = async (what, fn) => {
    setBusy(what); setErr(null); setWarnings(null);
    try { await fn(); } catch (e) { setErr(e.message); setBusy(null); }
  };
  const dashboard = () => run('dashboard', async () => {
    const { id } = await call('/api/reports', json({ name: title(), template: 'dashboard', folder }));
    router.push(`/designer/${id}${q}`);
  });
  const importFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    run('import', async () => {
      // the file name names the report, so drill-through links between imported reports find their target
      const fileName = encodeURIComponent(f.name.replace(/\.(rdlx-json|rdlx|rdlc|rdl|json|jrxml|rptdesign)$/i, ''));
      const type = /\.(rdlc?|jrxml|rptdesign)$/i.test(f.name) ? 'application/xml' : 'application/json'; // SSRS, JasperReports and BIRT reports are XML
      const { id, warnings: w } = await call(`/api/reports/import?name=${fileName}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`, { method: 'POST', headers: { 'content-type': type }, body: await f.text() });
      if (w?.length) { setWarnings({ id, list: w }); setBusy(null); } else router.push(`/designer/${id}${q}`);
    });
  };
  // Assess first: the files are sent to the server, nothing is imported; the summary shows before the user imports
  const assessPicked = (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    run('assess', async () => {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      const res = await fetch('/api/reports/assess', { method: 'POST', body: fd });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      setAssessment(out);
      setBusy(null);
    });
  };
  const draft = () => {
    run('ai', async () => {
      let rows;
      if (sample.trim()) {
        try { rows = JSON.parse(sample); } catch { throw new Error(T('badSample')); }
      }
      const { definition, warnings: w } = await call('/api/ai/report', json({ prompt, sample: rows }));
      const { id } = await call('/api/reports', json({ name: definition.name || title(), definition, folder }));
      if (w?.length) { setWarnings({ id, list: w }); setBusy(null); } else router.push(`/designer/${id}${q}`);
    });
  };

  return (
    <div className="more-ways" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" className="btn" onClick={dashboard} disabled={!!busy}>{busy === 'dashboard' ? T('creating') : T('newDashboard')}</button>
      <button type="button" className="btn" onClick={() => file.current?.click()} disabled={!!busy} title={T('importHint')}>{busy === 'import' ? T('importing') : T('importFile')}</button>
      <input ref={file} type="file" accept=".rdlx-json,.json,.rdl,.rdlc,.jrxml,.rptdesign,application/json" hidden onChange={importFile}  aria-label={T('importFileLabel')} />
      <button type="button" className="btn" aria-expanded={ai} onClick={() => setAi(v => !v)} disabled={!!busy && busy !== 'ai'}>{T('describeAi')}</button>
      {ai && (
        <div style={{ display: 'grid', gap: 6, width: '100%', maxWidth: 640 }}>
          <label className="hint" htmlFor="ai-prompt">{T('aiPrompt')}</label>
          <textarea id="ai-prompt" className="textarea" rows={3} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={T('aiPromptPlaceholder')} />
          <label className="hint" htmlFor="ai-sample">{T('aiSample')}</label>
          <textarea id="ai-sample" className="textarea" rows={3} value={sample} onChange={e => setSample(e.target.value)} placeholder='[{"month": "Jan", "region": "North", "sales": 120}]' />
          <div><button type="button" className="btn primary" onClick={draft} disabled={!!busy || !prompt.trim()}>{busy === 'ai' ? T('drafting') : T('draftReport')}</button></div>
        </div>
      )}
      <button type="button" className="btn" onClick={() => assessFiles.current?.click()} disabled={!!busy} title="Scan the files first: what converts, what needs work, the effort. Nothing is imported.">{busy === 'assess' ? 'Assessing…' : 'Assess first'}</button>
      <input ref={assessFiles} type="file" multiple accept=".rdlx-json,.rdl,.rdlc,.jrxml,.rptdesign,.zip" hidden onChange={assessPicked} aria-label="Files to assess" />
      {err && <span className="err" role="alert">{err}</span>}
      {assessment && (
        <div role="status" style={{ width: '100%', border: '1px solid var(--line, #dfe2e6)', borderRadius: 6, padding: '8px 12px' }}>
          <div><b>{assessment.summary.lead}.</b> Readiness {assessment.summary.readiness}%. {assessment.summary.reports} reports: {assessment.summary.full} convert fully, {assessment.summary.small} small fixes, {assessment.summary.manual} manual work, {assessment.summary.failed} failed.</div>
          <div className="hint">{assessment.summary.verdict} Estimated effort {assessment.summary.hours} hours.</div>
          {assessment.blockers.length > 0 && <ul className="hint" style={{ margin: '4px 0 0 18px' }}>{assessment.blockers.slice(0, 5).map(b => <li key={b.category}>{b.category}: {b.reports} reports</li>)}</ul>}
          <button type="button" className="btn" style={{ marginTop: 6 }} onClick={() => setAssessment(null)}>Dismiss</button>
        </div>
      )}
      {warnings && (
        <div role="status" style={{ width: '100%' }}>
          <span className="hint">{T('createdWithNotes', { n: warnings.list.length })}</span>
          <ul className="hint" style={{ margin: '4px 0 6px 18px', maxHeight: 160, overflow: 'auto' }}>{warnings.list.slice(0, 50).map((w, i) => <li key={i}>{w}</li>)}</ul>
          <button type="button" className="btn primary sm" onClick={() => router.push(`/designer/${warnings.id}${q}`)}>{T('openInDesigner')}</button>
        </div>
      )}
    </div>
  );
}
