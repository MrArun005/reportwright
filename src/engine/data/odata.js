// @ts-check
/**
 * OData sources: the service's $metadata (entity sets and their properties), a query URL built from the designer's
 * choices ($select, $filter from a simple builder, $orderby, $top, $skip, $expand), and the rows of every page
 * (@odata.nextLink, odata.nextLink or d.__next), up to a page cap, on the same origin only.
 *
 * Safe by construction: property names must be identifiers (Nav/Prop paths allowed), values become OData literals
 * (strings quoted with '' doubled, numbers checked finite, GUIDs checked), so a parameter cannot change the query.
 */
import { parseXml } from '../../importers/xml.js';
import { toDate, isoDate } from '../expr/format.js';

export const ODATA_MAX_PAGES = 100;
export const ODATA_DEFAULT_PAGES = 10;

const IDENT = /^[A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*$/;
const NUMERIC = /^Edm\.(Int16|Int32|Int64|Byte|SByte|Decimal|Double|Single)$/;
const OPS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith', 'endswith']);

/** ReportWright field type of an Edm type. @param {string} [edm] */
export function odataFieldType(edm) {
  const t = String(edm || '');
  if (NUMERIC.test(t)) return 'number';
  if (/^Edm\.(Date|DateTime|DateTimeOffset)$/.test(t)) return 'date';
  if (t === 'Edm.Boolean') return 'boolean';
  return 'string';
}

/**
 * Entity sets of a $metadata (CSDL) document, with their properties (base types included) and navigation properties.
 * @param {string} text
 * @returns {{ name: string, type: string, properties: { name: string, type: string }[], navigation: string[] }[]}
 */
export function odataMetadata(text) {
  const root = parseXml(String(text ?? ''));
  const types = new Map(), sets = [];
  const stack = [root];
  while (stack.length) {
    const e = /** @type {any} */ (stack.pop());
    if (e.name === 'Schema') {
      for (const t of e.children) if (t.name === 'EntityType' && t.attrs.Name) {
        for (const pre of [e.attrs.Namespace, e.attrs.Alias].filter(Boolean)) types.set(`${pre}.${t.attrs.Name}`, t);
        types.set(t.attrs.Name, t);
      }
    }
    if (e.name === 'EntitySet' && e.attrs.Name) sets.push({ name: e.attrs.Name, type: e.attrs.EntityType || '' });
    for (const c of e.children) stack.push(c);
  }
  return sets.map((s) => {
    const properties = [], navigation = [];
    let t = types.get(s.type) || types.get(s.type.split('.').pop());
    for (let hops = 0; t && hops < 16; hops++) { // BaseType chain, loop-safe
      for (const c of t.children) {
        if (c.name === 'Property' && c.attrs.Name) properties.push({ name: c.attrs.Name, type: c.attrs.Type || 'Edm.String' });
        if (c.name === 'NavigationProperty' && c.attrs.Name) navigation.push(c.attrs.Name);
      }
      t = t.attrs.BaseType ? types.get(t.attrs.BaseType) : null;
    }
    return { name: s.name, type: s.type, properties, navigation };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const ident = (s, what) => {
  const v = String(s ?? '').trim();
  if (!IDENT.test(v)) throw new Error(`OData: "${v.slice(0, 60)}" is not a valid ${what} name`);
  return v;
};

/** An OData literal for a value of an Edm type (or of the value's own JS type). */
export function odataLiteral(v, type) {
  const t = String(type || '');
  if (NUMERIC.test(t) || (!t && typeof v === 'number')) {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isFinite(n) || String(v).trim() === '') throw new Error(`OData: "${String(v).slice(0, 40)}" is not a number`);
    return String(n);
  }
  if (t === 'Edm.Boolean' || (!t && typeof v === 'boolean')) return ['true', '1', 'yes'].includes(String(v).toLowerCase()) ? 'true' : 'false';
  if (/^Edm\.(Date|DateTime|DateTimeOffset)$/.test(t) || (!t && v instanceof Date)) {
    const d = toDate(v);
    if (!d) throw new Error(`OData: "${String(v).slice(0, 40)}" is not a date`);
    return t === 'Edm.Date' ? isoDate(d) : t === 'Edm.DateTime' ? `datetime'${d.toISOString().slice(0, 19)}'` : d.toISOString();
  }
  if (t === 'Edm.Guid') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v))) throw new Error(`OData: "${String(v).slice(0, 40)}" is not a GUID`);
    return String(v);
  }
  return `'${(v instanceof Date ? v.toISOString() : String(v)).replace(/'/g, "''")}'`;
}

