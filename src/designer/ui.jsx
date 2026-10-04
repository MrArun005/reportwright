'use client';
import { useEffect, useState } from 'react';
import { checkValue } from '@/engine/expr/evaluate.js';
import { t } from '@/i18n/index.js';
import { useDesigner } from './store.js';

/** The designer's UI language as a translate function. */
function useT() { const lang = useDesigner(s => s.lang); return (k, v) => t(lang, k, v); }

/** Text input that keeps its own draft and commits on every change. */
export function TextInput({ value, onChange, mono, invalid, ...rest }) {
  return <input className={`input${mono ? ' mono' : ''}${invalid ? ' invalid' : ''}`} value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />;
}

export function NumberInput({ value, onChange, step = 0.5, min, ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  return (
    <input className="input mono" type="number" step={step} min={min} value={draft}
      onChange={e => { setDraft(e.target.value); if (e.target.value !== '' && !Number.isNaN(Number(e.target.value))) onChange(Number(e.target.value)); }}
      onBlur={() => { if (draft === '' || Number.isNaN(Number(draft))) setDraft(value ?? ''); }} {...rest} />
  );
}

export function Select({ value, onChange, options, allowEmpty, ...rest }) {
  return (
    <select className="select" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} {...rest}>
      {allowEmpty && <option value="">—</option>}
      {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function ColorInput({ value, onChange }) {
  const T = useT();
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="colorrow">
      <input type="color" value={hex} onChange={e => onChange(e.target.value)} aria-label={T('i_pickColor')} style={{ opacity: value ? 1 : 0.3 }} title={value ? value : T('i_notSet')} />
      <TextInput value={value} onChange={v => onChange(v === '' ? undefined : v)} mono placeholder={T('i_colorPh')} />
    </div>
  );
}

export function ExprInput({ value, onChange, onOpen, placeholder }) {
  const T = useT();
  const err = value ? checkValue(value) : null;
  return (
    <div>
      <div className="expr-row">
        <TextInput value={value} onChange={onChange} mono invalid={!!err} placeholder={placeholder || T('i_exprPh')} />
        <button className="fx" title={T('i_openExprEditor')} aria-label={T('i_openExprEditor')} onClick={onOpen} type="button">fx</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Check({ label, checked, onChange }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

export function Dialog({ title, children, onClose, footer, wide, className = '' }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); }; // CodeMirror uses Escape to close its suggestions
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>{title}</header>
        <div className="dbody">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}
