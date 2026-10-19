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

/**
 * What a field shows: the text typed while it has the focus, else the stored value. A value the store clamps or rounds
 * ("4" of a height whose least is 90) is not written back mid-typing; the stored value shows again on blur or Enter.
 */
function useDraft(value, onBlur, onKeyDown) {
  const [draft, setDraft] = useState(null); // null: not typing
  return {
    shown: draft ?? value ?? '',
    setDraft,
    onBlur: (e) => { setDraft(null); onBlur?.(e); },
    onKeyDown: (e) => { if (e.key === 'Enter') setDraft(null); onKeyDown?.(e); },
  };
}

export function NumberInput({ value, onChange, step = 0.5, min, onBlur, onKeyDown, ...rest }) {
  const d = useDraft(value, onBlur, onKeyDown);
  return (
    <input className="input mono" type="number" step={step} min={min} value={d.shown}
      onChange={e => { d.setDraft(e.target.value); if (e.target.value !== '' && !Number.isNaN(Number(e.target.value))) onChange(Number(e.target.value)); }}
      onBlur={d.onBlur} onKeyDown={d.onKeyDown} {...rest} />
  );
}

/** TextInput with NumberInput's draft: for a text the caller turns into another value ("-" or "0." read as a number). */
export function DraftInput({ value, onChange, onBlur, onKeyDown, ...rest }) {
  const d = useDraft(value, onBlur, onKeyDown);
  return <TextInput value={d.shown} onChange={v => { d.setDraft(v); onChange(v); }} onBlur={d.onBlur} onKeyDown={d.onKeyDown} {...rest} />;
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

/** Deep equality of form values: key order and keys set to undefined do not count. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const keys = (o) => Object.keys(o).filter(k => o[k] !== undefined);
  const ka = keys(a), kb = keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

/** True once a dialog's form value differs from what it opened with (Dialog's `dirty`). */
export function useDirty(value) {
  const [first] = useState(() => value);
  return !sameValue(first, value);
}

/** The controls Tab stops at in `el`, in order (an unchecked radio of a group with a checked one is skipped, as Tab does). */
const TABBABLE = 'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]';
function tabbables(el) {
  return [...el.querySelectorAll(TABBABLE)].filter(n => n.tabIndex >= 0 && !n.disabled && !(n.type === 'hidden') && n.getClientRects().length > 0
    && !(n.type === 'radio' && !n.checked && n.name && el.querySelector(`input[type="radio"][name="${CSS.escape(n.name)}"]:checked`)));
}

/**
 * A modal dialog. Escape and a click outside close it; with `dirty` (unsaved changes) they ask first. The footer's
 * own Cancel button closes without asking. It takes the focus when it opens (its first field), keeps Tab inside, and
 * gives the focus back to the control that opened it when it closes (WCAG 2.4.3).
 */
export function Dialog({ title, children, onClose, footer, wide, className = '', dirty = false }) {
  const ref = useRef(null);
  const box = useRef(null);
  const T = useT();
  const ask = useRef(null);
  ask.current = () => { if (!dirty || window.confirm(T('dlg_discard'))) onClose(); };
  // the control that opened the dialog: read before the first render commits (an autoFocus field takes the focus then)
  const [opener] = useState(() => { let a = typeof document === 'undefined' ? null : document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; });
  // a dialog opened over this one (a nested editor) takes its own keys and focus
  const under = () => { const all = (ref.current?.closest('.designer') || document).querySelectorAll('.scrim'); return all.length > 1 && all[all.length - 1] !== ref.current; };
  useEffect(() => {
    // CodeMirror uses Escape to close its suggestions. Escape typed in another designer on the page is not ours.
    const inOther = (e) => { const mine = ref.current?.closest('.designer'); return e.composedPath().some(n => n !== mine && n?.classList?.contains('designer')); };
    const k = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !inOther(e) && !under()) ask.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const scrim = ref.current, d = box.current;
    if (!scrim || !d) return undefined;
    // the designer may sit in a shadow root: its activeElement is the focused control there
    const root = scrim.getRootNode();
    const active = () => root.activeElement || document.activeElement;
    // a field that took the focus itself (CodeMirror) keeps it
    if (!d.contains(active())) (tabbables(d.querySelector('.dbody') || d)[0] || d).focus({ preventScroll: true });
    // the focus moved out (a click or script on the page behind): back to the dialog
    const keep = (e) => { if (!under() && !scrim.contains(e.target) && scrim.closest('.designer')?.contains(e.target)) (tabbables(d)[0] || d).focus({ preventScroll: true }); };
    root.addEventListener('focusin', keep);
    return () => {
      root.removeEventListener('focusin', keep);
      // back to the opener, unless the action that closed the dialog put the focus somewhere else
      const now = active();
      if (opener?.isConnected && opener !== document.body && (!now || now === document.body || !now.isConnected || scrim.contains(now))) opener.focus({ preventScroll: true });
    };
  }, []);
  /** Tab on the last control goes to the first, Shift+Tab on the first to the last. */
  const trap = (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('.dialog') !== box.current) return;
    const all = tabbables(box.current);
    if (!all.length) { e.preventDefault(); return; }
    // nothing left to Tab to in that direction (in document order from the focused element): wrap around
    const dir = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
    if (!all.some(n => n !== e.target && e.target.compareDocumentPosition(n) & dir)) { e.preventDefault(); all[e.shiftKey ? all.length - 1 : 0].focus(); }
  };
  return (
    <div className="scrim" ref={ref} onPointerDown={(e) => { if (e.target === e.currentTarget) ask.current(); }}>
      <div ref={box} tabIndex={-1} onKeyDown={trap} className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>{title}</header>
        <div className="dbody">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}
