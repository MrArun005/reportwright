// @ts-check
import { evalValue, evaluate, compile, parseValue, toText, functionTable, cmpVal, sortCompare, ROW_PARENT } from '../expr/evaluate.js';
import { toDate, isoDate, parseNumber } from '../expr/format.js';
import { xmlDocument, soapBody, xmlEscape, isXmlDoc, xmlRows, xmlValue } from './xml.js';
import { odataUrl, odataPage, odataClean, ODATA_MAX_PAGES, ODATA_DEFAULT_PAGES } from './odata.js';

/**
 * Data layer: sources → raw JSON; data sets → typed, filtered, sorted rows.
 */

function pathTokens(path) {
  const toks = [];
  const re = /\.([A-Za-z_$][\w$]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/g;
  const p = path.startsWith('$') ? path.slice(1) : '.' + path;
  let m, last = 0;
  while ((m = re.exec(p))) {
    if (m.index !== last) throw new Error(`Bad data path "${path}"`);
    toks.push(m[1] ?? m[3] ?? m[4] ?? (m[2] === '*' ? '*' : Number(m[2])));
    last = re.lastIndex;
  }
  if (last !== p.length) throw new Error(`Bad data path "${path}"`);
  return toks;
}

/** Minimal JSONPath: $, $.a.b, $.a[0].b, $.a[*].b, $['a b'] */
export function jsonPath(obj, path) {
  if (!path || path === '$') return obj;
  let cur = [obj], spread = false;
  for (const t of pathTokens(path)) {
    const nxt = [];
    for (const c of cur) {
      if (c == null) continue;
      if (t === '*') { if (typeof c === 'object') for (const k of Array.isArray(c) ? c : Object.values(c)) nxt.push(k); spread = true; }
      else nxt.push(c[t]);
    }
    cur = nxt;
  }
  return spread ? cur : cur[0];
}

/**
 * jsonPath that also says, for each result of a [*] spread, which object held the spread collection
 * (for $.books[*].positions[*], the book of each position): Parent.* in the data set's rows.
 * @returns {{rows: any, parents: any[]|null}}
 */
export function jsonPathRows(obj, path) {
  if (!path || path === '$') return { rows: obj, parents: null };
  let cur = [obj], hold = [null], par = [null], spread = false;
  for (const t of pathTokens(path)) {
    const nv = [], nh = [], np = [];
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c == null) continue;
      if (t === '*') {
        if (typeof c !== 'object') continue;
        const kids = Array.isArray(c) ? c : Object.values(c);
        for (const k of kids) { nv.push(k); nh.push(c); np.push(hold[i]); }
        spread = true;
      } else { nv.push(c[t]); nh.push(c); np.push(par[i]); }
    }
    cur = nv; hold = nh; par = np;
  }
  return spread ? { rows: cur, parents: par } : { rows: cur[0], parents: null };
}

/**
 * A raw value as the field's type. Numbers in text are read the locale's way ("12,5" and "1.234,56" in de-DE, "1,234.5"
 * and "(1,234)" in en-US); dates without a zone are the wall clock of the report's zone. A value that does not read
 * is null, and opt.bad hears of it (the data set warns once).
 * @param {any} v @param {string} type @param {{ locale?: string, timeZone?: string, bad?: (v: any) => void }} [opt]
 */
export function coerce(v, type, opt) {
  if (v == null || v === '') return v === '' && type === 'string' ? '' : null;
  switch (type) {
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : parseNumber(String(v), opt?.locale);
      if (Number.isNaN(n)) { opt?.bad?.(v); return null; }
      return n;
    }
    case 'date': { const d = toDate(v, opt); if (!d) opt?.bad?.(v); return d; }
    case 'boolean': return typeof v === 'boolean' ? v : ['true', '1', 'yes', 'y'].includes(String(v).toLowerCase());
    case 'string': return typeof v === 'string' ? v : String(v);
    // a list of values (a sparkline's points): an array as it is, or text split at commas or semicolons
    case 'list': {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string') return [v];
      return v.split(/[,;]/).map(x => x.trim()).filter(x => x !== '').map(x => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
    }
    default: return v;
  }
}

