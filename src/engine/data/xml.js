// @ts-check
/**
 * XML data: an XML (or SOAP) source's document, rows picked with an XPath-like path, fields from child elements and
 * attributes. The document is read by src/importers/xml.js (no DTD, so no XXE or entity expansion; caps on size,
 * depth, elements and attributes; linear time).
 *
 * XPath subset: /a/b, //b, a/b, ., .., *, p:name (prefix from the source's namespaces), @attr, @*, text(), and the
 * predicates [n], [last()], [@x], [@x='v'], [@x!='v'], [name='v'], [name], [text()='v'], [.='v']. An unprefixed name
 * matches the local name in any namespace (as SSRS's IgnoreNamespaces), a prefixed one only in its namespace.
 */
import { parseXml, XmlError } from '../../importers/xml.js';

/** @typedef {import('../../importers/xml.js').XmlElement} XmlElement */

/** Documents this module made (so a JSON response with an "$xml" key is never read as XML). */
const DOCS = new WeakSet();
const PARENTS = new WeakMap(); // root → Map(element → parent)

export const XPATH_MAX = 512; // characters in one path

/**
 * An XML source's value: the root element and the source's prefix → namespace URI map.
 * @param {string} text @param {{ namespaces?: Record<string, string> }} [src]
 */
export function xmlDocument(text, src = {}) {
  const root = parseXml(String(text ?? ''));
  const doc = { $xml: root, $ns: { ...(src.namespaces || {}) } };
  DOCS.add(doc);
  return doc;
}
/** @param {any} v */
export const isXmlDoc = (v) => v != null && typeof v === 'object' && DOCS.has(v);

/** A SOAP response's Body content (its first element), or the Fault's message as an error. @param {string} text */
export function soapBody(text, src = {}) {
  const doc = xmlDocument(text, src);
  const env = doc.$xml;
  if (env.name !== 'Envelope') throw new Error(`The SOAP response is not an Envelope (it is <${env.name}>)`);
  const body = env.children.find(c => c.name === 'Body');
  if (!body) throw new Error('The SOAP response has no Body');
  const first = body.children[0];
  if (!first) throw new Error('The SOAP response Body is empty');
  if (first.name === 'Fault') {
    const msg = stringValue(first.children.find(c => c.name === 'faultstring') || first.children.find(c => c.name === 'Reason') || first);
    throw new Error(`SOAP fault: ${msg.slice(0, 300)}`);
  }
  const out = { $xml: first, $ns: doc.$ns };
  DOCS.add(out);
  return out;
}

/** Text with &, <, >, " and ' escaped: a value placed in an XML element or attribute. @param {any} s */
export const xmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/* ---------------------------------------------------------------- XPath */

/**
 * @typedef {{ kind: 'name', prefix: string, local: string } | { kind: 'self' } | { kind: 'parent' } | { kind: 'attr', local: string }
 *   | { kind: 'text' }} Test
 * @typedef {{ desc: boolean, test: Test, preds: any[] }} Step
 */

const NAME = /^(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*|\*)$/;
const pathCache = new Map();

/** @param {string} path @returns {{ abs: boolean, steps: Step[] }} */
export function compileXPath(path) {
  path = String(path ?? '').trim();
  const hit = pathCache.get(path);
  if (hit) return hit;
  if (path.length > XPATH_MAX) throw new Error(`The XPath is longer than ${XPATH_MAX} characters`);
  if (!path) throw new Error('Give an XPath');
  // split at "/" outside [ ] and quotes
  const parts = [];
  let cur = '', depth = 0, q = '';
  for (const c of path) {
    if (q) { if (c === q) q = ''; cur += c; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (c === '/' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q || depth) throw new Error(`The XPath "${path}" has an unclosed quote or [`);
  parts.push(cur);
  const abs = parts[0] === '';
  if (abs) parts.shift();
  const steps = [];
  let desc = false;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k].trim();
    if (p === '') {
      if (desc || k === parts.length - 1) throw new Error(`The XPath "${path}" has an empty step`);
      desc = true; continue;
    }
    steps.push(step(p, desc, path));
    desc = false;
  }
  if (!steps.length) throw new Error(`The XPath "${path}" has no steps`);
  steps.forEach((s, k) => { if ((s.test.kind === 'attr' || s.test.kind === 'text') && k < steps.length - 1) throw new Error(`In "${path}", @attribute and text() must come last`); });
  const out = { abs, steps };
  if (pathCache.size > 500) pathCache.clear();
  pathCache.set(path, out);
  return out;
}

