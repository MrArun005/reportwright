'use client';
// Conditional formatting wizard: rules (a field or this value, a condition, a format) for a text box, a table cell or
// row, or a chart's points. It writes the style expressions (cfRules.js) and keeps the rules to reopen them.
import { useState } from 'react';
import { Dialog, Field, Select, TextInput, ColorInput, Check } from './ui.jsx';
import { useDesigner } from './store.js';
import { CF_OPS, HAS_RANK } from './cfRules.js';
import { t } from '@/i18n/index.js';

const NEEDS = { between: 2, top: 'n', bottom: 'n', aboveAvg: 0, belowAvg: 0, empty: 0, notEmpty: 0 };
/**
 * @param {{ title: string, cf?: any, fields: string[], thisValue: boolean, kind: 'text' | 'cell' | 'chart', custom: string[], onApply: (cf: any) => void, onClose: () => void }} p
 */
export default function CondFormat({ title, cf: start, fields, thisValue, kind, custom, onApply, onClose }) {
  const lang = useDesigner(s => s.lang);
  const T = (k, v) => t(lang, k, v);
  const blank = () => ({ field: thisValue ? undefined : fields[0], op: 'gt', value: '', format: kind === 'chart' ? { backgroundColor: '#dc2626' } : { color: '#b42318', fontWeight: 'bold' } });
  const [cf, setCf] = useState(() => JSON.parse(JSON.stringify(start || { mode: 'first', rules: [blank()] })));
  const rules = cf.rules || [];
  const setRule = (i, patch) => setCf(c => ({ ...c, rules: c.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setFmt = (i, k, v) => setCf(c => ({ ...c, rules: c.rules.map((r, j) => { if (j !== i) return r; const f = { ...(r.format || {}) }; if (v === undefined || v === '' || v === false) delete f[k]; else f[k] = v; return { ...r, format: f }; }) }));
  const move = (i, d) => setCf(c => { const a = [...c.rules]; const j = i + d; if (j < 0 || j >= a.length) return c; [a[i], a[j]] = [a[j], a[i]]; return { ...c, rules: a }; });
  const ops = CF_OPS.filter(o => HAS_RANK || (o !== 'top' && o !== 'bottom')).map(o => ({ value: o, label: T(`cf_op_${o}`) }));
  const subjects = [...(thisValue ? [{ value: '', label: T('cf_thisValue') }] : []), ...fields.map(f => ({ value: f, label: f }))];
  const bad = rules.some(r => !r.format || !Object.keys(r.format).length || ((NEEDS[r.op] ?? 1) === 1 && String(r.value ?? '') === '') || (r.op === 'between' && (String(r.value ?? '') === '' || String(r.value2 ?? '') === '')));
  return (
    <Dialog wide title={title} onClose={onClose} className="cf-dialog"
      footer={<><button className="btn" onClick={onClose}>{T('cancel')}</button><button className="btn primary" disabled={bad} onClick={() => { onApply(cf); onClose(); }} data-testid="cf-apply">{T('cf_apply')}</button></>}>
      {custom.length > 0 && <div className="warn" data-testid="cf-custom">{T('cf_custom', { props: custom.map(p => T(`cf_p_${p}`)).join(', ') })}</div>}
      <div className="grid2">
        <Field label={T('cf_when')}><Select value={cf.mode || 'first'} options={[{ value: 'first', label: T('cf_first') }, { value: 'stack', label: T('cf_stack') }]} onChange={v => setCf(c => ({ ...c, mode: v }))} data-testid="cf-mode" /></Field>
        {kind === 'cell' && <Check label={T('cf_databar')} checked={cf.databar} onChange={v => setCf(c => ({ ...c, databar: v || undefined }))} />}
      </div>
      <ol className="cf-rules">
        {rules.map((r, i) => {
          const need = NEEDS[r.op] ?? 1;
          return (
            <li className="group-card" key={i} data-testid={`cf-rule-${i}`}>
              <div className="cf-cond">
                <Select value={r.field || ''} options={subjects} onChange={v => setRule(i, { field: v || undefined })} aria-label={T('cf_subject')} />
                <Select value={r.op} options={ops} onChange={v => setRule(i, { op: v })} aria-label={T('cf_condition')} />
                {need === 'n' && <TextInput value={r.n ?? 3} onChange={v => setRule(i, { n: Number(v) || undefined })} aria-label="N" mono />}
                {(need === 1 || need === 2) && <TextInput value={r.value ?? ''} onChange={v => setRule(i, { value: v })} aria-label={T('cf_value')} placeholder={T('cf_valuePh')} mono />}
                {need === 2 && <TextInput value={r.value2 ?? ''} onChange={v => setRule(i, { value2: v })} aria-label={T('cf_value2')} placeholder={T('dsAnd')} mono />}
              </div>
              <div className="cf-fmt">
                {kind !== 'chart' && <Field label={T('cf_p_color')}><ColorInput value={r.format?.color} onChange={v => setFmt(i, 'color', v)} /></Field>}
                <Field label={T(kind === 'chart' ? 'cf_pointColor' : 'cf_p_backgroundColor')}><ColorInput value={r.format?.backgroundColor} onChange={v => setFmt(i, 'backgroundColor', v)} /></Field>
                {kind !== 'chart' && <Check label={T('cf_p_fontWeight')} checked={r.format?.fontWeight === 'bold'} onChange={v => setFmt(i, 'fontWeight', v ? 'bold' : undefined)} />}
                {kind !== 'chart' && <Check label={T('cf_p_fontStyle')} checked={r.format?.fontStyle === 'italic'} onChange={v => setFmt(i, 'fontStyle', v ? 'italic' : undefined)} />}
                {kind === 'cell' && <Field label={T('cf_icon')}><Select value={r.format?.icon || ''} allowEmpty options={['good', 'warn', 'bad'].map(x => ({ value: x, label: T(`cf_icon_${x}`) }))} onChange={v => setFmt(i, 'icon', v)} /></Field>}
              </div>
              <div className="btnrow">
                <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={T('moveUp')}>↑</button>
                <button type="button" className="btn sm ghost" disabled={i === rules.length - 1} onClick={() => move(i, 1)} aria-label={T('moveDown')}>↓</button>
                <button type="button" className="btn sm ghost danger" onClick={() => setCf(c => ({ ...c, rules: c.rules.filter((_, j) => j !== i) }))}>{T('i_remove')}</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="btnrow"><button type="button" className="btn sm" onClick={() => setCf(c => ({ ...c, rules: [...(c.rules || []), blank()] }))} data-testid="cf-add">{T('cf_addRule')}</button></div>
      <div className="hint">{T(kind === 'cell' ? 'cf_hintCell' : 'cf_hint')}</div>
    </Dialog>
  );
}