/** Guess field names and types from sample rows. */
export function detectFields(rows) {
  const out = new Map();
  for (const r of rows.slice(0, 50)) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) {
      // an array of plain values is a list field (an array of objects is rows: a nested data set)
      const list = Array.isArray(v) && v.every(x => x == null || typeof x !== 'object');
      if (v != null && typeof v === 'object' && !(v instanceof Date) && !list) continue;
      const t = list ? 'list' : guessType(v);
      if (!out.has(k) || out.get(k) === 'null') out.set(k, t);
      else if (out.get(k) !== t && t !== 'null') out.set(k, 'string');
    }
  }
  return [...out].map(([name, type]) => ({ name, type: type === 'null' ? 'string' : type }));
}
function guessType(v) {
  if (v == null) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'date';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return 'date';
  return 'string';
}

const MAX_CSV_COLUMNS = 10000;
const MAX_CSV_CELLS = 5_000_000; // rows × columns: a wide header over many short lines would multiply
/** One-character CSV option: "tab" and "\\t" mean a tab. */
function csvChar(v, dflt, what) {
  if (v == null || v === '') return dflt;
  const c = v === 'tab' || v === '\\t' ? '\t' : String(v);
  if (c.length !== 1 || c === '\n' || c === '\r') throw new Error(`The CSV ${what} must be one character`);
  return c;
}

/**
 * Parse CSV text into objects. One forward scan, O(n): a quote opens a quoted field only at the start of
 * a field; inside, a doubled quote is a quote, and separators and line breaks are data.
 * @param {string} text
 * @param {{separator?: string, quote?: string, headerRow?: boolean, startRow?: number}} [opts]
 *   startRow: 1-based record where the header (or the data, without a header row) starts.
 */
export function parseCsv(text, opts = {}) {
  const sep = csvChar(opts.separator, ',', 'separator');
  const quote = csvChar(opts.quote, '"', 'quote');
  if (sep === quote) throw new Error('The CSV separator and quote must differ');
  text = String(text ?? '');
  const n = text.length;
  const rows = [];
  let row = [], i = 0;
  const endOfField = (k) => { while (k < n && text[k] !== sep && text[k] !== '\n' && text[k] !== '\r') k++; return k; };
  for (;;) {
    let cell;
    if (text[i] === quote) {
      let j = i + 1, buf = '';
      for (;;) {
        const k = text.indexOf(quote, j);
        if (k < 0) { buf += text.slice(j); j = n; break; } // no closing quote: the rest is the field
        buf += text.slice(j, k);
        if (text[k + 1] === quote) { buf += quote; j = k + 2; continue; }
        j = k + 1; break;
      }
      const e = endOfField(j); // text after the closing quote is kept
      cell = buf + text.slice(j, e); i = e;
    } else {
      const e = endOfField(i);
      cell = text.slice(i, e); i = e;
    }
    row.push(cell);
    if (row.length > MAX_CSV_COLUMNS) throw new Error(`A CSV row has more than ${MAX_CSV_COLUMNS} columns`);
    if (i >= n) { rows.push(row); break; }
    if (text[i] === sep) { i++; continue; }
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    i++;
    rows.push(row); row = [];
    if (i >= n) break;
  }
  const start = Math.max(1, Math.floor(Number(opts.startRow) || 1));
  const kept = rows.slice(start - 1).filter(r => r.length > 1 || r[0] !== '');
  let width = 0;
  for (const r of kept) width = Math.max(width, r.length);
  if (width * kept.length > MAX_CSV_CELLS) throw new Error(`The CSV has more than ${MAX_CSV_CELLS.toLocaleString('en')} cells (rows × columns)`);
  if (opts.headerRow === false) {
    const names = Array.from({ length: width }, (_, k) => `Column${k + 1}`);
    return kept.map(r => Object.fromEntries(names.map((h, k) => [h, r[k] ?? ''])));
  }
  const [head, ...body] = kept;
  if (!head) return [];
  const names = head.map(h => h.trim());
  return body.map(r => Object.fromEntries(names.map((h, k) => [h, r[k] ?? ''])));
}