/**
 * The query string of an OData source. `value(x)` evaluates a filter value, top or skip ({Parameters.x}, =expr or text).
 * A filter whose value is empty (an unset parameter) is left out, so it means "all".
 * @param {any} src @param {(v: any) => any} value
 */
export function odataQuery(src, value) {
  const q = [];
  const sel = (src.select || []).map(s => ident(s, 'property'));
  if (sel.length) q.push(`$select=${sel.join(',')}`);
  const clauses = [];
  for (const f of src.filters || []) {
    if (!f || !f.field) continue;
    const field = ident(f.field, 'property');
    const op = String(f.op || 'eq');
    if (!OPS.has(op)) throw new Error(`OData: the operator "${op}" is not supported`);
    const v = value(f.value);
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const one = (x) => (op === 'contains' || op === 'startswith' || op === 'endswith' ? `${op}(${field},${odataLiteral(x, 'Edm.String')})` : `${field} ${op} ${odataLiteral(x, f.type)}`);
    clauses.push(Array.isArray(v) ? `(${v.map(one).join(op === 'ne' ? ' and ' : ' or ')})` : one(v));
  }
  if (clauses.length) q.push(`$filter=${encodeURIComponent(clauses.join(' and '))}`);
  const ord = (src.orderby || []).filter(o => o && o.field).map(o => `${ident(o.field, 'property')}${o.dir === 'desc' ? ' desc' : ''}`);
  if (ord.length) q.push(`$orderby=${encodeURIComponent(ord.join(','))}`);
  for (const k of ['top', 'skip']) {
    if (src[k] == null || src[k] === '') continue;
    const v = value(src[k]);
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`OData: $${k} must be a whole number, not "${String(v).slice(0, 20)}"`);
    q.push(`$${k}=${n}`);
  }
  const exp = (src.expand || []).map(s => ident(s, 'navigation property'));
  if (exp.length) q.push(`$expand=${exp.join(',')}`);
  return q.join('&');
}

/** The entity set's URL: the service root + the entity set + the query. @param {string} root @param {any} src @param {(v: any) => any} value */
export function odataUrl(root, src, value) {
  const set = ident(src.entitySet, 'entity set');
  const q = odataQuery(src, value);
  const r = String(root || '');
  const [base, existing] = r.split('?');
  const url = `${base.replace(/\/+$/, '')}/${set}`;
  const all = [existing, q].filter(Boolean).join('&');
  return all ? `${url}?${all}` : url;
}

/** One page of a response: its rows (v4 value, v2 d.results / d) and the next link, if any. @param {any} json */
export function odataPage(json) {
  const d = json?.d;
  const rows = Array.isArray(json?.value) ? json.value : Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : null;
  if (!rows) throw new Error('OData: the response has no "value" list (is the URL an entity set?)');
  const next = json['@odata.nextLink'] ?? json['odata.nextLink'] ?? d?.__next ?? null;
  return { rows, next: typeof next === 'string' && next ? next : null };
}

/** Rows without OData annotations, numbers and dates read by the source's property types. */
export function odataClean(rows, types = {}) {
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    /** @type {Record<string, any>} */
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('@odata.') || k.startsWith('odata.') || k === '__metadata' || k === '__proto__' || k.includes('@odata.')) continue;
      if (v && typeof v === 'object' && v.__deferred) continue;
      const t = types[k];
      if (t && NUMERIC.test(t) && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) o[k] = Number(v);
      else if (typeof v === 'string' && /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.test(v)) o[k] = new Date(Number(/-?\d+/.exec(v)?.[0])).toISOString(); // OData v2
      else o[k] = v;
    }
    return o;
  });
}
