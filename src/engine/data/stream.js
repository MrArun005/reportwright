// @ts-check
/**
 * Sources read row by row (docs/research/STREAMING-1M.md §7): a JSON array split out of a byte stream, and CSV parsed
 * as it arrives. Memory is one batch of rows, not the whole body. Pure JavaScript (no Node modules): the engine runs
 * these in Node and in a browser alike.
 */
import { jsonPathRows } from './index.js';

/** A ReadableStream, an async iterable of chunks, or a string / bytes → an async iterable of text pieces. */
async function* textOf(body) {
  if (typeof body === 'string') { yield body; return; }
  if (body instanceof Uint8Array) { yield new TextDecoder().decode(body); return; }
  const dec = new TextDecoder();
  const it = body && typeof body[Symbol.asyncIterator] === 'function' ? body : body?.getReader ? readerIter(body) : null;
  if (!it) throw new Error('Not a stream');
  for await (const c of it) {
    const s = typeof c === 'string' ? c : dec.decode(c, { stream: true });
    if (s) yield s;
  }
  const last = dec.decode();
  if (last) yield last;
}
async function* readerIter(rs) {
  const r = rs.getReader();
  let done = false;
  try { for (;;) { const x = await r.read(); if (x.done) { done = true; return; } yield x.value; } }
  // a reader that stopped early (the client left, a cap, an error): cancel the body, so the fetch stops too
  finally { if (!done) await r.cancel().catch(() => {}); r.releaseLock?.(); }
}

/**
 * The keys a JSONPath walks to reach the rows, when the splitter can follow it: $, $.a.b, $['a b'], with a [*] at the
 * end at most. Null for any other path (indexes, spreads in the middle): read the whole body instead.
 * @param {string} [path] @returns {string[]|null}
 */
export function splitPath(path) {
  if (!path || path === '$') return [];
  const p = path.startsWith('$') ? path.slice(1) : '.' + path;
  const re = /\.([A-Za-z_$][\w$]*)|\['([^']+)'\]|\["([^"]+)"\]|(\[\*\])$/y;
  const keys = [];
  let at = 0;
  while (at < p.length) {
    re.lastIndex = at;
    const m = re.exec(p);
    if (!m) return null;
    if (!m[4]) keys.push(m[1] ?? m[2] ?? m[3]);
    at = re.lastIndex;
  }
  return keys;
}

/**
 * The rows of a JSON body at a path, in batches, without holding the body: the bytes are scanned for the array the
 * path names, and its elements are parsed (JSON.parse, a batch at a time) as they complete. A body whose shape the path
 * does not meet that way (an object where the rows should be, a path with indexes) is read whole and taken through
 * jsonPathRows, exactly as a whole-body read would: maxWholeBytes caps that case. Every cap counts the text actually read
 * (characters), not a declared length: the body before the rows (maxWholeBytes), one row (maxElementBytes, so one huge
 * string or a row that never ends cannot grow without bound) and the nesting (maxDepth).
 * @param {any} body @param {string|undefined} path
 * @param {{ maxElementBytes?: number, maxWholeBytes?: number, maxDepth?: number, batch?: number }} [o]
 * @returns {AsyncGenerator<any[]>}
 */