/**
 * Load every data source used by the report.
 * @param {any} def
 * @param {{params: object, fetch?: typeof fetch, baseUrl?: string, reportId?: string,
 *   sql?: (src: any, params: Record<string, any>) => Promise<object[]>, sqlPreview?: boolean}} opt
 *   sql: runs a SQL source directly (server renders). Without it the server runs the saved report's
 *   query: the browser sends the report id and source name, never SQL.
 */
export async function loadSources(def, opt) {
  const ctx = { params: opt.params, globals: {}, dataSets: {}, fields: null, functions: functionTable(def) };
  const out = {};
  const f = opt.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  await Promise.all((def.dataSources || []).map(async (src) => {
    try {
      if (src.type === 'json') out[src.name] = typeof src.data === 'string' ? JSON.parse(src.data) : src.data;
      else if (src.type === 'sql') out[src.name] = await loadSql(src, ctx.params, opt, f);
      else if (src.type === 'csv' && src.data) out[src.name] = parseCsv(src.data, src);
      else if (src.type === 'xml' && src.data) out[src.name] = xmlDocument(src.data, src);
      else if (FETCHED_TYPES.includes(src.type)) {
        if (!f) throw new Error('No fetch() available');
        out[src.name] = await loadFetched(src, ctx, opt, f);
      } else throw new Error(`Unknown data source type "${src.type}"`);
    } catch (e) {
      throw Object.assign(new Error(`Data source "${src.name}": ${e.message}`), { status: e.status }); // keep 403 for a refused address
    }
  }));
  return out;
}

/** Source types whose data is fetched (an xml or csv source with inline data is not). */
export const FETCHED_TYPES = ['rest', 'csv', 'graphql', 'xml', 'soap', 'odata'];

/**
 * A fetched source, every request through the caller's fetch (the guarded one: reportFetch in the browser, serverFetch
 * on the server), from one URL template.
 */