function step(p, desc, path) {
  const b = p.indexOf('[');
  const head = (b < 0 ? p : p.slice(0, b)).trim();
  const preds = [];
  if (b >= 0) {
    let rest = p.slice(b);
    while (rest) {
      if (rest[0] !== '[') throw new Error(`The XPath "${path}": text after a predicate`);
      let k = 1, q = '';
      for (; k < rest.length; k++) { const c = rest[k]; if (q) { if (c === q) q = ''; } else if (c === "'" || c === '"') q = c; else if (c === ']') break; }
      preds.push(pred(rest.slice(1, k).trim(), path));
      rest = rest.slice(k + 1).trim();
    }
  }
  /** @type {Test} */
  let test;
  if (head === '.') test = { kind: 'self' };
  else if (head === '..') test = { kind: 'parent' };
  else if (head === 'text()') test = { kind: 'text' };
  else if (head.startsWith('@')) {
    const m = NAME.exec(head.slice(1));
    if (!m) throw new Error(`The XPath "${path}": "${head}" is not an attribute name`);
    test = { kind: 'attr', local: m[2] }; // attributes are matched by local name
  } else {
    const m = NAME.exec(head);
    if (!m) throw new Error(`The XPath "${path}": "${head}" is not supported (names, *, ., .., @attr, text() and simple [predicates] are)`);
    test = { kind: 'name', prefix: m[1] || '', local: m[2] };
  }
  if (preds.length && test.kind !== 'name') throw new Error(`The XPath "${path}": a predicate goes on an element step`);
  return { desc, test, preds };
}

const LIT = /^(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))$/;
function pred(s, path) {
  if (/^\d+$/.test(s)) { const n = Number(s); if (n < 1) throw new Error(`The XPath "${path}": positions start at 1`); return { pos: n }; }
  if (s === 'last()') return { last: true };
  const m = /^(@?[A-Za-z_][\w.:-]*|text\(\)|\.)\s*(?:(!?=)\s*(.+))?$/.exec(s);
  if (!m) throw new Error(`The XPath "${path}": the predicate [${s}] is not supported`);
  let value = null;
  if (m[2]) {
    const l = LIT.exec(m[3].trim());
    if (!l) throw new Error(`The XPath "${path}": compare with a quoted value in [${s}]`);
    value = l[1] ?? l[2] ?? l[3];
  }
  const what = m[1];
  const local = what.replace(/^@/, '').replace(/^[^:]*:/, '');
  return { attr: what.startsWith('@'), self: what === '.' || what === 'text()', local, op: m[2] || null, value };
}

/** element → parent, for "..": built once per document, iteratively. @param {XmlElement} root */
function parentsOf(root) {
  let m = PARENTS.get(root);
  if (m) return m;
  m = new Map();
  const stack = [root];
  while (stack.length) { const e = /** @type {XmlElement} */ (stack.pop()); for (const c of e.children) { m.set(c, e); stack.push(c); } }
  PARENTS.set(root, m);
  return m;
}

/** The text of an element and all its descendants, trimmed (XPath's string value). @param {XmlElement} el */
export function stringValue(el) {
  if (!el.children.length) return el.text.trim();
  let s = '';
  const stack = [el];
  while (stack.length) { const e = /** @type {XmlElement} */ (stack.pop()); s += e.text; for (let i = e.children.length - 1; i >= 0; i--) stack.push(e.children[i]); }
  return s.trim();
}

/**
 * Evaluate a path: elements, or strings for @attr / text().
 * @param {{ $xml: XmlElement, $ns: Record<string, string> }} doc
 * @param {string} path
 * @param {XmlElement} [context] for a relative path (a field of a row); a relative path without one starts at the root
 * @returns {(XmlElement|string)[]}
 */
export function selectXml(doc, path, context) {
  const { abs, steps } = compileXPath(path);
  const root = doc.$xml;
  const DOC = { name: '#document', ns: '', attrs: {}, children: [root], text: '' };
  /** @type {any[]} */
  let cur = abs ? [DOC] : [context || root];
  const up = (e) => (e === DOC ? null : e === root ? DOC : parentsOf(root).get(e) || null);
  for (const s of steps) {
    if (s.desc) {
      // descendant-or-self of every context node, each node once (a walk stops at nodes already seen): linear
      const seen = new Set(), all = [];
      for (const c of cur) {
        if (typeof c === 'string') continue;
        const stack = [c];
        while (stack.length) {
          const e = stack.pop();
          if (seen.has(e)) continue;
          seen.add(e); all.push(e);
          for (let i = e.children.length - 1; i >= 0; i--) stack.push(e.children[i]);
        }
      }
      cur = all;
    }
    const next = [], seen = new Set();
    const add = (x) => { if (typeof x === 'string') next.push(x); else if (!seen.has(x)) { seen.add(x); next.push(x); } };
    for (const c of cur) {
      if (typeof c === 'string') continue;
      const t = s.test;
      if (t.kind === 'self') add(c);
      else if (t.kind === 'parent') { const p = up(c); if (p) add(p); }
      else if (t.kind === 'text') { if (c !== DOC) add(c.text.trim()); }
      else if (t.kind === 'attr') { if (t.local === '*') Object.values(c.attrs).forEach(add); else if (Object.hasOwn(c.attrs, t.local)) add(c.attrs[t.local]); }
      else {
        let ns = null;
        if (t.prefix) {
          if (!Object.hasOwn(doc.$ns, t.prefix)) throw new Error(`The XPath prefix "${t.prefix}" has no namespace; add it to the source's namespaces`);
          ns = doc.$ns[t.prefix];
        }
        let kids = c.children.filter(e => (t.local === '*' || e.name === t.local) && (ns === null || e.ns === ns));
        for (const p of s.preds) kids = filterPred(kids, p);
        kids.forEach(add);
      }
    }
    cur = next;
  }
  return cur.filter(x => x && (typeof x === 'string' || x.name !== '#document'));
}

