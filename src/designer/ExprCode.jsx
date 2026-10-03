'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { FUNCTION_NAMES } from '@/engine/expr/evaluate.js';

/* Tiny tokenizer for the Pagewright expression language. */
const lang = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(Fields|Parameters|Globals)\b/)) return 'variableName.special';
    if (stream.match(/^(And|Or|Not|True|False|Nothing|Null)\b/i)) return 'keyword';
    if (stream.match(/^[A-Za-z_]\w*(?=\s*\()/)) return 'function';
    if (stream.match(/^[A-Za-z_]\w*/)) return 'variableName';
    if (stream.match(/^[{}]/)) return 'brace';
    stream.next();
    return 'operator';
  },
});
const hl = HighlightStyle.define([
  { tag: tags.string, color: '#b45309' },
  { tag: tags.number, color: '#0e7490' },
  { tag: tags.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: tags.function(tags.variableName), color: '#1d4ed8' },
  { tag: tags.special(tags.variableName), color: '#be185d', fontWeight: '600' },
  { tag: tags.brace, color: '#6d28d9', fontWeight: '700' },
]);

const theme = EditorView.theme({
  '&': { border: '1px solid var(--line)', borderRadius: '6px', fontSize: '13px', background: '#fff' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'var(--mono)', minHeight: '120px', padding: '8px 0' },
  '.cm-scroller': { maxHeight: '260px' },
  '.cm-tooltip-autocomplete': { fontFamily: 'var(--mono)', fontSize: '12px' },
});

/**
 * @param {{ value: string, onChange: (v: string) => void, fields: string[], parameters: string[], invalid?: boolean }} props
 */
const ExprCode = forwardRef(function ExprCode({ value, onChange, fields, parameters, invalid }, ref) {
  const host = useRef(null);
  const view = useRef(null);
  const latest = useRef({ onChange, fields, parameters });
  latest.current = { onChange, fields, parameters };

  useImperativeHandle(ref, () => ({
    insert(text) {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      let ins = text;
      if (v.state.doc.length === 0) ins = '=' + text;
      v.dispatch({ changes: { from, to, insert: ins }, selection: { anchor: from + ins.length } });
      v.focus();
    },
    focus() { view.current?.focus(); },
  }));

  useEffect(() => {
    const complete = (ctx) => {
      const m = ctx.matchBefore(/(Fields|Parameters|Globals)\.\w*$/);
      if (m) {
        const [root] = m.text.split('.');
        const list = root === 'Fields' ? latest.current.fields : root === 'Parameters' ? latest.current.parameters : ['PageNumber', 'TotalPages', 'ExecutionTime', 'ReportName'];
        return { from: m.from + root.length + 1, options: list.map(l => ({ label: l, type: 'property' })) };
      }
      const w = ctx.matchBefore(/[A-Za-z_]\w*$/);
      if (!w && !ctx.explicit) return null;
      return {
        from: w ? w.from : ctx.pos,
        options: [
          ...FUNCTION_NAMES.map(f => ({ label: f, type: 'function', apply: `${f}(` })),
          ...['Fields', 'Parameters', 'Globals'].map(r => ({ label: r, type: 'namespace', apply: `${r}.` })),
        ],
      };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value ?? '',
        extensions: [
          history(), closeBrackets(), bracketMatching(), lang, syntaxHighlighting(hl), theme, EditorView.lineWrapping,
          autocompletion({ override: [complete], activateOnTyping: true }),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          cmPlaceholder('=Sum(Fields.amount)   or   Page {Globals.PageNumber}'),
          EditorView.updateListener.of((u) => { if (u.docChanged) latest.current.onChange(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ 'aria-label': 'Expression' }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} data-testid="expr-code" style={invalid ? { boxShadow: '0 0 0 1px var(--danger)', borderRadius: 6 } : undefined} />;
});

export default ExprCode;
