'use client';
// Ask AI in the designer: describe a change, see what it does to the report, apply it as one undoable step.
// The report and a trimmed copy of its loaded data go to /api/ai/report; nothing changes until Apply.
import { useEffect, useState } from 'react';
import { useDesigner, sectionList, secOf } from './store.js';
import { loadSample } from './DataPanel.jsx';
import { Dialog } from './ui.jsx';
import { render, resolveParameters } from '@/engine/index.js';
import { pageToSvg } from '@/exporters/svg.js';
import { fontStore } from '@/viewer/engineClient.js';

/** The same data with every list cut to its first `n` items: enough for a trial render, small to send. */
const trim = (v, n = 200) => (Array.isArray(v) ? v.slice(0, n).map(x => trim(x, n)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, n)])) : v);

/** Items added, removed and changed, by name, across the sections. */
function changes(before, after) {
  const map = (def) => new Map(sectionList(def).flatMap(s => (secOf(def, s.key)?.items || []).map(it => [it.name || it.id, JSON.stringify(it)])));
  const a = map(before), b = map(after);
  return {
    added: [...b.keys()].filter(k => !a.has(k)),
    removed: [...a.keys()].filter(k => !b.has(k)),
    changed: [...b.keys()].filter(k => a.has(k) && a.get(k) !== b.get(k)),
    data: JSON.stringify([before.dataSources, before.dataSets]) !== JSON.stringify([after.dataSources, after.dataSets]),
  };
}

export default function AskAi({ onClose }) {
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const [prompt, setPrompt] = useState('');
  const [st, setSt] = useState({ state: 'idle' });
  useEffect(() => { if (!sample?.dataSets && !sample?.loading) loadSample(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async () => {
    setSt({ state: 'asking' });
    try {
      const rows = Object.fromEntries(Object.entries(sample?.dataSets || {}).map(([k, r]) => [k, r.slice(0, 10)]));
      const sources = sample?.sources ? trim(sample.sources) : undefined;
      const res = await fetch('/api/ai/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, definition: def, sample: rows, sources }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      let preview = null;
      try {
        const params = resolveParameters(out.definition, {}, { lenient: true });
        const model = await render(out.definition, { fontStore: fontStore(), parameters: params, sources: sources ? Object.fromEntries((out.definition.dataSources || []).map(s => [s.name, sources[s.name] ?? (s.type === 'json' ? s.data : [])])) : undefined, baseUrl: window.location.origin });
        preview = { html: pageToSvg(model.pages[0], model.width, model.height), pages: model.pages.length };
      } catch (e) { preview = { error: e.message }; }
      setSt({ state: 'done', next: out.definition, warnings: out.warnings || [], diff: changes(def, out.definition), preview });
    } catch (e) { setSt({ state: 'error', message: e.message }); }
  };
  const apply = () => {
    const next = st.next;
    useDesigner.getState().apply((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, JSON.parse(JSON.stringify(next))); });
    onClose();
  };
  const list = (label, names) => (names.length ? <li>{label}: {names.join(', ')}</li> : null);

  return (
    <Dialog wide title="Ask AI" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {st.state === 'done' && <button className="btn primary" onClick={apply} data-testid="ai-apply">Apply (undo with ⌘Z)</button>}
      </>}>
      <label className="hint" htmlFor="ask-ai">Describe the change. The report and the first rows of its data go to the AI service.</label>
      <textarea id="ask-ai" className="textarea" rows={3} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Add a column chart of the amount by month above the table, and a grand total in the footer" />
      <div className="btnrow" style={{ alignItems: 'center' }}>
        <button className="btn primary" onClick={ask} disabled={!prompt.trim() || st.state === 'asking'}>{st.state === 'asking' ? 'Working… (up to a minute)' : 'Draft the change'}</button>
        {sample?.loading && <span className="hint">Loading the report's data…</span>}
      </div>
      {st.state === 'error' && <div className="err" role="alert">{st.message}</div>}
      {st.state === 'done' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 2fr', gap: 12 }}>
          <div>
            <h5>What changes</h5>
            <ul className="hint" style={{ margin: '4px 0 0 18px' }}>
              {list('Added', st.diff.added)}{list('Removed', st.diff.removed)}{list('Changed', st.diff.changed)}
              {st.diff.data && <li>Data sources or data sets change</li>}
              {!st.diff.added.length && !st.diff.removed.length && !st.diff.changed.length && !st.diff.data && <li>Page settings only</li>}
            </ul>
            {st.warnings.length > 0 && <><h5>Notes</h5><ul className="hint" style={{ margin: '4px 0 0 18px' }}>{st.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></>}
          </div>
          <div>
            <h5>Preview · page 1{st.preview?.pages > 1 ? ` of ${st.preview.pages}` : ''}</h5>
            <div className="cw-paper" style={{ maxHeight: 420, overflow: 'auto' }}>
              {st.preview?.error ? <span className="err">{st.preview.error}</span> : <div dangerouslySetInnerHTML={{ __html: st.preview?.html || '' }} />}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