function filterPred(list, p) {
  if (p.pos) return list[p.pos - 1] ? [list[p.pos - 1]] : [];
  if (p.last) return list.length ? [list[list.length - 1]] : [];
  return list.filter((e) => {
    /** @type {string[]} */
    let vals;
    if (p.self) vals = [stringValue(e)];
    else if (p.attr) vals = Object.hasOwn(e.attrs, p.local) ? [e.attrs[p.local]] : [];
    else vals = e.children.filter(c => c.name === p.local).map(stringValue);
    if (!p.op) return vals.length > 0;
    const eq = vals.some(v => v === p.value);
    return p.op === '=' ? eq : vals.length > 0 && !eq;
  });
}

/** A field's value: the first result of a path relative to the row element, as text. */
export function xmlValue(doc, el, path) {
  const r = selectXml(doc, path, el)[0];
  return r == null ? null : typeof r === 'string' ? r : stringValue(r);
}

/* ---------------------------------------------------------------- rows */

const SKIP_KEY = '__proto__';
/**
 * A row object from an element: its attributes, each child element (text for a leaf, an object for a child with
 * children of its own, a list when the name repeats), and its own text under its name when it has no child elements.
 * @param {XmlElement} el
 */
export function xmlObject(el) {
  /** @type {Record<string, any>} */
  const o = {};
  for (const [k, v] of Object.entries(el.attrs)) if (k !== SKIP_KEY) o[k] = v;
  if (!el.children.length) { const t = el.text.trim(); if (t && el.name !== SKIP_KEY) o[el.name] = t; return o; }
  const kids = new Set(), lists = new Set();
  for (const c of el.children) {
    if (c.name === SKIP_KEY) continue;
    const v = c.children.length ? xmlObject(c) : c.text.trim();
    if (!kids.has(c.name)) { o[c.name] = v; kids.add(c.name); continue; } // a child element wins over an attribute
    if (!lists.has(c.name)) { o[c.name] = [o[c.name]]; lists.add(c.name); }
    o[c.name].push(v);
  }
  return o;
}

/**
 * Every repeating element in the document (an element whose parent has more than one child of that name), as the
 * response explorer shows lists: { path, rows, objects, fields, spreads }. One linear walk; fields from the first 50 rows.
 * @param {{ $xml: XmlElement }} doc
 */
export function xmlRowPaths(doc) {
  /** @type {Map<string, { rows: number, repeats: boolean, fields: Set<string>, depth: number }>} */
  const seen = new Map();
  const stack = [{ e: doc.$xml, path: `/${doc.$xml.name}`, depth: 0 }];
  while (stack.length) {
    const { e, path, depth } = /** @type {any} */ (stack.pop());
    const counts = new Map();
    for (const c of e.children) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    for (const c of e.children) {
      const p = `${path}/${c.name}`;
      let s = seen.get(p);
      if (!s) seen.set(p, s = { rows: 0, repeats: false, fields: new Set(), depth: depth + 1 });
      s.rows++;
      if (counts.get(c.name) > 1) s.repeats = true;
      if (s.rows <= 50) {
        for (const k of Object.keys(c.attrs)) s.fields.add(k);
        for (const g of c.children) if (!g.children.length) s.fields.add(g.name);
        if (!c.children.length && c.text.trim()) s.fields.add(c.name);
      }
      if (c.children.length) stack.push({ e: c, path: p, depth: depth + 1 });
    }
  }
  return [...seen].filter(([, s]) => s.repeats).map(([path, s]) => ({ path, rows: s.rows, objects: true, fields: [...s.fields], spreads: s.depth }));
}

/** The likeliest rows: the most rows, then the shallowest. */
export function bestXmlRows(doc) {
  const list = xmlRowPaths(doc).sort((a, b) => b.rows - a.rows || a.spreads - b.spreads);
  return list[0] || null;
}

/**
 * Row elements and row objects for a data set path ("$" or empty: the likeliest repeating element).
 * @param {{ $xml: XmlElement, $ns: Record<string, string> }} doc @param {string} [path]
 */
export function xmlRows(doc, path) {
  let p = path && path !== '$' ? path : bestXmlRows(doc)?.path;
  if (!p) return { els: [doc.$xml], rows: [xmlObject(doc.$xml)] };
  const found = selectXml(doc, p);
  const els = found.filter(x => typeof x !== 'string');
  // a path to @attributes or text(): one row per value
  if (!els.length && found.length) return { els: null, rows: found.map(v => ({ value: v })) };
  return { els, rows: els.map(xmlObject) };
}

export { XmlError };
