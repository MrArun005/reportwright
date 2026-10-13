// Maps the engine's validate() messages onto the text of a report: parse errors first, then the messages.
// validate() reports messages, not JSON paths; a message names the property or value it is about in quotes, so the
// first quoted token is searched for as a key (or a string value). No match: the start of the file.
import { parse, visit, ParseError, printParseErrorCode } from 'jsonc-parser';

export interface Found { message: string; severity: 'error' | 'warning'; start: number; end: number }

/** The offsets of the first property key or string value equal to token, or undefined. */
export function findToken(text: string, token: string): [number, number] | undefined {
  let hit: [number, number] | undefined;
  visit(text, {
    onObjectProperty: (name, offset, length) => { if (!hit && name === token) hit = [offset, offset + length]; },
    onLiteralValue: (value, offset, length) => { if (!hit && value === token) hit = [offset, offset + length]; },
  });
  return hit;
}

/** Errors and warnings for a report's text. validateFn is the engine's validate(). */
export function diagnose(text: string, validateFn: (def: any) => any): Found[] {
  const errors: ParseError[] = [];
  const def = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) return errors.map((e) => ({ message: `JSON: ${printParseErrorCode(e.error)}`, severity: 'error', start: e.offset, end: e.offset + e.length }));
  const r = validateFn(def) || {};
  const out: Found[] = [];
  const add = (list: any[] | undefined, severity: Found['severity']) => {
    for (const item of list ?? []) {
      const message = typeof item === 'string' ? item : String(item?.message ?? item);
      const token = /"([^"]+)"/.exec(message)?.[1];
      const [start, end] = (token && findToken(text, token)) || [0, Math.min(1, text.length)];
      out.push({ message, severity, start, end });
    }
  };
  add(r.errors, 'error');
  add(r.exprErrors, 'error');
  add(r.warnings, 'warning');
  add(r.checkOnly, 'warning');
  return out;
}
