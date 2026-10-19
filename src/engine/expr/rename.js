// @ts-check
// Renames inside expressions, read with the expression lexer (not a text search): Parameters.old becomes
// Parameters.new, and a data set's name changes where a function takes it as its scope (Sum(Fields.x, "Sales"),
// Lookup(…, "Sales")). Other string literals, and the plain text of a template around its {…} parts, stay as they are.
import { lex } from './parser.js';
import { AGGREGATES } from './evaluate.js';

/** The argument that names a scope (a data set, a group or a data region), by function name in lower case. */
const SCOPE_ARG = {
  ...Object.fromEntries(AGGREGATES.map((n) => [n, 1])),
  rank: 1,
  distinctsum: 2,
  aggregateif: 3,
  countrows: 0,
  rownumber: 0,
  runningvalue: 2,
  lookup: 3,
  lookupset: 3,
};

/** Where the string literal that starts at p ends (after its closing quote), read as lex() reads it. */
function literalEnd(src, p) {
  const q = src[p];
  let j = p + 1;
  while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

/**
 * One expression (without its "=") with the renames done; one that does not lex is left as it is.
 * @param {string} src @param {{ parameter?: [string, string], dataSet?: [string, string] }} how
 */
function renameExpr(src, how) {
  let toks;
  try {
    toks = lex(src);
  } catch {
    return src;
  }
  const edits = [];
  const frames = []; // open brackets: a call's name and which argument the tokens are in
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k],
      prev = toks[k - 1],
      next = toks[k + 1];
    const afterDot = prev?.t === 'op' && prev.v === '.';
    if (how.parameter && t.t === 'id' && !afterDot && String(t.v).toLowerCase() === 'parameters' && next?.v === '.') {
      const nm = toks[k + 2];
      if (nm?.t === 'id' && nm.v === how.parameter[0])
        edits.push({ from: nm.p, to: nm.p + nm.v.length, text: how.parameter[1] });
    }
    if (t.t === 'op' && (t.v === '(' || t.v === '[')) {
      const call = t.v === '(' && prev?.t === 'id' && toks[k - 2]?.v !== '.' ? String(prev.v).toLowerCase() : null;
      frames.push({ call, arg: 0 });
    } else if (t.t === 'op' && (t.v === ')' || t.v === ']')) frames.pop();
    else if (t.t === 'op' && t.v === ',' && frames.length) frames[frames.length - 1].arg++;
    else if (how.dataSet && t.t === 'str' && t.v === how.dataSet[0]) {
      // the whole argument is this literal, in the scope place of its function
      const f = frames[frames.length - 1];
      if (
        f?.call &&
        Object.hasOwn(SCOPE_ARG, f.call) &&
        SCOPE_ARG[f.call] === f.arg &&
        (prev?.v === '(' || prev?.v === ',') &&
        (next?.v === ',' || next?.v === ')')
      ) {
        const q = src[t.p];
        edits.push({ from: t.p, to: literalEnd(src, t.p), text: `${q}${how.dataSet[1]}${q}` });
      }
    }
  }
  let out = src;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

/** The "}" that closes a template's "{" (quotes skipped), as the evaluator finds it; -1 when there is none. */
function findClose(s, i) {
  let q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '}') return i;
  }
  return -1;
}

/**
 * A value ("=expression", a text with {expression} parts, or plain text) with the renames done.
 * @param {any} value @param {{ parameter?: [string, string], dataSet?: [string, string] }} how [old name, new name]
 */
export function renameInValue(value, how) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('=')) return `=${renameExpr(value.slice(1), how)}`;
  if (!value.includes('{')) return value;
  let out = '',
    i = 0;
  while (i < value.length) {
    if (value.startsWith('{{', i) || value.startsWith('}}', i)) {
      out += value.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (value[i] === '{') {
      const end = findClose(value, i + 1);
      if (end < 0) return value; // does not parse: left for the checks to flag
      out += `{${renameExpr(value.slice(i + 1, end), how)}}`;
      i = end + 1;
      continue;
    }
    out += value[i++];
  }
  return out;
}

/**
 * Every string under node with the renames done, in place; skip(key, parent) leaves a part out (inline data rows).
 * @param {any} node @param {{ parameter?: [string, string], dataSet?: [string, string] }} how
 * @param {(key: string, parent: any) => boolean} [skip]
 * @returns {number} how many strings changed
 */
export function renameRefs(node, how, skip = () => false, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 200) return 0;
  let n = 0;
  for (const k of Object.keys(node)) {
    if (skip(k, node)) continue;
    const v = node[k];
    if (typeof v === 'string') {
      const r = renameInValue(v, how);
      if (r !== v) {
        node[k] = r;
        n++;
      }
    } else n += renameRefs(v, how, skip, depth + 1);
  }
  return n;
}
