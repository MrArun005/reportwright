'use client';
// The control for one report parameter in the viewer's parameter panel: the parameter's `editor`
// (slider, range, dateRange, radio, list, toggle), else a box, date picker or drop-down from its type and choices.
import { rangeValue } from './logic.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

/**
 * @param {{ p: any, value: string, options?: {value: any, label: string}[], onChange: (v: string) => void, invalid?: boolean,
 *   T: (key: string, vars?: object) => string, name: string }} props  name: unique per viewer, for radio groups
 */
export default function ParamInput({ p, value: val, options: opts, onChange: set, invalid, T, name }) {
  const label = `${p.prompt || p.name}${p.required ? ' *' : ''}`;
  const min = num(p.min), max = num(p.max), step = num(p.step);
  switch (p.editor) {
    case 'slider': {
      const lo = min ?? 0, hi = max ?? 100;
      return (
        <div className="pslider">
          <input type="range" aria-label={label} min={lo} max={hi} step={step ?? 1} value={val === '' ? lo : val} onChange={e => set(e.target.value)} />
          <output>{val === '' ? '—' : val}</output>
        </div>
      );
    }
    case 'range':
    case 'dateRange': {
      // two values in one list parameter: "from,to"
      const [a = '', b = ''] = String(val).split(',');
      const date = p.editor === 'dateRange';
      const limits = date ? { min: p.min, max: p.max } : { min, max, step };
      return (
        <div className="prange">
          <input className="input" type={date ? 'date' : 'number'} aria-label={`${label} ${T('from')}`} value={a} {...limits} onChange={e => set(rangeValue(e.target.value, b, p))} />
          <span aria-hidden="true">–</span>
          <input className="input" type={date ? 'date' : 'number'} aria-label={`${label} ${T('to')}`} value={b} {...limits} onChange={e => set(rangeValue(a, e.target.value, p))} />
        </div>
      );
    }
    case 'toggle':
      return (
        <label className="check pswitch">
          <input type="checkbox" role="switch" aria-label={label} checked={String(val) === 'true'} onChange={e => set(e.target.checked ? 'true' : 'false')} />
          <span>{String(val) === 'true' ? T('true') : T('false')}</span>
        </label>
      );
    case 'radio':
      if (!opts) break;
      return (
        <div className="pradio" role="radiogroup" aria-label={label}>
          {opts.map(o => (
            <label className="check" key={String(o.value)}>
              <input type="radio" name={name} checked={String(o.value) === String(val)} onChange={() => set(String(o.value))} />{o.label}
            </label>
          ))}
        </div>
      );
    case 'list':
      if (!opts) break;
      return (
        <select className="select plist" aria-label={label} size={Math.min(6, Math.max(2, opts.length))} multiple={!!p.multi}
          value={p.multi ? String(val).split(',').filter(Boolean) : String(val)}
          onChange={e => set(p.multi ? [...e.target.selectedOptions].map(o => o.value).join(',') : e.target.value)}>
          {opts.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
    default:
  }
  if (opts && p.multi) {
    const cur = new Set(String(val).split(',').filter(Boolean));
    return (
      <div style={{ display: 'grid', gap: 2, maxHeight: 160, overflow: 'auto' }}>
        {opts.map(o => (
          <label className="check" key={String(o.value)}>
            <input type="checkbox" checked={cur.has(String(o.value))} onChange={(e) => { const n = new Set(cur); e.target.checked ? n.add(String(o.value)) : n.delete(String(o.value)); set([...n].join(',')); }} />{o.label}
          </label>
        ))}
      </div>
    );
  }
  if (opts) return <select className="select" aria-label={p.prompt || p.name} value={val} onChange={e => set(e.target.value)}><option value="">—</option>{opts.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</select>;
  if (p.type === 'boolean') return <select className="select" aria-label={p.prompt || p.name} value={val} onChange={e => set(e.target.value)}><option value="">—</option><option value="true">{T('true')}</option><option value="false">{T('false')}</option></select>;
  return <input className={`input${invalid ? ' invalid' : ''}`} aria-label={label} type={p.type === 'number' && !p.multi ? 'number' : p.type === 'date' && !p.multi ? 'date' : 'text'}
    placeholder={p.multi ? T('commaSeparated') : undefined} value={val} onChange={e => set(e.target.value)} />;
}
