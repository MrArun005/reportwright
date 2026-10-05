'use client';
import { useMemo, useRef, useState } from 'react';
import ExprCode from './ExprCode.jsx';
import { Dialog } from './ui.jsx';
import { useDesigner } from './store.js';
import { fieldIssues, fieldNames } from './fieldCheck.js';
import { issueText } from './ui.jsx';
import { t } from '@/i18n/index.js';
import { checkValue, evalValue, toText, FUNCTION_NAMES, functionTable } from '@/engine/expr/evaluate.js';

const GLOBALS = ['PageNumber', 'TotalPages', 'ExecutionTime', 'ReportName'];
const SNIPPETS = {
  Sum: 'Sum(Fields.x)', Avg: 'Avg(Fields.x)', Count: 'Count(Fields.x)', CountDistinct: 'CountDistinct(Fields.x)', CountRows: 'CountRows()',
  Min: 'Min(Fields.x)', Max: 'Max(Fields.x)', First: 'First(Fields.x)', Last: 'Last(Fields.x)', RunningValue: 'RunningValue(Fields.x, "Sum")', RowNumber: 'RowNumber()',
  IIF: 'IIF(test, ifTrue, ifFalse)', Switch: 'Switch(test1, value1, True, other)', Format: 'Format(value, "N2")', DateAdd: 'DateAdd("m", 1, Fields.x)',
  DateDiff: 'DateDiff("d", Fields.a, Fields.b)', Today: 'Today()', Now: 'Now()',
};

/**
 * @param {{ value: string, dataSet?: string|null, onSave: (v: string) => void, onClose: () => void, title?: string }} p
 */
export default function ExpressionEditor({ value, dataSet, onSave, onClose, title }) {
  const def = useDesigner(s => s.def);
  const sample = useDesigner(s => s.sample);
  const [text, setText] = useState(value ?? '');
  const ta = useRef(null);
  const dsName = dataSet || def.dataSets?.[0]?.name;
  const ds = def.dataSets?.find(d => d.name === dsName);
  const fields = fieldNames(ds).filter(n => !(ds?.fields || []).some(f => f.name === n && f.type === 'object')); // nested objects as their dotted fields
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const check = (v) => fieldIssues(v, def.dataSets, dsName);

  const insert = (s) => ta.current?.insert(s);

  const err = checkValue(text);
  const issues = err ? [] : check(text);
  const preview = useMemo(() => {
    if (err || !sample?.dataSets) return null;
    const rows = sample.dataSets[dsName] || [];
    const params = Object.fromEntries((def.parameters || []).map(p => [p.name, p.default ?? null]));
    try {
      const v = evalValue(text, { fields: rows[0] || null, aggRows: rows, rowNumber: 1, params, dataSets: sample.dataSets, globals: { PageNumber: 1, TotalPages: 1, ExecutionTime: new Date(), ReportName: def.name }, locale: def.locale, currency: def.currency, functions: functionTable(def) });
      return { ok: true, text: typeof v === 'string' ? v : toText(v, null, { locale: def.locale, currency: def.currency }), type: v === null ? 'null' : v instanceof Date ? 'date' : typeof v };
    } catch (e) { return { ok: false, text: e.message }; }
  }, [text, err, sample, dsName, def]);

  return (
    <Dialog wide title={title || 'Expression'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!err} onClick={() => { onSave(text); onClose(); }}>Apply</button></>}>
      <div className="xgrid">
        <div className="xlist">
          <h6>Fields {dsName ? `· ${dsName}` : ''}</h6>
          {fields.length ? fields.map(f => <button key={f} onClick={() => insert(`Fields.${f}`)}>{f}</button>) : <div className="subtle">No fields. Add a data set first.</div>}
          <h6>Parameters</h6>
          {(def.parameters || []).map(p => <button key={p.name} onClick={() => insert(`Parameters.${p.name}`)}>{p.name}</button>)}
          <h6>Globals</h6>
          {GLOBALS.map(g => <button key={g} onClick={() => insert(`Globals.${g}`)}>{g}</button>)}
          <h6>Functions</h6>
          {FUNCTION_NAMES.map(f => <button key={f} onClick={() => insert(SNIPPETS[f] || `${f}()`)}>{f}</button>)}
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 }}>
          <ExprCode ref={ta} value={text} onChange={setText} fields={fields} parameters={(def.parameters || []).map(p => p.name)} invalid={!!err} check={check} />
          {issues.length > 0 && <ul className="warn expr-issues" data-testid="expr-issues">{issues.map((i, k) => <li key={k}>{issueText(T, i)}</li>)}</ul>}
          {err ? <div className="err">{err}</div> : <div className="hint">Start with = for one expression, or write text with {'{expression}'} parts. Ctrl+Space shows suggestions. Example: <code>Page {'{Globals.PageNumber}'} of {'{Globals.TotalPages}'}</code></div>}
          <div>
            <div className="hint" style={{ marginBottom: 4 }}>Preview with the first row of {dsName || 'the data'}</div>
            <div className="sample">{preview ? (preview.ok ? <>{preview.text || <i>(empty)</i>} <span className="hint">· {preview.type}</span></> : <span className="err">{preview.text}</span>) : <span className="hint">{sample?.loading ? 'Loading sample data…' : sample?.error ? `No sample data: ${sample.error}` : 'Load sample data in the Data panel to see a preview.'}</span>}</div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