export async function* jsonRows(body, path, { maxElementBytes = 1048576, maxWholeBytes = 64 * 1048576, maxDepth = 512, batch = 1000 } = {}) {
  const keys = splitPath(path);
  let whole = keys == null ? '' : null; // the body as text, once the splitter gave up
  let buf = '', i = 0; // unscanned text; i: scan position in buf
  const stack = []; // containers: { arr, key: the current key (objects), want: expecting a key }
  let inStr = false, esc = false, strStart = -1;
  let target = -1; // stack depth of the rows' array (inside it), or -1
  let elemStart = -1, done = false;
  let out = [], outLen = 0;
  const flush = () => { const rows = JSON.parse(`[${out.join(',')}]`); out = []; outLen = 0; return rows; };
  // the path so far matches the containers' keys (each an object)
  const onPath = () => stack.length === keys.length && stack.every((s, k) => !s.arr && s.key === keys[k]);
  const giveUp = () => { whole = buf; buf = ''; };
  for await (const piece of textOf(body)) {
    if (whole != null) { whole += piece; if (whole.length > maxWholeBytes) throw tooBig(maxWholeBytes); continue; }
    if (done) continue;
    buf += piece;
    for (; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92) esc = true; // \
        else if (c === 34) { // "
          inStr = false;
          const top = stack[stack.length - 1];
          if (target < 0 && top && !top.arr && top.want) { top.key = JSON.parse(buf.slice(strStart, i + 1)); top.want = false; } // keys matter only on the way to the rows
        }
        continue;
      }
      if (c === 32 || c === 10 || c === 13 || c === 9) continue;
      const depth = stack.length;
      if (target >= 0 && depth === target && elemStart < 0 && c !== 44 && c !== 93) elemStart = i; // an element starts
      if (c === 34) { inStr = true; strStart = i; continue; }
      if (c === 123 || c === 91) { // { [
        if (target < 0 && c === 91 && onPath()) { stack.push({ arr: true }); target = stack.length; continue; }
        // the value the path names is not an array (or the root of "$" is an object): no splitting
        if (target < 0 && onPath()) { giveUp(); break; }
        if (stack.length >= maxDepth) throw Object.assign(new Error(`The JSON data nests deeper than ${maxDepth} levels`), { status: 413 });
        stack.push({ arr: c === 91, key: null, want: c === 123 });
        continue;
      }
      if (c === 125 || c === 93) { // } ]
        if (target >= 0 && depth === target) { // the rows' array ends
          if (elemStart >= 0) { out.push(buf.slice(elemStart, i)); elemStart = -1; }
          done = true; break;
        }
        stack.pop();
        continue;
      }
      if (c === 44) { // ,
        if (target >= 0 && depth === target && elemStart >= 0) {
          const t = buf.slice(elemStart, i);
          out.push(t); outLen += t.length; elemStart = -1;
          if (out.length >= batch || outLen > maxElementBytes) yield flush();
        }
        const top = stack[stack.length - 1];
        if (top && !top.arr) top.want = true;
        continue;
      }
      if (c === 58) continue; // :
      // a scalar where the path wanted a container: the root is a scalar, or the key holds one
      if (target < 0 && onPath()) { giveUp(); break; }
    }
    if (whole != null) { if (whole.length > maxWholeBytes) throw tooBig(maxWholeBytes); continue; }
    // inside the rows' array, keep only what is still needed: the element being read. Before it, keep everything (the
    // body is read whole if its shape turns out not to fit), within maxWholeBytes
    if (target < 0) { if (buf.length > maxWholeBytes) throw tooBig(maxWholeBytes); continue; }
    const keep = elemStart >= 0 ? elemStart : i;
    if (keep > 0) { buf = buf.slice(keep); i -= keep; if (elemStart >= 0) elemStart -= keep; if (inStr) strStart -= keep; }
    if (elemStart >= 0 && i - elemStart > maxElementBytes) throw Object.assign(new Error(`A row of the JSON data is larger than ${Math.round(maxElementBytes / 1048576)} MB`), { status: 413 });
  }
  if (whole != null) {
    const raw = whole === '' ? null : JSON.parse(whole);
    let { rows } = jsonPathRows(raw, path || '$');
    if (rows == null) rows = []; else if (!Array.isArray(rows)) rows = [rows];
    for (let k = 0; k < rows.length; k += batch) yield rows.slice(k, k + batch);
    return;
  }
  if (out.length) yield flush();
  if (!done && target < 0) { // the path names nothing (a missing key): no rows, as jsonPathRows gives
    if (stack.length || inStr) throw new Error('The JSON data ends too early');
  }
}
const MAX_COLUMNS = 10000; // as parseCsv
const tooBig = (n) => Object.assign(new Error(`The JSON data is larger than ${Math.round(n / 1048576)} MB and its rows are not an array at the data set's path, so it cannot be read row by row`), { status: 413 });

