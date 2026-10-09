'use client';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { fieldIssues } from './fieldCheck.js';
import { checkValue } from '@/engine/expr/evaluate.js';
import { t } from '@/i18n/index.js';
import { useDesigner } from './store.js';

/** The designer's UI language as a translate function. */
function useT() { const lang = useDesigner(s => s.lang); return (k, v) => t(lang, k, v); }

/** Text input that keeps its own draft and commits on every change. */
export function TextInput({ value, onChange, mono, invalid, className, ...rest }) {
  return <input className={`input${mono ? ' mono' : ''}${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`} value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />;
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

/** The data set the Inspector's expressions read (the selected item's or table's): unknown Fields.x are flagged against it. */
export const FieldScope = createContext(undefined);
/** A field-reference warning in the UI language: unknown, with a suggestion when one is close. */
export const issueText = (T, i) => (i.suggest ? T('ux_unknownFieldSuggest', { name: i.name, suggest: i.suggest }) : T('ux_unknownField', { name: i.name }));

export function ExprInput({ value, onChange, onOpen, placeholder }) {
  const T = useT();
  const scope = useContext(FieldScope);
  const dataSets = useDesigner(s => s.def?.dataSets);
  const err = value ? checkValue(value) : null;
  const issues = !err && value && scope !== undefined ? fieldIssues(value, dataSets, scope) : [];
  return (
    <div>
      <div className="expr-row">
        <TextInput value={value} onChange={onChange} mono invalid={!!err} className={issues.length ? 'squiggle' : undefined} aria-invalid={err || issues.length ? true : undefined} placeholder={placeholder || T('i_exprPh')} />
        <button className="fx" title={T('i_openExprEditor')} aria-label={`fx: ${T('i_openExprEditor')}`} onClick={onOpen} type="button">fx</button>
      </div>
      {err && <div className="err">{err}</div>}
      {issues.map((i, k) => <div key={k} className="warn" data-testid="field-warning">{issueText(T, i)}</div>)}
    </div>
  );
}

/**
 * Help text behind an ⓘ button: shown on hover, on keyboard focus and on click; Esc closes it. The button is described by
 * the text (aria-describedby), so a screen reader reads it with the button. `id` names the text for other elements too.
 */
export function InfoTip({ text, id }) {
  const T = useT();
  const own = useId();
  const tipId = id || `tip${own.replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="infotip-btn" aria-label={T('c132_moreInfo')} aria-describedby={tipId} aria-expanded={open}
        onClick={() => setOpen(v => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>ⓘ</button>
      <span role="tooltip" id={tipId} className="infotip-text" hidden={!open}>{text}</span>
    </span>
  );
}

/** Help longer than this goes behind an ⓘ button (InfoTip) instead of a paragraph under the field. */
const LONG_HINT = 90; // ponytail: a length cut, not a layout measure

export function Field({ label, children, hint }) {
  if (typeof hint === 'string' && hint.length > LONG_HINT) {
    return <div className="field-tip"><label className="field"><span>{label}</span>{children}</label><InfoTip text={hint} /></div>;
  }
  return <label className="field"><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Check({ label, checked, onChange }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

export function Dialog({ title, children, onClose, footer, wide, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    // CodeMirror uses Escape to close its suggestions. Escape typed in another designer on the page is not ours.
    const inOther = (e) => { const mine = ref.current?.closest('.designer'); return e.composedPath().some(n => n !== mine && n?.classList?.contains('designer')); };
    const k = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !inOther(e)) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" ref={ref} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>{title}</header>
        <div className="dbody">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}