async function loadFetched(src, ctx, opt, f) {
  const target = urlFrom(src.url || '', ctx);
  const headers = {};
  for (const [k, v] of Object.entries(src.headers || {})) headers[k] = String(evalValue(v, ctx));
  /** @param {string} url the target (before the proxy) @param {RequestInit} init */
  const call = async (url, init) => {
    let u = url;
    if (src.useProxy) u = `/api/data/proxy?url=${encodeURIComponent(u)}`;
    if (opt.baseUrl && u.startsWith('/')) u = opt.baseUrl.replace(/\/$/, '') + u;
    const res = await f(u, init);
    return { res, u };
  };
  if (src.type === 'odata') return loadOData(src, ctx, target, headers, call);
  if (src.type === 'soap') {
    if (src.useProxy) throw new Error('The data proxy only reads (GET); a SOAP call cannot go through it');
    const version = String(src.soapVersion || '1.1');
    const action = String(src.soapAction || '');
    if (/["\r\n]/.test(action)) throw new Error('The SOAP action may not hold quotes or line breaks');
    const h = { ...headers };
    if (version === '1.2') h['content-type'] = `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ''}`;
    else { h['content-type'] = 'text/xml; charset=utf-8'; h.SOAPAction = `"${action}"`; }
    const { res, u } = await call(target, { method: 'POST', headers: h, body: soapEnvelope(src.envelope, ctx) });
    const text = await res.text();
    if (!res.ok) { // a SOAP fault comes with HTTP 500: its message says more than the status
      let fault = null;
      try { soapBody(text, src); } catch (e) { fault = /^SOAP fault/.test(e.message) ? e.message : null; }
      throw new Error(fault || `HTTP ${res.status} from ${u}`);
    }
    return soapBody(text, src);
  }
  const init = { method: src.type === 'graphql' ? 'POST' : src.method || 'GET', headers };
  if (src.type === 'graphql') {
    headers['content-type'] ||= 'application/json';
    const vars = src.variables ? variablesFrom(src.variables, ctx) : {};
    init.body = JSON.stringify({ query: src.query, variables: vars });
  } else if (src.body && init.method !== 'GET') init.body = src.type === 'xml' ? soapEnvelope(src.body, ctx) : String(evalValue(src.body, ctx));
  const { res, u } = await call(target, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${u}`);
  if (src.type === 'csv') return parseCsv(await res.text(), src);
  if (src.type === 'xml') return xmlDocument(await res.text(), src);
  const json = await res.json();
  if (src.type === 'graphql' && json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  return src.type === 'graphql' ? json.data : json;
}

/**
 * A SOAP envelope (or an XML request body) from its template: {…} values are XML-escaped, so a parameter is text,
 * never markup. An "=expression" envelope is refused: its result could not be escaped.
 */
function soapEnvelope(tpl, ctx) {
  const p = parseValue(String(tpl ?? ''));
  if (p.kind === 'expr') throw new Error('Write the envelope as XML with {Parameters.x} for values, not as an =expression');
  if (p.kind !== 'tpl') return String(p.v ?? '');
  return p.parts.map(part => (typeof part === 'string' ? part : xmlEscape(plain(evaluate(part.ast, ctx), ctx)))).join('');
}

/** Every page of an OData entity set, up to maxPages; a next link must stay on the first request's origin. */
async function loadOData(src, ctx, root, headers, call) {
  const pages = Math.min(ODATA_MAX_PAGES, Math.max(1, Math.floor(Number(src.maxPages) || ODATA_DEFAULT_PAGES)));
  let url = odataUrl(root, src, (v) => evalValue(v, ctx));
  const DUMMY = 'http://pagewright.invalid';
  const first = new URL(url, DUMMY);
  const rows = [];
  const h = { accept: 'application/json', ...headers };
  for (let n = 0; n < pages && url; n++) {
    const { res, u } = await call(url, { method: 'GET', headers: h });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${u}`);
    const page = odataPage(await res.json());
    for (const r of page.rows) rows.push(r);
    const here = new URL(url, DUMMY);
    url = null;
    if (page.next) {
      const next = new URL(page.next, here);
      if (next.origin !== first.origin) throw new Error(`OData: the next page link goes to another site (${next.origin}); it is not followed`);
      url = first.origin === DUMMY ? next.pathname + next.search : next.href;
    }
  }
  return odataClean(rows, src.types || {});
}

/** A SQL source: run it here (server) or ask the server to run the saved report's query (browser). */
async function loadSql(src, params, opt, f) {
  const day = (v) => (v instanceof Date ? isoDate(v) : v);
  const p = Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(day) : day(v)]));
  if (opt.sql) return opt.sql(src, p);
  if (!f) throw new Error('No fetch() available');
  // sqlPreview: the designer's unsaved query (the server allows it for designers only)
  if (!opt.reportId && !opt.sqlPreview) throw new Error('Save the report first: SQL runs on the server, from the saved report.');
  const url = `${(opt.baseUrl || '').replace(/\/$/, '')}/api/data/sql`;
  const body = opt.sqlPreview ? { connection: src.connection, query: src.query, procedure: src.procedure, args: src.args, params: p } : { report: opt.reportId, source: src.name, params: p };
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status} from ${url}`), { status: res.status });
  return json.rows;
}

const plain = (x, ctx) => (x instanceof Date ? isoDate(x) : toText(x, null, ctx));

/**
 * URL from a template: typed-in values are encoded, so "A&B" stays one value. A leading {…} may hold a base URL.
 * A value in the path is one segment ("/" is encoded) and may not make a "." or ".." segment, alone or with the
 * text around it: /items/{Parameters.id} with id ".." would otherwise reach /items' parent.
 */
function urlFrom(v, ctx) {
  const p = parseValue(v);
  if (p.kind !== 'tpl') return String(evalValue(v, ctx) ?? '');
  let url = '';
  const filled = []; // [start, end) of each encoded value in url
  p.parts.forEach((part, i) => {
    if (typeof part === 'string') { url += part; return; }
    const s = plain(evaluate(part.ast, ctx), ctx);
    if (i === 0) { url += s; return; }
    filled.push([url.length, url.length + encodeURIComponent(s).length]);
    url += encodeURIComponent(s);
  });
  // the path ends at the query or fragment; the URL parser reads %2e as a dot too
  const q = url.search(/[?#]/), pathEnd = q < 0 ? url.length : q;
  let start = 0;
  for (let i = 0; i <= pathEnd; i++) {
    if (i < pathEnd && url[i] !== '/') continue;
    const seg = url.slice(start, i).toLowerCase().replaceAll('%2e', '.');
    if ((seg === '.' || seg === '..') && filled.some(([a, b]) => a < i && b > start)) {
      throw Object.assign(new Error(`a parameter makes the URL path segment "${url.slice(start, i)}"; "." and ".." are not allowed from parameters`), { status: 400 });
    }
    start = i + 1;
  }
  return url;
}

/** GraphQL variables: JSON whose strings may hold {Parameters.x}. A string that is just one {…} keeps the value's type. */
function variablesFrom(src, ctx) {
  let json;
  try { json = JSON.parse(src); } catch { return JSON.parse(String(evalValue(src, ctx))); } // older form: a template that builds JSON
  const fill = (v) => {
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    if (typeof v !== 'string') return v;
    const p = parseValue(v);
    if (p.kind === 'tpl' && p.parts.length === 1 && typeof p.parts[0] !== 'string') {
      const x = evaluate(p.parts[0].ast, ctx);
      return x instanceof Date ? isoDate(x) : x;
    }
    return evalValue(v, ctx);
  };
  return fill(json);
}

/** Wildcards: * any run, ? one character, any case. No regex: at most len(s) × len(pattern) steps, so "a*a*a*…b" cannot hang the server. */
function like(s, p) {
  s = s.toLowerCase(); p = p.toLowerCase();
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < s.length) {
    if (j < p.length && (p[j] === '?' || p[j] === s[i])) { i++; j++; }
    else if (j < p.length && p[j] === '*') { star = j++; mark = i; }
    else if (star >= 0) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (p[j] === '*') j++;
  return j === p.length;
}

/**
 * Build typed rows for every data set.
 * @param {any} def @param {Record<string, any>} sources @param {any} baseCtx
 */
export function buildDataSets(def, sources, baseCtx) {
  /** @type {Record<string, any[]>} */
  const sets = {};
  // rows of a data set that others hang off (relation.parent) keep their raw object
  const raws = new Set((def.dataSets || []).filter(d => d.relation).map(d => d.relation.parent));
  for (const ds of def.dataSets || []) {
    let list, parents = null, xdoc = null, xels = null;
    if (ds.relation) {
      // nested data set: the children of every parent row, each knowing its parent row
      const prows = sets[ds.relation.parent];
      if (!prows) throw new Error(`Data set "${ds.name}": its parent "${ds.relation.parent}" must be a data set declared above it`);
      list = []; parents = [];
      for (const p of prows) {
        let kids = jsonPath(RAW.get(p), ds.relation.path || '$');
        if (kids == null) continue;
        if (!Array.isArray(kids)) kids = [kids];
        for (const k of kids) { list.push(k); parents.push(p); }
      }
    } else {
      let raw = sources[ds.source];
      if (raw === undefined) throw new Error(`Data set "${ds.name}": the source "${ds.source}" does not exist`);
      // data pushed for an XML or SOAP source (render API): XML text is read as XML; JSON rows are the rows (the XPath is not a JSONPath)
      const xmlSrc = (def.dataSources || []).find(s => s.name === ds.source && (s.type === 'xml' || s.type === 'soap'));
      if (xmlSrc && typeof raw === 'string') raw = xmlDocument(raw, xmlSrc);
      if (isXmlDoc(raw)) { // XPath rows; field paths are XPaths relative to the row element
        xdoc = raw;
        ({ rows: list, els: xels } = xmlRows(raw, ds.path));
      } else {
        ({ rows: list, parents } = jsonPathRows(raw, xmlSrc ? '$' : ds.path || '$'));
        if (list == null) list = [];
        if (!Array.isArray(list)) list = [list];
      }
    }
    const fields = ds.fields && ds.fields.length ? ds.fields : detectFields(list);
    const plain = fields.filter(fd => !fd.expr);
    const calc = fields.filter(fd => fd.expr);
    const keepRaw = raws.has(ds.name);
    // values that do not read as their field's type: one warning per field, with the first one
    const bad = new Map();
    const optFor = (fd) => ({ locale: ds.locale || baseCtx.locale, timeZone: baseCtx.timeZone, bad: (v) => { const b = bad.get(fd.name); if (b) b.n++; else bad.set(fd.name, { n: 1, v, type: fd.type }); } });
    const opts = new Map(fields.map(fd => [fd, optFor(fd)]));
    let rows = list.map((r, i) => {
      const o = {};
      for (const fd of plain) o[fd.name] = coerce(fd.path ? (xels ? xmlValue(xdoc, xels[i], fd.path) : jsonPath(r, fd.path)) : r?.[fd.name], fd.type, opts.get(fd));
      if (parents && parents[i] != null) ROW_PARENT.set(o, parents[i]);
      if (keepRaw) RAW.set(o, r);
      return o;
    });
    if (calc.length) {
      // Calculated fields see the data sets built before this one (so Lookup() into an earlier set works).
      // A failing expression gives null for that field, with one warning, instead of stopping the report.
      const c = { ...baseCtx, dataSets: { ...(baseCtx.dataSets || {}), ...sets }, fields: null };
      const failed = new Set();
      for (const r of rows) {
        c.fields = r;
        for (const fd of calc) {
          if (failed.has(fd.name)) { r[fd.name] = null; continue; }
          try { r[fd.name] = coerce(evalValue(fd.expr, c), fd.type, opts.get(fd)); }
          catch (e) { failed.add(fd.name); r[fd.name] = null; baseCtx.warn?.(`Data set "${ds.name}", field "${fd.name}": ${e.message}`); }
        }
      }
    }
    for (const [f, b] of bad) baseCtx.warn?.(`Data set "${ds.name}", field "${f}": ${b.n} value${b.n > 1 ? 's do' : ' does'} not read as ${b.type === 'date' ? 'a date' : 'a number'} (for example "${String(b.v).slice(0, 40)}"), so ${b.n > 1 ? 'they are' : 'it is'} blank.`);
    // filters and sorts may Lookup into the data sets defined above this one
    const setCtx = { ...baseCtx, dataSets: { ...baseCtx.dataSets, ...sets }, ...(ds.caseSensitive != null ? { caseSensitive: ds.caseSensitive === true } : {}) };
    rows = applyFilters(rows, ds.filters, setCtx);
    rows = applySort(rows, ds.sort, setCtx);
    if (ds.relation) {
      const byParent = new Map();
      for (const r of rows) {
        const p = ROW_PARENT.get(r);
        let a = byParent.get(p);
        if (!a) byParent.set(p, a = []);
        a.push(r);
      }
      RELATIONS.set(rows, { parent: ds.relation.parent, byParent });
    }
    sets[ds.name] = rows;
  }
  return sets;
}

/** Typed row → its raw source object (only for parents of nested data sets). */
const RAW = new WeakMap();
/** Rows array of a nested data set → {parent, byParent: Map(parent row → child rows)}. */
const RELATIONS = new WeakMap();

/**
 * Rows a region bound to a data set should show: for a nested data set inside a list (or group) bound to its
 * parent, only the current parent rows' children; anywhere else, all rows.
 * @param {any[]} rows @param {any} ctx
 */
export function related(rows, ctx) {
  const rel = RELATIONS.get(rows);
  const cur = rel && ctx?.current?.[rel.parent];
  if (!cur) return rows;
  if (cur.length === 1) return rel.byParent.get(cur[0]) || [];
  const out = [];
  for (const p of cur) for (const r of rel.byParent.get(p) || []) out.push(r);
  return out;
}

/**
 * Filters run in the order listed. Row filters (=, <, in, like, Between …) test each row; set filters
 * (TopN, BottomN, TopPercent, BottomPercent) rank all rows left by the filters before them.
 * @param {any[]} rows @param {any[]|undefined} filters
 */
export function applyFilters(rows, filters, baseCtx) {
  if (!filters || !filters.length) return rows;
  const c = { ...baseCtx };
  let i = 0;
  while (i < filters.length) {
    const f = filters[i];
    if (SET_OPS.has(String(f.op || '').toLowerCase())) { rows = rankFilter(rows, f, c); i++; continue; }
    let j = i; // a run of row filters: one pass
    while (j < filters.length && !SET_OPS.has(String(filters[j].op || '').toLowerCase())) j++;
    const run = filters.slice(i, j);
    rows = rows.filter((r) => { c.fields = r; return run.every(f => rowFilter(f, c)); });
    i = j;
  }
  return rows;
}

const SET_OPS = new Set(['topn', 'bottomn', 'toppercent', 'bottompercent']);
const PARAM_ONLY = /^=\s*Parameters\s*[.!]\s*\w+(\.Value)?\s*$/i;

function rowFilter(f, c) {
  const a = evalValue(f.expr, c);
  const b = evalValue(f.value, c);
  switch (f.op || '=') {
    case '=': return looseEq(a, b);
    case '<>': return !looseEq(a, b);
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case 'in': {
      // an empty list matches nothing (an empty LookupSet, a blank value), except nothing picked in a parameter the
      // filter reads directly (=Parameters.Region): that means "all", so a report opens unfiltered
      const list = Array.isArray(b) ? b : b == null || b === '' ? [] : String(b).split(',').map(s => s.trim());
      if (!list.length) return PARAM_ONLY.test(String(f.value ?? ''));
      return list.some(x => looseEq(a, x));
    }
    case 'like': return like(String(a ?? ''), String(b ?? ''));
    case 'contains': return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
    case 'between': case 'Between': {
      // inclusive at both ends; value may be a [low, high] pair instead of value + value2
      const [lo, hi] = Array.isArray(b) ? b : [b, evalValue(f.value2, c)];
      return a != null && lo != null && hi != null && cmpVal(a, lo) >= 0 && cmpVal(a, hi) <= 0;
    }
    default: throw new Error(`Unknown filter operator "${f.op}"`);
  }
}

/**
 * TopN / BottomN / TopPercent / BottomPercent, ranked by the filter's expression. Ties with the last
 * value kept are kept too (so more than N rows may pass, as in RDL); rows with no value drop out. Row order stays.
 */
function rankFilter(rows, f, c) {
  const op = String(f.op).toLowerCase();
  c.fields = rows[0] || null;
  const n = Number(evalValue(f.value, c));
  if (!Number.isFinite(n)) throw new Error(`The ${f.op} filter needs a number, not "${String(f.value).slice(0, 40)}"`);
  const keys = rows.map((r) => { c.fields = r; return evalValue(f.expr, c); });
  const ranked = keys.filter(k => k != null && k !== '');
  const count = op.endsWith('percent') ? Math.ceil((ranked.length * Math.min(n, 100)) / 100) : Math.min(n, ranked.length);
  if (count <= 0) return [];
  const top = op.startsWith('top');
  ranked.sort((x, y) => (top ? cmpVal(y, x) : cmpVal(x, y)));
  const edge = ranked[Math.ceil(count) - 1];
  return rows.filter((_, i) => keys[i] != null && keys[i] !== '' && (top ? cmpVal(keys[i], edge) >= 0 : cmpVal(keys[i], edge) <= 0));
}
function looseEq(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  // eslint-disable-next-line eqeqeq
  return a == b;
}

/** @param {any[]} rows @param {any[]|undefined} sort */
export function applySort(rows, sort, baseCtx) {
  if (!sort || !sort.length) return rows;
  const c = { ...baseCtx };
  const keys = rows.map((r) => { c.fields = r; return sort.map(s => { const v = evalValue(s.by, c); return v instanceof Date ? v.getTime() : v; }); });
  const idx = rows.map((_, i) => i);
  idx.sort((i, j) => {
    for (let k = 0; k < sort.length; k++) {
      const a = keys[i][k], b = keys[j][k];
      if (a === b) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const r = sortCompare(a, b, baseCtx); // the report's locale, case-insensitive, natural (SSRS collation)
      if (r === 0) continue;
      return sort[k].dir === 'desc' ? -r : r;
    }
    return i - j;
  });
  return idx.map(i => rows[i]);
}

export { evaluate, compile };

/**
 * The raw rows of a source at a data set path: XPath for an XML source, JSONPath otherwise (the designer's Detect and Use).
 * @param {any} raw @param {string} [path]
 */
export function sourceRows(raw, path) {
  if (isXmlDoc(raw)) return xmlRows(raw, path).rows;
  const v = jsonPath(raw, path || '$');
  return v == null ? [] : Array.isArray(v) ? v : [v];
}
export { isXmlDoc };

/** A source URL template filled with parameter values, as a fetch would use it (the designer's $metadata call). */
export const sourceUrl = (url, params) => urlFrom(url || '', { params: params || {}, globals: {}, dataSets: {}, fields: null });