/**
 * CSV records as they arrive: the same reading as parseCsv (a quote opens a quoted field only at the start of a field;
 * inside, a doubled quote is a quote and separators and line breaks are data; text after the closing quote is kept;
 * \n, \r\n and \r end a record), across chunk boundaries.
 * @param {any} body @param {{ sep: string, quote: string, maxFieldBytes?: number }} o @returns {AsyncGenerator<string[][]>}
 */
export async function* csvRecords(body, { sep, quote, maxFieldBytes = 8 * 1048576 }, batch = 1000) {
  const S = sep.charCodeAt(0), Q = quote.charCodeAt(0);
  const START = 0, PLAIN = 1, QUOTED = 2, QQ = 3, CR = 4;
  let state = START, field = '', row = [], out = [], rowLen = 0; // rowLen: the text of the record's finished fields
  const endRow = () => { row.push(field); field = ''; out.push(row); row = []; rowLen = 0; };
  for await (const t of textOf(body)) {
    let a = 0; // start of the text not yet added to field
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      switch (state) {
        case CR: state = START; if (c === 10) { a = i + 1; break; } // falls through to START with c
        // eslint-disable-next-line no-fallthrough
        case START:
          if (c === Q) { state = QUOTED; a = i + 1; break; }
          state = PLAIN; a = i;
        // eslint-disable-next-line no-fallthrough
        case PLAIN:
          if (c === S) { field += t.slice(a, i); rowLen += field.length; row.push(field); field = ''; state = START; a = i + 1; }
          else if (c === 10 || c === 13) { field += t.slice(a, i); endRow(); state = c === 13 ? CR : START; a = i + 1; }
          break;
        case QUOTED:
          if (c === Q) { field += t.slice(a, i); state = QQ; a = i + 1; }
          break;
        case QQ:
          if (c === Q) { field += quote; state = QUOTED; a = i + 1; break; }
          state = PLAIN; a = i; i--; // the closing quote: what follows is read as plain text
          break;
      }
      if (row.length > MAX_COLUMNS) throw new Error(`A CSV row has more than ${MAX_COLUMNS} columns`);
    }
    if (state === PLAIN || state === QUOTED) field += t.slice(a);
    // one field held across chunks (an unclosed quote takes the rest of the body): bounded
    // and one record (a line that never ends, a field or many): bounded
    if (rowLen + field.length > maxFieldBytes) throw Object.assign(new Error(`A line of the CSV data is larger than ${Math.round(maxFieldBytes / 1048576)} MB (an unclosed quote, or no line breaks?)`), { status: 413 });
    if (out.length >= batch) { yield out; out = []; }
  }
  // the end: a record still open is the last one (an unclosed quote takes the rest)
  if (state === PLAIN || state === QUOTED || state === QQ || (state === START && row.length)) endRow();
  if (out.length) yield out;
}

/**
 * CSV rows as objects, as parseCsv gives them (startRow, the header row's names, blank lines dropped), in batches.
 * headerRow: false needs every row's width first: not read this way (null).
 * @param {any} body @param {{ separator?: string, quote?: string, headerRow?: boolean, startRow?: number }} src
 * @param {(v: any, d: string, what: string) => string} csvChar @param {number} [maxFieldBytes]
 */
export async function* csvRows(body, src, csvChar, maxFieldBytes) {
  const sep = csvChar(src.separator, ',', 'separator'), quote = csvChar(src.quote, '"', 'quote');
  if (sep === quote) throw new Error('The CSV separator and quote must differ');
  let skip = Math.max(1, Math.floor(Number(src.startRow) || 1)) - 1;
  let names = null;
  for await (const recs of csvRecords(body, { sep, quote, maxFieldBytes })) {
    const rows = [];
    for (const r of recs) {
      if (skip > 0) { skip--; continue; }
      if (!(r.length > 1 || r[0] !== '')) continue;
      if (!names) { names = r.map(h => h.trim()); continue; }
      rows.push(Object.fromEntries(names.map((h, k) => [h, r[k] ?? ''])));
    }
    if (rows.length) yield rows;
  }
}
