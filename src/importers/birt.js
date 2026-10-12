// @ts-check
/**
 * BIRT importer: an Eclipse BIRT report design (.rptdesign) becomes a ReportWright report definition.
 *
 * A front end like rdl.js and jrxml.js: the XML (read safely, see xml.js) is rewritten into the RDLX-JSON shape and
 * rdlx.js does the mapping, the expression translation, the notes and the stats. BIRT lays out in a flow (each item
 * below the one before), so items are stacked with their heights (given, or estimated from the text). Mapped:
 * tables (columns, header, groups, detail, footer, bound columns and their aggregates, sorts, filters, highlight
 * rules), grids, lists, labels, data, text (with <value-of>), dynamic text, auto text, images, the master page's
 * header and footer, parameters (static and data set lists), data sources and data sets (JDBC SQL with its ?
 * parameters, computed columns, filters). Charts become ReportWright charts, crosstabs matrices; scripts are noted. BIRT expressions are JavaScript:
 * row["X"], dataSetRow["X"], params["P"].value, Total.sum(…), BirtStr/BirtMath/BirtDateTime/BirtComp, and the usual
 * string methods become VB (java.js, with BIRT's hooks).
 *
 * Pure JavaScript, no Node APIs and no DOM. It never throws: whatever it cannot map becomes a warning.
 */
import { parseXml, XmlError } from './xml.js';
import { importRdlx, crosstabTablix, ImportBudgetError, OUTPUT_LIMITS, toPt, rewordItems, translateExpression } from './rdlx.js';
import { placeCharts } from './jrxml.js';
import { javaToVb, javaPattern, Untranslatable } from './java.js';

const BIRT_NS = /^http:\/\/www\.eclipse\.org\/birt\/2005\/design$/;
const MAX_EXPR = 20_000;
const MAX_DEPTH = 32;

/**
 * Convert a BIRT report design.
 * @param {string} input the .rptdesign text
 * @param {{ name?: string }} [opts]
 * @returns {{ definition: any, warnings: string[], stats: { items: number, mapped: number, approximated: number, dropped: number }, error?: string }}
 */
export function importBirt(input, opts = {}) {
  const name = opts.name || 'Imported BIRT report';
  let root;
  try { root = parseXml(String(input ?? '')); } catch (e) {
    const error = e instanceof XmlError ? `The file is not readable XML: ${e.message}` : `The file could not be read (${e instanceof Error ? e.message : e})`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  if (root.name !== 'report' || (root.ns && !BIRT_NS.test(root.ns.trim()) && !/birt/i.test(root.ns))) {
    const error = `The file is not a BIRT report design: its root is <${root.name}>${root.ns ? ` in ${root.ns}` : ''}, not <report>`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  /** @type {string[]} */
  const notes = [];
  let ar;
  PAGE_BREAKS.clear();
  /** @type {Map<string, any>} chart placeholders → ReportWright charts */
  const charts = new Map();
  try { ar = toRdlx(root, notes, name, charts); } catch (e) {
    if (e instanceof ImportBudgetError) {
      const error = `The report is too large to import: ${e.message}`;
      return { ...importRdlx({}, { name }), warnings: [`${error}.`], error };
    }
    notes.push(`The import stopped early (${e instanceof Error ? e.message : e}), so parts of the report are missing.`);
    ar = {};
  }
  const r = importRdlx(ar, { name });
  if (r.error) return r;
  placeCharts(r.definition, charts);
  const reword = (w) => w.replace(/ActiveReports/g, 'BIRT').replace(/pwchart§\d+/g, k => charts.get(k)?.name ?? k);
  const warnings = [...notes, ...r.warnings].map(reword);
  const walk = (items) => { for (const i of items || []) { if (i.type === 'table' && PAGE_BREAKS.get(i.name) > 0) i.pageBreakEvery = PAGE_BREAKS.get(i.name); walk(i.items); } };
  for (const sec of [r.definition.sections?.body].flat()) walk(sec?.items);
  PAGE_BREAKS.clear();
  r.definition.collation = 'ordinal'; // text sorts as the source engine compares it (ground truth: tests/diff)
  r.definition.nullOrder = 'low'; // a null sorts first ascending, as Java comparators and BIRT do
  r.definition.arithmetic = 'double'; // JavaScript and Java compute with IEEE doubles
  r.definition.bandRows = 'first-last'; // headers are evaluated on their first row, footers on their last
  return { definition: r.definition, warnings: [...new Set(warnings)], stats: r.stats, items: rewordItems(r.items, reword) };
}

/* ================================================================ properties */

const PROPS = new Set(['property', 'text-property', 'expression', 'xml-property', 'html-property', 'encrypted-property']);
/** a property's text (<property name=…>, <text-property>, <expression>…) */
const prop = (e, name) => e?.children.find(c => PROPS.has(c.name) && c.attrs.name === name)?.text;
const struct = (e, name) => e?.children.find(c => c.name === 'structure' && c.attrs.name === name);
/** the structures of a <list-property name=…> */
const listProp = (e, name) => e?.children.find(c => c.name === 'list-property' && c.attrs.name === name)?.children.filter(c => c.name === 'structure') || [];
/** the values of a <simple-property-list name=…> */
const simpleList = (e, name) => e?.children.find(c => c.name === 'simple-property-list' && c.attrs.name === name)?.children.filter(c => c.name === 'value') || [];

const FONT_SIZES = { 'xx-small': 6, 'x-small': 7.5, small: 8.5, medium: 10, large: 12, 'x-large': 14.5, 'xx-large': 18, smaller: 8.5, larger: 12 };
const BORDER_W = { thin: 0.75, medium: 1.5, thick: 2.25 };
const PAGE_TYPES = { 'us-letter': [612, 792], 'us-legal': [612, 1008], a4: [595.28, 841.89], a5: [419.53, 595.28], a3: [841.89, 1190.55], 'us-super-b': [936, 1368] };

/* ================================================================ the design → RDLX-JSON */

/** @param {import('./xml.js').XmlElement} root @param {string[]} notes @param {string} reportName */
/** table name → BIRT pageBreakInterval, for the definition (rdlx.js has no such setting) */
const PAGE_BREAKS = new Map();
function toRdlx(root, notes, reportName, charts) {
  const kid = (e, n) => e?.children.find(c => c.name === n);
  const kids = (e, n) => (e ? e.children.filter(c => n == null || c.name === n) : []);
  const note = (m) => { if (!notes.includes(m)) notes.push(m); };
  const units = prop(root, 'units') || 'in';
  let produced = 0;
  const budget = (s) => { produced += s.length; if (produced > OUTPUT_LIMITS.chars) throw new ImportBudgetError(`its expressions grow past ${OUTPUT_LIMITS.chars / 1e6} million characters`); return s; };
  /** a BIRT length in points ("1.5in", "12pt", "50%" of `of`; a bare number is in the report's units) */
  const len = (v, of = 0, fallback = 0) => {
    if (v == null || v === '') return fallback;
    const s = String(v).trim();
    if (s.endsWith('%')) return (parseFloat(s) / 100) * of;
    if (/^-?[\d.]+$/.test(s)) return toPt(`${s}${units === 'px' ? 'px' : units}`, fallback);
    if (/em$/.test(s)) return parseFloat(s) * 10 || fallback;
    return toPt(s, fallback);
  };
  const pt = (n) => `${Math.round(n * 100) / 100}pt`;

  /* ---------------------------------------------------------------- scripts */
  let scripts = 0;
  const walkAll = (e, fn, depth = 0) => { if (depth > 200) return; fn(e); for (const c of e.children) walkAll(c, fn, depth + 1); };
  walkAll(root, (e) => { if (e.name === 'method' && e.text.trim()) scripts++; });
  if (scripts) note(`The report has ${scripts} event script${scripts > 1 ? 's' : ''} (JavaScript run while it renders); ReportWright does not run them, so what they change is missing.`);
  if (kids(root, 'list-property').some(l => l.attrs.name === 'libraries') || kid(root, 'list-property')?.attrs.name === 'libraries') note('The report uses BIRT libraries; their items are not in this file, so items from them are missing.');

  /* ---------------------------------------------------------------- parameters */
  const paramNames = new Set();
  const params = [];
  walkAll(root, (e) => { if (e.name === 'scalar-parameter' && e.attrs.name) { params.push(e); paramNames.add(e.attrs.name); } });

  /* ---------------------------------------------------------------- expressions: BIRT JavaScript → VB */

  /**
   * @typedef {{ bindings?: Map<string, any>, outer?: any, group?: string, dataSet?: string, inSet?: boolean, region?: string }} Ctx
   *   bindings: the bound columns of the table or list the item is in (row["X"] reads them); inSet: a data set's own
   *   expression (computed columns, filters), where row["X"] is the field
   */
  const fieldRef = (n) => ({ s: /^[A-Za-z_]\w*$/.test(n) ? `Fields!${n}.Value` : `Fields("${n.replace(/"/g, '""')}").Value`, t: /** @type {'any'} */ ('any'), p: 9 });
  const paramRef = (n) => ({ s: /^[A-Za-z_]\w*$/.test(n) ? `Parameters!${n}.Value` : `Parameters("${n.replace(/"/g, '""')}").Value`, t: /** @type {'any'} */ ('any'), p: 9 });
  const AGG = { sum: 'Sum', count: 'Count', countdistinct: 'CountDistinct', ave: 'Avg', avg: 'Avg', average: 'Avg', max: 'Max', min: 'Min', first: 'First', last: 'Last', stddev: 'StDev', variance: 'Var' };
  const RUNNING = { runningsum: 'Sum', runningcount: 'Count' };
  /**
   * @param {string} src @param {Ctx} c @param {number} [depth]
   * @returns {string} VB
   */
  function vb(src, c, depth = 0) {
    let s = String(src ?? '').trim().replace(/;+\s*$/, '');
    if (!s) return '""';
    if (s.length > MAX_EXPR) throw new Untranslatable(`an expression of ${s.length} characters`);
    if (depth > 12) throw new Untranslatable('bound columns that use each other more than 12 deep');
    /** @type {any} */
    const env = {
      notes: [], js: true, // JavaScript: "a" + 5 is "a5", "a" + null "anull"
      field: (n) => fieldRef(n), param: (n) => paramRef(n), variable: (n) => { throw new Untranslatable(`$V{${n}}`); },
      ident: (n) => (n === 'pageNumber' ? { s: 'Globals!PageNumber', t: 'num', p: 9 } : n === 'totalPage' ? { s: 'Globals!TotalPages', t: 'num', p: 9 } : undefined),
      index: (n, E) => {
        const o = n.obj;
        if (o.k === 'id' && o.name === 'dataSetRow') return fieldRef(String(n.key));
        if (o.k === 'id' && o.name === 'row') {
          const key = String(n.key);
          if (key === '__rownum') return { s: 'RowNumber(Nothing) - 1', t: 'num', p: 6 };
          if (c.inSet || !c.bindings) return fieldRef(key);
          const b = c.bindings.get(key);
          if (!b) return fieldRef(key);
          return { s: `(${binding(b, c, depth + 1)})`, t: 'any', p: 9 };
        }
        if (o.k === 'member' && o.name === '_outer' && o.obj.k === 'id' && o.obj.name === 'row') {
          const key = String(n.key);
          const b = c.outer?.bindings?.get(key);
          if (b) return { s: `(${binding(b, c.outer, depth + 1)})`, t: 'any', p: 9 };
          return fieldRef(key);
        }
        if (o.k === 'id' && o.name === 'params') return paramRef(String(n.key));
        if (o.k === 'id' && o.name === 'measure' && c.cube) return c.cube.measure(String(n.key));
        if (o.k === 'index' && o.obj.k === 'id' && o.obj.name === 'dimension' && c.cube) return c.cube.level(String(o.key), String(n.key));
        if (o.k === 'id' && (o.name === 'vars' || o.name === 'reportContext')) throw new Untranslatable(`${o.name}["${n.key}"]`);
        return undefined;
      },
      memberOf: (n, E) => {
        if (n.obj.k === 'index' && n.obj.obj.k === 'id' && n.obj.obj.name === 'params') {
          if (n.name === 'value') return paramRef(String(n.obj.key));
          if (n.name === 'displayText') { note('params["…"].displayText gives the value, not its label, in ReportWright.'); return paramRef(String(n.obj.key)); }
        }
        if (n.obj.k === 'id' && n.obj.name === 'params' && paramNames.has(n.name)) return paramRef(n.name); // params.P (then .value)
        if (n.name === 'value' && n.obj.k === 'member' && n.obj.obj.k === 'id' && n.obj.obj.name === 'params') return paramRef(n.obj.name);
        if (n.obj.k === 'id' && n.obj.name === 'row' && /^\w+$/.test(n.name) && n.name !== '_outer') return env.index({ k: 'index', obj: n.obj, key: n.name }, E);
        if (n.obj.k === 'id' && n.obj.name === 'dataSetRow') return fieldRef(n.name);
        if (n.name === 'length') { const v = E(n.obj); return { s: `Len(${v.s})`, t: 'num', p: 9 }; }
        return undefined;
      },
      call: (n, E) => {
        const cls = n.obj?.k === 'id' ? n.obj.name : null;
        const a = () => n.args.map(E);
        const f = (name, args, t = 'any') => ({ s: `${name}(${args.map(x => x.s).join(', ')})`, t, p: 9 });
        if (cls === 'Total') {
          const m = n.name.toLowerCase();
          if (AGG[m]) {
            const args = a();
            if (args.length > 1 && !(n.args[1].k === 'null' || (n.args[1].k === 'bool' && n.args[1].v))) throw new Untranslatable(`Total.${n.name} with a filter`);
            // BIRT: no group (or "Overall") is the whole table or list wherever the cell is (N1); a named group is that group
            const grp = n.args[2]?.k === 'str' && n.args[2].v !== 'Overall' ? n.args[2].v : c.region;
            return { s: `${AGG[m]}(${args[0]?.s ?? '1'}${grp ? `, "${String(grp).replace(/"/g, '""')}"` : ''})`, t: 'num', p: 9 };
          }
          if (RUNNING[m]) { const grp = n.args[2]?.k === 'str' && n.args[2].v !== 'Overall' ? n.args[2].v : c.region; return { s: `RunningValue(${a()[0]?.s ?? '1'}, ${RUNNING[m]}${grp ? `, "${String(grp).replace(/"/g, '""')}"` : ''})`, t: 'num', p: 9 }; }
          throw new Untranslatable(`Total.${n.name}()`);
        }
        if (cls === 'BirtDateTime') {
          const m = n.name;
          if (m === 'today') return { s: 'Today', t: 'date', p: 9 };
          if (m === 'now') return { s: 'Now', t: 'date', p: 9 };
          if (/^(year|month|day)$/.test(m)) return f(m[0].toUpperCase() + m.slice(1), a(), 'num');
          throw new Untranslatable(`BirtDateTime.${m}()`);
        }
        if (cls === 'BirtStr') {
          const S = { toUpper: 'UCase', toLower: 'LCase', trim: 'Trim', left: 'Left', right: 'Right', charLength: 'Len' };
          if (S[n.name]) return f(S[n.name], a(), n.name === 'charLength' ? 'num' : 'str');
          if (n.name === 'concat') return { s: a().map(x => `(${x.s})`).join(' & '), t: 'str', p: 5 };
          throw new Untranslatable(`BirtStr.${n.name}()`);
        }
        if (cls === 'BirtMath') {
          const x = a();
          const ops = { add: '+', subtract: '-', multiply: '*', divide: '/' };
          if (ops[n.name]) return { s: `(${x[0].s}) ${ops[n.name]} (${x[1].s})`, t: 'num', p: 7 };
          if (n.name === 'safeDivide') return { s: `IIF((${x[1].s}) = 0, ${x[2]?.s ?? '0'}, (${x[0].s}) / IIF((${x[1].s}) = 0, 1, ${x[1].s}))`, t: 'num', p: 9 };
          // BirtMath.round is JavaScript's Math.round at a decimal: halves go up, toward +infinity (-3.25 → -3.2)
          if (n.name === 'round') { const k = `(10 ^ (${x[1]?.s ?? '0'}))`; return { s: `Floor((${x[0].s}) * ${k} + 0.5) / ${k}`, t: 'num', p: 7 }; }
          // BirtMath.mod has the divisor's sign (-1 mod 3 is 2), not the dividend's
          if (n.name === 'mod') return { s: `(${x[0].s}) - (${x[1].s}) * Floor((${x[0].s}) / (${x[1].s}))`, t: 'num', p: 6 };
          throw new Untranslatable(`BirtMath.${n.name}()`);
        }
        if (cls === 'BirtComp') {
          const x = a();
          const C = { equalTo: '=', notEqual: '<>', greaterThan: '>', greaterOrEqual: '>=', lessThan: '<', lessOrEqual: '<=' };
          if (C[n.name]) return { s: `(${x[0].s}) ${C[n.name]} (${x[1].s})`, t: 'bool', p: 4 };
          if (n.name === 'between') return { s: `(${x[0].s}) >= (${x[1].s}) AndAlso (${x[0].s}) <= (${x[2].s})`, t: 'bool', p: 2 };
          throw new Untranslatable(`BirtComp.${n.name}()`);
        }
        if (cls === 'Formatter' && n.name === 'format' && n.args[1]?.k === 'str') return { s: `Format(${E(n.args[0]).s}, "${`icu:${n.args[1].v}`.replace(/"/g, '""')}")`, t: 'str', p: 9 };
        // parseInt reads the leading integer and truncates: "2.7" is 2, "12abc" is 12 (CInt would round, and refuse the text)
        if (!n.obj && n.name === 'parseInt') { const x = a(); if (x.length > 1) throw new Untranslatable('parseInt with a radix'); return { s: `Fix(Val(JsStr(${x[0].s})))`, t: 'num', p: 9, i: true }; }
        if (!n.obj && n.name === 'parseFloat') return f('CDbl', a(), 'num');
        if (!n.obj && n.name === 'String') { const x = a(); return { s: `JsStr(${x[0]?.s ?? '""'})`, t: 'str', p: 9, nn: true }; }
        if (!n.obj && n.name === 'Number') return f('CDbl', a(), 'num');
        // toFixed: JavaScript's rounding of the binary value (3.015 is 3.01), always "." and Latin digits
        if (n.obj && n.name === 'toFixed') return { s: `JsStr(${E(n.obj).s}, ${n.args[0] ? E(n.args[0]).s : '0'})`, t: 'str', p: 9, nn: true };
        // String.replace with a text pattern changes the first match only
        if (n.obj && n.name === 'replace' && n.args.length === 2 && n.args[0].k === 'str') { const o = E(n.obj), x = a(); return { s: `Replace(${o.s}, ${x[0].s}, ${x[1].s}, 1, 1)`, t: 'str', p: 9 }; }
        if (n.obj && /^(getFullYear|getMonth|getDate)$/.test(n.name)) { const v = E(n.obj); return n.name === 'getMonth' ? { s: `Month(${v.s}) - 1`, t: 'num', p: 6 } : f(n.name === 'getFullYear' ? 'Year' : 'Day', [v], 'num'); }
        return undefined;
      },
    };
    const v = javaToVb(s, env);
    if (v.s.length > MAX_EXPR) throw new Untranslatable('an expression that grows too long once its bound columns are filled in');
    return budget(v.s);
  }
  /** a bound column as VB: its expression, or its aggregate (aggregateFunction + arguments, aggregateOn) */
  function binding(b, c, depth) {
    // in a crosstab a total cell's aggregate is the measure over the total's rows: the cell formula (the matrix totals it)
    const fn = c.cube ? '' : (prop(b, 'aggregateFunction') || '').toLowerCase();
    if (c.cube && prop(b, 'expression') == null) return vb(listProp(b, 'arguments').map(x => prop(x, 'value')).find(x => x != null) ?? '""', c, depth);
    const on = prop(b, 'aggregateOn') ?? simpleList(b, 'aggregateOn')[0]?.text;
    const gc = { ...c, group: on && on !== 'All' ? on : undefined };
    if (fn) {
      // the argument is the listed one, or (the usual case for SUM, AVE, MIN…) the column's own expression
      const arg = listProp(b, 'arguments').map(x => prop(x, 'value')).find(x => x != null) ?? prop(b, 'expression');
      if (arg == null && fn !== 'count') throw new Untranslatable(`the aggregate ${fn.toUpperCase()} with no expression`);
      const inner = arg != null ? vb(arg, { ...c, inSet: false }, depth) : '1';
      if (prop(b, 'filterExpr')) throw new Untranslatable(`the bound column "${prop(b, 'name')}", an aggregate with a filter`);
      // aggregateOn "All" (or none, BIRT's default) is the whole table or list, wherever the cell is: a grand total
      const all = gc.group ?? c.region;
      const scope = all ? `, "${String(all).replace(/"/g, '""')}"` : '';
      // BIRT's FIRST and LAST skip nulls (the last value there is)
      if (fn === 'first' || fn === 'last') return `AggregateIf(Not IsNothing(${inner}), "${AGG[fn]}", ${inner}${scope})`;
      if (AGG[fn]) return `${AGG[fn]}(${inner}${scope})`;
      if (RUNNING[fn]) return `RunningValue(${inner}, ${RUNNING[fn]}${scope})`;
      throw new Untranslatable(`the aggregate ${fn.toUpperCase()}`);
    }
    return vb(prop(b, 'expression') ?? '', gc, depth);
  }
  /** "=vb", or the source as text with a note on the item */
  function value(src, item, c) {
    const s = String(src ?? '').trim();
    const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(s) || /^'((?:[^'\\]|\\.)*)'$/.exec(s);
    if (lit) { const t = lit[1].replace(/\\(.)/g, '$1'); return t.startsWith('=') ? `="${t.replace(/"/g, '""')}"` : t; }
    try { return '=' + vb(s, c); } catch (e) {
      if (!(e instanceof Untranslatable)) throw e;
      (item.__exprs ||= []).push(s);
      (item.__notes ||= []).push(`${e.message} has no ReportWright equivalent, so the expression ${s.length > 200 ? s.slice(0, 200) + '…' : s} is shown as text.`);
      return s.startsWith('=') ? `="${s.replace(/"/g, '""')}"` : s;
    }
  }
  function setting(src, item, what, c) {
    try { return '=' + vb(src, c); } catch (e) {
      if (!(e instanceof Untranslatable)) throw e;
      (item.__exprs ||= []).push(String(src));
      (item.__notes ||= []).push(`${what} uses ${e.message}, which has no ReportWright equivalent, so it is left out.`);
      return undefined;
    }
  }

  /* ---------------------------------------------------------------- styles */

  const styles = new Map(kids(kid(root, 'styles'), 'style').map(s => [s.attrs.name, s]));
  const STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'backgroundColor', 'textAlign', 'verticalAlign', 'textUnderline', 'textLineThrough',
    'paddingTop', 'paddingLeft', 'paddingBottom', 'paddingRight', 'whiteSpace',
    ...['Top', 'Left', 'Bottom', 'Right'].flatMap(s => [`border${s}Style`, `border${s}Width`, `border${s}Color`])];
  /** a style or element's style properties, as a plain object */
  function ownStyle(e) {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of STYLE_KEYS) { const v = prop(e, k); if (v != null && v !== '') o[k] = v.trim(); }
    for (const [sname, key] of [['numberFormat', 'numFmt'], ['dateTimeFormat', 'dateFmt'], ['stringFormat', 'strFmt'], ['dateFormat', 'dateFmt']]) {
      const f = struct(e, sname);
      if (f) o[key] = { category: prop(f, 'category'), pattern: prop(f, 'pattern') };
    }
    const hl = listProp(e, 'highlightRules');
    if (hl.length) o.__hl = hl;
    return o;
  }
  const named = (n) => (n && styles.has(n) ? ownStyle(styles.get(n)) : {});
  /** inherited text properties (CSS inherits these; box properties do not inherit) */
  const INHERIT = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'textAlign', 'textUnderline', 'textLineThrough', 'whiteSpace']);
  const inherit = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => INHERIT.has(k)));
  /** an element's style: inherited ones, its predefined selector (label, data…), its named style, its own */
  const styleOf = (e, base, selector) => ({ ...inherit(base), ...named(selector), ...named(prop(e, 'style')), ...ownStyle(e) });
  const fontPt = (v) => (v == null ? undefined : FONT_SIZES[v] ?? (len(v, 10) || undefined));
  const genericFont = (f) => {
    const s = String(f).split(',')[0].trim().replace(/^["']|["']$/g, '');
    return /^(sans-serif|serif|cursive|fantasy)$/i.test(s) ? 'Inter' : /^monospace$/i.test(s) ? 'JetBrains Mono' : s;
  };
  /** A BIRT numberFormat / dateTimeFormat as a ReportWright format: "icu:<pattern>" or an ICU style; undefined: none. */
  function icuFormat0(f, kind) {
    if (!f || (!f.category && !f.pattern)) return undefined;
    const cat = f.category || 'Custom', p = f.pattern || '';
    if (kind === 'num') {
      if (cat === 'Unformatted' || p === 'Unformatted') return 'icu:';
      if (cat === 'General Number' || p === 'General Number') return 'icu:0.################'; // ICU's general number: no grouping, the shortest digits
      if (cat === 'Percent' && (!p || p === 'Percent')) return 'icu:0.00%';
      if (cat === 'Currency' && (!p || p === 'Currency')) return 'icu:¤#,##0.00';
      if (cat === 'Fixed' && (!p || p === 'Fixed')) return 'icu:#,##0.00';
      if (cat === 'Scientific' && (!p || p === 'Scientific')) return 'icu:0.00E00';
      return p ? `icu:${p}` : undefined;
    }
    const STYLE = { 'Short Date': '@date=short', 'Medium Date': '@date=medium', 'Long Date': '@date=long', 'General Date': '@date=long;time=long',
      'Medium Time': '@time=medium', 'Long Time': '@time=long', 'Short Time': 'kk:mm', Unformatted: '', D: '@date=long', u: 'yyyy.MM.dd HH:mm:ss Z' };
    const key = p && STYLE[p] !== undefined ? p : !p && STYLE[cat] !== undefined ? cat : null;
    if (key != null) return `icu:${STYLE[key]}`;
    return p ? `icu:${p}` : undefined;
  }
  /** a style value is a template: a pattern's braces ({RoundingMode=HALF_UP}) are doubled to stay text */
  const icuFormat = (f, kind) => { const v = icuFormat0(f, kind); return v && v.replace(/[{}]/g, '$&$&'); };
  /** an RDLX Style */
  function rdlxStyle(st, item, c, opt = {}) {
    /** @type {Record<string, any>} */
    const o = {};
    if (st.fontFamily) o.FontFamily = genericFont(st.fontFamily);
    const fs = fontPt(st.fontSize);
    if (fs) o.FontSize = pt(fs);
    if (st.fontWeight && /bold|[6-9]00/.test(st.fontWeight)) o.FontWeight = 'Bold';
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') o.FontStyle = 'Italic';
    if (st.textUnderline === 'underline') o.TextDecoration = 'Underline'; else if (st.textLineThrough === 'line-through') o.TextDecoration = 'LineThrough';
    if (st.color) o.Color = st.color;
    if (st.backgroundColor && !opt.noBackground) o.BackgroundColor = st.backgroundColor;
    if (st.textAlign) o.TextAlign = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' }[st.textAlign];
    if (st.verticalAlign) o.VerticalAlign = { top: 'Top', middle: 'Middle', bottom: 'Bottom' }[st.verticalAlign];
    for (const s of ['Top', 'Left', 'Bottom', 'Right']) {
      const p = st[`padding${s}`];
      if (p != null) o[`Padding${s}`] = pt(len(p, 0));
      const bs = st[`border${s}Style`];
      if (bs && bs !== 'none') o[`${s}Border`] = { Style: { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double' }[bs] || 'Solid', Width: pt(BORDER_W[st[`border${s}Width`]] ?? (len(st[`border${s}Width`], 0) || 0.75)), Color: st[`border${s}Color`] || '#000000' };
    }
    // BIRT formats with ICU4J: the pattern goes to the engine as "icu:…" (expr/javafmt.js); named styles as ICU's
    const fmt = icuFormat(st.numFmt, 'num') ?? icuFormat(st.dateFmt, 'date');
    if (fmt != null) o.Format = fmt;
    else if (opt.kind) o.Format = 'icu:'; // unformatted: BIRT prints 0.6666666666666666, true, "Mar 5, 2026 2:30 PM"
    if (!o.Format) delete o.Format;
    // highlight rules: colours and bold as IIF(test, …, …)
    for (const h of st.__hl || []) {
      const op = prop(h, 'operator') || 'eq';
      const test = prop(h, 'testExpr');
      const v1 = prop(h, 'value1') ?? simpleList(h, 'value1')[0]?.text;
      const v2 = prop(h, 'value2') ?? simpleList(h, 'value2')[0]?.text;
      if (!test) continue;
      let cond;
      try { cond = condition(op, vb(test, c), v1 != null ? vb(v1, c) : null, v2 != null ? vb(v2, c) : null); } catch (e) {
        if (!(e instanceof Untranslatable)) throw e;
        (item.__notes ||= []).push(`a highlight rule uses ${e.message}, so it is left out.`);
        continue;
      }
      const iif = (k, v, base) => { o[k] = `=IIF(${cond}, "${v}", ${base == null ? '""' : String(base).startsWith('=') ? String(base).slice(1) : `"${base}"`})`; };
      const hc = prop(h, 'color'), hb = prop(h, 'backgroundColor'), hw = prop(h, 'fontWeight');
      if (hc) iif('Color', hc, o.Color ?? '#000000');
      if (hb) iif('BackgroundColor', hb, o.BackgroundColor ?? 'Transparent');
      if (hw) iif('FontWeight', /bold|[6-9]00/.test(hw) ? 'Bold' : 'Normal', o.FontWeight ?? 'Normal');
    }
    return o;
  }
  /** a BIRT filter/highlight operator as a VB condition */
  function condition(op, x, a, b) {
    const C = { eq: '=', ne: '<>', lt: '<', le: '<=', gt: '>', ge: '>=' };
    if (C[op]) return `(${x}) ${C[op]} (${a})`;
    if (op === 'between') return `(${x}) >= (${a}) AndAlso (${x}) <= (${b})`;
    if (op === 'not-between') return `(${x}) < (${a}) OrElse (${x}) > (${b})`;
    if (op === 'is-null') return `IsNothing(${x})`;
    if (op === 'is-not-null') return `Not IsNothing(${x})`;
    if (op === 'is-true') return `(${x}) = True`;
    if (op === 'is-false') return `(${x}) = False`;
    throw new Untranslatable(`the operator "${op}"`);
  }

  /* ---------------------------------------------------------------- items */

  let seq = 0;
  const NAME_OK = /^[A-Za-z_][\w]{0,60}$/;
  const nameFor = (e, kind) => (e.attrs.name && NAME_OK.test(e.attrs.name) ? e.attrs.name : `${kind}${++seq}`);
  const ITEM_KINDS = new Set(['label', 'data', 'text', 'text-data', 'auto-text', 'image', 'grid', 'table', 'list', 'extended-item', 'line', 'free-form', 'template-report-item', 'multi-line-data']);
  /** the estimated height of a text in points: its lines at its font size */
  const textH = (text, st) => { const fs = fontPt(st.fontSize) || 10; return Math.max(1, String(text || '').split('\n').length) * fs * 1.25 + 2; }; // BIRT: an 8pt line fits a 12pt row
  /** strip HTML to text (BIRT text items are often HTML); <value-of> parts are expressions */
  function htmlParts(html) {
    /** @type {{ t?: string, e?: string }[]} */
    const parts = [];
    const re = /<value-of[^>]*>([\s\S]*?)<\/value-of>/gi;
    let at = 0, m;
    while ((m = re.exec(html))) { parts.push({ t: html.slice(at, m.index) }, { e: m[1] }); at = re.lastIndex; }
    parts.push({ t: html.slice(at) });
    const out = parts.map(p => (p.t == null ? p : { t: decodeHtml(p.t, false) }));
    if (out[0].t != null) out[0].t = out[0].t.trimStart();
    const last = out[out.length - 1];
    if (last.t != null) last.t = last.t.trimEnd();
    return out;
  }
  function decodeHtml(s, trim = true) {
    return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n)))).replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')[trim ? 'trim' : 'toString']();
  }

  /**
   * Items stacked top to bottom (BIRT's flow layout) in a box `w` wide.
   * @param {any[]} els @param {number} w @param {Record<string, any>} base inherited style @param {Ctx} c @param {number} depth
   * @returns {{ items: any[], h: number }}
   */
  function flow(els, w, base, c, depth) {
    const out = [];
    let y = 0;
    for (const e of els) {
      if (!ITEM_KINDS.has(e.name)) continue;
      const r = item(e, w, base, c, depth);
      if (!r) continue;
      r.it.Top = pt(y + (r.dy || 0));
      out.push(r.it);
      y += r.h + (r.dy || 0);
    }
    return { items: out, h: y };
  }

  /**
   * One report item. @returns {{ it: any, h: number, dy?: number } | null}
   * @param {any} e @param {number} W the width of its container @param {Record<string, any>} base @param {Ctx} c @param {number} depth
   */
  function item(e, W, base, c, depth) {
    const st = styleOf(e, base, e.name === 'text-data' ? 'text' : e.name);
    const w = Math.min(W, len(prop(e, 'width'), W, W)) || W;
    const given = len(prop(e, 'height'), 0, 0);
    const x = len(prop(e, 'x'), W, 0);
    /** @type {Record<string, any>} */
    const it = { __pos: e.pos, Name: nameFor(e, e.name.replace(/(^|-)(\w)/g, (_, __, ch) => ch.toUpperCase())), Left: pt(x), Width: pt(w) };
    const vis = listProp(e, 'visibility')[0];
    if (vis) { const ve = prop(vis, 'valueExpr'); if (ve && ve.trim() === 'true') it.Visibility = { Hidden: true }; else if (ve) { const v = setting(ve, it, 'the condition that hides it', c); if (v) it.Visibility = { Hidden: v }; } }
    const bm = prop(e, 'bookmark') ?? prop(struct(e, 'toc'), 'expressionValue');
    const link = () => {
      const act = struct(e, 'action');
      if (!act) return;
      const type = prop(act, 'linkType');
      if (type === 'hyperlink') { const u = prop(act, 'uri'); if (u) it.Action = { Hyperlink: value(u, it, c) }; }
      else if (type === 'drill-through') {
        const rep = prop(act, 'reportName');
        if (rep) it.Action = { Drillthrough: { ReportName: rep, Parameters: listProp(act, 'paramBindings').map(p => ({ ParameterName: prop(p, 'paramName'), Value: value(prop(p, 'expression') ?? '', it, c) })).filter(p => p.ParameterName) } };
      } else if (type === 'bookmark-link') { const t = prop(act, 'targetBookmark'); if (t) it.Action = { BookmarkLink: value(t, it, c) }; }
    };
    if (bm) it.Bookmark = value(bm, it, c);
    let kindHint = null; // a data item's value type, for BIRT's unformatted display
    const textItem = (v, h) => {
      it.Type = 'textbox'; it.Value = v; it.CanGrow = true; it.Height = pt(h); it.Style = rdlxStyle(st, it, c, { kind: kindHint });
      link();
      return { it, h };
    };
    switch (e.name) {
      case 'label': {
        const t = prop(e, 'text') ?? '';
        if (prop(e, 'textID')) note('Some texts are looked up in resource files (textID); the default text is used.');
        return textItem(t.startsWith('=') ? `="${t.replace(/"/g, '""')}"` : t, given || textH(t, st));
      }
      case 'data': case 'multi-line-data': {
        const col = prop(e, 'resultSetColumn');
        const ve = prop(e, 'valueExpr');
        let v;
        const b0 = col != null ? c.bindings?.get(col) : null;
        const dt = String((b0 && prop(b0, 'dataType')) || '').toLowerCase();
        // BIRT prints an unformatted float as its shortest digits (0.6666666666666666), a boolean as true/false
        if (/^(float|decimal|double|boolean|date-time|date|time)$/.test(dt) || (b0 && prop(b0, 'aggregateFunction') && !/count/i.test(prop(b0, 'aggregateFunction')))) kindHint = dt || 'float';
        if (col != null) {
          const b = c.bindings?.get(col);
          if (b) {
            try { v = '=' + binding(b, c, 0); } catch (er) { if (!(er instanceof Untranslatable)) throw er; (it.__exprs ||= []).push(String(prop(b, 'expression') ?? col)); (it.__notes ||= []).push(`its column "${col}" uses ${er.message}, so it is shown as text.`); v = col; }
          } else v = `=${fieldRef(col).s}`;
        } else v = value(ve ?? '', it, c);
        return textItem(v, given || textH('', st));
      }
      case 'text': case 'text-data': {
        if (e.name === 'text-data') {
          const ve = prop(e, 'valueExpr') ?? '';
          if ((prop(e, 'contentType') || 'html') === 'html') (it.__notes ||= []).push('its value is HTML in BIRT; ReportWright shows it as text.');
          return textItem(value(ve, it, c), given || textH('', st));
        }
        const content = prop(e, 'content') ?? '';
        const type = prop(e, 'contentType') || 'auto';
        const html = type === 'html' || (type === 'auto' && /<[a-z!/][^>]*>/i.test(content));
        const parts = html ? htmlParts(content) : [{ t: content }];
        let v;
        if (parts.some(p => p.e != null)) {
          const pieces = [];
          for (const p of parts) {
            if (p.t) pieces.push(`"${p.t.replace(/"/g, '""').replace(/\r?\n/g, '" & vbCrLf & "')}"`);
            else if (p.e != null) { try { pieces.push(`(${vb(decodeHtml(p.e), c)})`); } catch (er) { if (!(er instanceof Untranslatable)) throw er; (it.__exprs ||= []).push(decodeHtml(p.e)); (it.__notes ||= []).push(`a <value-of> uses ${er.message}, so it is left out.`); } }
          }
          v = `=${pieces.join(' & ') || '""'}`;
        } else v = parts.map(p => p.t).join('');
        if (typeof v === 'string' && !v.startsWith('=') && v.startsWith('=')) v = `="${v}"`;
        if (html && /<(table|img|ul|ol)\b/i.test(content)) (it.__notes ||= []).push('its HTML has tables, images or lists; ReportWright keeps the text only.');
        return textItem(v, given || textH(parts.map(p => p.t ?? 'x').join(''), st));
      }
      case 'auto-text': {
        const t = prop(e, 'type') || 'page-number';
        const v = t === 'total-page' || t === 'unfiltered-total-page' ? '=Globals!TotalPages' : t === 'page-number-of-total-page' ? '=Globals!PageNumber & " of " & Globals!TotalPages' : t === 'page-variable' ? '' : '=Globals!PageNumber';
        if (t === 'page-variable') (it.__notes ||= []).push('it shows a page variable, which ReportWright does not have.');
        return textItem(v, given || textH('1', st));
      }
      case 'image': {
        it.Type = 'image';
        const src = prop(e, 'source') || 'url';
        const h = given || len('1in', 0);
        it.Height = pt(h);
        if (!prop(e, 'width')) it.Width = pt(Math.min(W, 72));
        if (src === 'embed') { it.Source = 'Embedded'; it.Value = prop(e, 'imageName') ?? ''; }
        else if (src === 'url') { it.Source = 'External'; it.Value = value(prop(e, 'uri') ?? '', it, c); }
        else if (src === 'expr') { it.Source = 'Database'; it.Value = value(prop(e, 'valueExpr') ?? '', it, c); }
        else { it.Source = 'External'; it.Value = value(prop(e, 'uri') ?? '', it, c); (it.__notes ||= []).push('its image is a file on the BIRT server; give it a URL.'); }
        it.Sizing = 'FitProportional';
        it.Style = rdlxStyle(st, it, c);
        link();
        return { it, h };
      }
      case 'grid': {
        if (depth >= MAX_DEPTH) { it.Type = 'rectangle'; it.Height = '0pt'; it.__drop = `grids are nested more than ${MAX_DEPTH} deep, so this one was left out.`; return { it, h: 0 }; }
        return { it: grid(e, it, w, st, c, depth), h: parseFloat(it.Height) };
      }
      case 'table': {
        if (depth >= MAX_DEPTH) { it.Type = 'table'; it.Height = '0pt'; it.__drop = `tables are nested more than ${MAX_DEPTH} deep, so this one was left out.`; return { it, h: 0 }; }
        return { it: table(e, it, w, st, c, depth), h: parseFloat(it.Height) };
      }
      case 'list': {
        if (depth >= MAX_DEPTH) { it.Type = 'list'; it.Height = '0pt'; it.__drop = `lists are nested more than ${MAX_DEPTH} deep, so this one was left out.`; return { it, h: 0 }; }
        return { it: list(e, it, w, st, c, depth), h: parseFloat(it.Height) };
      }
      case 'line':
        it.Type = 'line'; it.Height = '0pt';
        it.LineColor = st.color || '#000000';
        return { it, h: 2, dy: 1 };
      case 'extended-item': {
        const ext = e.attrs.extensionName || '?';
        it.Type = ext.toLowerCase();
        it.Height = pt(given || 144);
        if (ext === 'Crosstab') return crosstab(e, it, w, st, c, depth);
        if (ext === 'Chart') { chart(e, it, c); return { it, h: given || 144 }; }
        it.__drop = `the BIRT item "${ext}" has no ReportWright equivalent, so it was left out.`;
        return { it, h: given || 144 };
      }
    }
    it.Type = e.name;
    it.Height = '0pt';
    it.__drop = `the BIRT item "${e.name}" is not supported, so it was left out.`;
    return { it, h: 0 };
  }

  /* ---------------------------------------------------------------- charts */

  // the chart model is XML inside the design (bounded by the same reader); these cap what one file can emit
  const MAX_CHARTS = 500, MAX_SERIES = 32;
  const CHART_TYPE = { 'Bar Chart': 'column', 'Tube Chart': 'column', 'Cone Chart': 'column', 'Pyramid Chart': 'column', 'Line Chart': 'line',
    'Area Chart': 'area', 'Pie Chart': 'pie', 'Scatter Chart': 'scatter', 'Bubble Chart': 'bubble', 'Stock Chart': 'candlestick', 'Radar Chart': 'radar', 'Meter Chart': 'gauge' };
  const SERIES_TYPE = { BarSeries: 'column', LineSeries: 'line', AreaSeries: 'area', ScatterSeries: 'scatter' };
  const CHART_AGG = { sum: 'Sum', count: 'Count', distinctcount: 'CountDistinct', average: 'Avg', ave: 'Avg', mean: 'Avg', min: 'Min', max: 'Max', first: 'First', last: 'Last' };
  /**
   * A BIRT chart (extended item "Chart": its chart model in xmlRepresentation) → a ReportWright chart, placed by
   * placeCharts (jrxml.js) like a Jasper chart. Category: the base axis series; values: the orthogonal series, each
   * aggregated as its grouping says (Sum by default); a non-empty series query groups the series by it.
   */
  function chart(e, it, c) {
    it.Type = 'rectangle'; it.ReportItems = [];
    const notes = (it.__notes ||= []);
    if (charts.size >= MAX_CHARTS) { it.__drop = `the report has more than ${MAX_CHARTS} charts; the rest are left out.`; return; }
    const xmlText = e.children.find(x => x.name === 'xml-property' && x.attrs.name === 'xmlRepresentation')?.text;
    let m;
    try { m = parseXml(String(xmlText ?? '')); } catch (er) { it.__drop = `its chart model could not be read (${er instanceof Error ? er.message : er}), so it was left out.`; return; }
    const ctype = (kid(m, 'Type')?.text || '').trim(), sub = (kid(m, 'SubType')?.text || '').trim();
    const pwType = CHART_TYPE[ctype];
    if (!pwType) { it.__drop = `a BIRT ${ctype || 'unknown'} chart has no ReportWright equivalent, so it was left out.`; return; }
    const txt = (x) => (x?.text ?? '').trim();
    const shown = (x) => x && txt(kid(x, 'Visible')) !== 'false';
    const caption = (t) => (shown(t) ? txt(kid(kid(t, 'Caption'), 'Value')) : '');
    const blocks = kids(kid(m, 'Block'), 'Children');
    const titleBlock = blocks.find(b => b.attrs.type === 'layout:TitleBlock'), legend = blocks.find(b => b.attrs.type === 'layout:Legend');
    const own = bindingsOf(e);
    const cc = { bindings: own.size ? own : c.bindings, dataSet: prop(e, 'dataSet') || c.dataSet };
    const key = `pwchart§${charts.size + 1}`;
    const chartName = it.Name;
    it.Name = key;
    const conv = (src, what) => {
      try { const r = translateExpression(`=${vb(src, cc)}`, {}); if (!r.ok) throw new Untranslatable(what); return r.value; } catch (er) {
        if (!(er instanceof Untranslatable)) throw er;
        notes.push(`the chart's ${what} uses ${er.message}, so it is left out.`);
        return undefined;
      }
    };
    /** @type {Record<string, any>} */
    const out = { type: 'chart', name: chartName, chartType: pwType, series: [], legend: shown(legend) ? 'bottom' : 'none' };
    if (cc.dataSet) out.dataSet = cc.dataSet; else notes.push('the chart has no data set in BIRT.');
    if (titleBlock && shown(titleBlock)) { const t = txt(kid(kid(kid(titleBlock, 'Label'), 'Caption'), 'Value')); if (t) out.title = t; }
    if (/stacked/i.test(sub)) out.stacked = true;
    if (/percent/i.test(sub)) notes.push('it is a percent-stacked chart in BIRT; here the stacks show the values.');
    if (txt(kid(m, 'Transposed')) === 'true' && pwType === 'column') out.chartType = 'bar';
    if (txt(kid(m, 'Dimension')) && txt(kid(m, 'Dimension')) !== 'Two_Dimensional') notes.push('it is a 3D chart in BIRT; ReportWright draws it flat.');
    if (/Tube|Cone|Pyramid/.test(ctype)) notes.push(`its ${ctype.toLowerCase()} risers are drawn as columns.`);
    // the base series definitions (category) and, inside them or on the value axes, the orthogonal ones (values)
    const baseAxis = kid(m, 'Axes');
    const baseDefs = baseAxis ? kids(baseAxis, 'SeriesDefinitions') : kids(m, 'SeriesDefinitions');
    const valueDefs = baseAxis ? kids(baseAxis, 'AssociatedAxes').flatMap(a => kids(a, 'SeriesDefinitions')) : baseDefs.flatMap(d => kids(d, 'SeriesDefinitions'));
    const defOf = (sr) => txt(kid(kid(sr, 'DataDefinition'), 'Definition'));
    const catSrc = baseDefs.map(d => defOf(kid(d, 'Series'))).find(Boolean);
    if (catSrc) {
      const cat = conv(catSrc, 'category');
      if (cat !== undefined) { if (pwType === 'scatter' || pwType === 'bubble') out.xValue = cat; else out.category = cat; }
    } else notes.push('it has no category expression.');
    if (baseDefs[0] && txt(kid(kid(baseDefs[0], 'Grouping'), 'Enabled')) === 'false' && pwType !== 'scatter' && pwType !== 'bubble') notes.push('each row is a point in BIRT (category grouping off); here rows with the same category are aggregated.');
    if (baseAxis) {
      const xt = caption(kid(baseAxis, 'Title'));
      const yt = kids(baseAxis, 'AssociatedAxes').map(a => caption(kid(a, 'Title'))).find(Boolean);
      if (xt || yt) out.axes = { ...(xt ? { x: { title: xt } } : {}), ...(yt ? { y: { title: yt } } : {}) };
    }
    const types = new Set();
    let skipped = 0;
    for (const d of valueDefs) {
      const q = txt(kid(kid(d, 'Query'), 'Definition'));
      if (q && out.seriesGroup === undefined) out.seriesGroup = conv(q, 'series grouping');
      const agg = txt(kid(kid(d, 'Grouping'), 'AggregateExpression')).toLowerCase();
      for (const sr of kids(d, 'Series')) {
        if (out.series.length >= MAX_SERIES) { skipped++; continue; }
        const src = defOf(sr);
        if (!src) continue;
        const a = txt(kid(kid(kid(sr, 'DataDefinition'), 'Grouping'), 'AggregateExpression')).toLowerCase() || agg || 'sum';
        const fn = CHART_AGG[a];
        if (!fn) notes.push(`a series aggregates with ${a}, which is read as Sum.`);
        let v;
        try { const raw = vb(src, cc); const r = translateExpression(`=${/\b(Sum|Count|CountDistinct|Avg|Min|Max|First|Last)\(/.test(raw) ? raw : `${fn || 'Sum'}(${raw})`}`, {}); v = r.ok ? r.value : undefined; if (!r.ok) notes.push('a series value could not be translated, so that series is left out.'); }
        catch (er) { if (!(er instanceof Untranslatable)) throw er; notes.push(`a series value uses ${er.message}, so that series is left out.`); }
        if (v === undefined) continue;
        const st = SERIES_TYPE[String(sr.attrs.type || '').replace(/^type:/, '')];
        if (st) types.add(st);
        const name = txt(kid(sr, 'SeriesIdentifier')) || `Series${out.series.length + 1}`;
        out.series.push({ name, value: v, ...(st && st !== pwType ? { type: st } : {}) });
      }
    }
    if (skipped) notes.push(`it has more than ${MAX_SERIES} series; ${skipped} are left out.`);
    if (types.size > 1) notes.push('it combines series types; each series keeps its own type.');
    if (out.seriesGroup !== undefined && out.series.length !== 1) { delete out.seriesGroup; notes.push('its series are grouped by a query and it has more than one value series; the grouping is left out.'); }
    if (!out.series.length) notes.push('no series of the chart could be converted, so it is empty.');
    if (pwType === 'candlestick') notes.push('its stock values are read as one series; check the chart.');
    if (pwType === 'gauge') notes.push('its dial is drawn as a half-circle gauge from the first value.');
    charts.set(key, out);
  }

  /* ---------------------------------------------------------------- crosstabs */

  const cubes = new Map();
  walkAll(root, (e) => { if (e.name === 'tabular-cube' && e.attrs.name) cubes.set(e.attrs.name, e); });
  /** a <property name="…"> that holds elements (the crosstab's slots), and the extended items in it */
  const slot = (e, name) => e?.children.find(x => x.name === 'property' && x.attrs.name === name);
  const ext = (e, name, kind) => kids(slot(e, name), 'extended-item').filter(x => !kind || x.attrs.extensionName === kind);
  const DATE_LEVEL = { year: (f) => `Year(${f})`, quarter: (f) => `Floor((Month(${f}) + 2) / 3)`, month: (f) => `Month(${f})`, 'day-of-month': (f) => `Day(${f})` };
  /**
   * A BIRT crosstab becomes a tablix with column groups (rdlx.js: a ReportWright matrix). The cube's levels are the
   * groups (a date level is its part of the date), its measures the values; in the cells dimension["D"]["L"] is the
   * level's value and measure["m"] the measure's aggregate.
   */
  function crosstab(e, it, W, st, c, depth) {
    const notes = (it.__notes ||= []);
    const cubeName = prop(e, 'cube'), cube = cubes.get(cubeName);
    if (!cube) { it.Type = 'crosstab'; it.Height = pt(len(prop(e, 'height'), 0, 0)); it.__drop = `its cube "${cubeName}" is not in the file, so the crosstab was left out.`; return { it, h: 0 }; }
    const ds = prop(cube, 'dataSet') || c.dataSet;
    const levels = new Map(), measures = new Map();
    walkAll(cube, (x) => {
      if (x.name === 'tabular-measure') measures.set(x.attrs.name, x);
      if (x.name === 'tabular-dimension') walkAll(x, (l) => { if (l.name === 'tabular-level') levels.set(`${x.attrs.name}/${l.attrs.name}`, l); });
    });
    const levelVb = (key) => {
      const l = levels.get(key);
      if (!l) throw new Untranslatable(`the level ${key}, which is not in the cube`);
      const col = prop(l, 'columnName');
      const f = col ? fieldRef(col).s : vb(prop(l, 'expression') ?? '', { inSet: true });
      const dt = prop(l, 'dateTimeLevelType');
      if (dt && !DATE_LEVEL[dt]) throw new Untranslatable(`the ${dt} date level`);
      return dt ? DATE_LEVEL[dt](f) : f;
    };
    const measureVb = (name) => {
      const m = measures.get(name);
      if (!m) throw new Untranslatable(`the measure ${name}, which is not in the cube`);
      const fn = (prop(m, 'function') || 'sum').toLowerCase();
      if (!AGG[fn]) throw new Untranslatable(`the ${fn.toUpperCase()} measure function`);
      return `${AGG[fn]}(${vb(prop(m, 'measureExpression') ?? '1', { inSet: true })})`;
    };
    const cc = { bindings: bindingsOf(e), dataSet: ds, region: it.Name,
      cube: { level: (d, l) => ({ s: `(${levelVb(`${d}/${l}`)})`, t: 'any', p: 9 }), measure: (m) => ({ s: measureVb(m), t: 'num', p: 9 }) } };
    let extra = 0;
    /** the first text item of a cell (the rest are counted as not shown), with the cell's background */
    const text = (cell) => {
      if (!cell) return undefined;
      const cst = { ...inherit(st), ...ownStyle(cell) };
      const els = kids(slot(cell, 'content')).filter(x => ITEM_KINDS.has(x.name));
      const all = els.map(x => item(x, W, cst, cc, depth + 1)?.it).filter(Boolean);
      const t = all.filter(i => i.Type === 'textbox');
      extra += all.length - Math.min(1, t.length);
      if (t[0] && cst.backgroundColor && (!t[0].Style?.BackgroundColor || t[0].Style.BackgroundColor === 'Transparent')) (t[0].Style ||= {}).BackgroundColor = cst.backgroundColor;
      return t[0];
    };
    const axis = (which) => {
      const view = ext(e, which, 'CrosstabView')[0];
      const lvs = ext(view, 'views', 'DimensionView').flatMap(d => ext(d, 'levels', 'LevelView')).slice(0, 9); // the helper keeps 8 and notes the rest
      const grand = ext(view, 'grandTotal')[0];
      return lvs.map((lv, i) => {
        const key = prop(lv, 'level') || '';
        let k;
        try { k = '=' + levelVb(key); } catch (er) { if (!(er instanceof Untranslatable)) throw er; notes.push(`the level "${key}" uses ${er.message}, so its rows are not split by it (one group).`); }
        const sortDir = prop(lv, 'sortType') || listProp(lv, 'sort').map(x => prop(x, 'direction'))[0];
        const sub = i > 0 ? ext(lvs[i - 1], 'aggregationHeader')[0] : null;
        const tc = i === 0 ? grand : sub;
        const loc = i === 0 ? prop(view, 'grandTotalLocation') : prop(lvs[i - 1], 'aggregationHeaderLocation');
        return { name: key.replace(/[^\w]/g, '_'), key: k, desc: /desc/i.test(sortDir || ''), size: pt(len(prop(lv, which === 'rows' ? 'width' : 'height'), 0, which === 'rows' ? 80 : 20) || (which === 'rows' ? 80 : 20)),
          header: text(ext(lv, 'member')[0]), total: tc ? (loc === 'before' ? 'before' : 'after') : null, totalHeader: tc ? text(tc) : undefined };
      });
    };
    const rows = axis('rows'), columns = axis('columns');
    const mviews = ext(e, 'measures', 'MeasureView').slice(0, 17); // the helper keeps 16 and notes the rest
    const values = mviews.map(mv => ({ label: prop(mv, 'measure') || 'Value', cell: text(ext(mv, 'detail')[0]), total: text(ext(mv, 'aggregations')[0]) }));
    if (!values.length || !values.some(v => v.cell)) { it.Type = 'crosstab'; it.Height = pt(len(prop(e, 'height'), 0, 0)); it.__drop = 'the crosstab has no measure, so it was left out.'; return { it, h: 0 }; }
    for (const v of values) if (!v.cell) v.cell = { Type: 'textbox', Value: '' };
    if (extra) notes.push(`${extra} other items in its cells are not shown: a ReportWright matrix shows group headers, values and totals.`);
    if (ext(e, 'measures', 'ComputedMeasureView').length) notes.push('its computed measures are left out.');
    const w = len(prop(e, 'width'), W, W) || W;
    const tx = crosstabTablix({
      name: it.Name, dataSet: ds, repeatHeaders: prop(e, 'repeatColumnHeader') !== 'false',
      rowHeight: pt(20), columnWidth: pt(72), rows, columns,
      values: values.map(v => ({ label: v.label })),
      cell: (r, cl, k) => ((r || cl) && values[k].total) || values[k].cell,
      corner: text(ext(e, 'header')[0]),
    });
    Object.assign(it, tx, { Width: pt(w), __notes: [...notes, ...tx.__notes] });
    const h = 20 * (columns.length + 3);
    it.Height = pt(h);
    return { it, h };
  }

  /** a cell's items: one text item as the cell's own (a table cell is text), else a rectangle that stacks them */
  function cellItems(cell, w, base, c, depth) {
    const st = { ...inherit(base), ...named(prop(cell, 'style')), ...ownStyle(cell) };
    const f = flow(cell.children, w, st, c, depth + 1);
    const box = rdlxStyle(st, {}, c);
    return { st, f, box, h: Math.max(f.h, len(prop(cell, 'height'), 0, 0)) };
  }
  /** columns' widths (points) of a grid or table `W` wide */
  function columns(e, W) {
    const cols = kids(e, 'column');
    const expanded = cols.flatMap(col => Array.from({ length: Math.max(1, Math.min(50, Number(prop(col, 'repeat')) || 1)) }, () => col));
    const given = expanded.map(col => (prop(col, 'width') ? len(prop(col, 'width'), W, 0) : null));
    const used = given.reduce((s, v) => s + (v || 0), 0);
    const free = given.filter(v => v == null).length;
    return given.map(v => (v == null ? Math.max(18, (W - used) / Math.max(1, free)) : v));
  }
  /** a grid: a rectangle with each cell's items at its column and row */
  function grid(e, it, W, st, c, depth) {
    it.Type = 'rectangle';
    const cw = columns(e, W);
    const items = [];
    let y = 0;
    for (const row of kids(e, 'row')) {
      const rst = { ...inherit(st), ...named(prop(row, 'style')), ...ownStyle(row) };
      let x = 0, rowH = len(prop(row, 'height'), 0, 0), col = 0;
      const placed = [];
      for (const cell of kids(row, 'cell')) {
        const span = Math.max(1, Number(prop(cell, 'colSpan')) || 1);
        const ci = Math.max(0, Number(prop(cell, 'column')) - 1 || col);
        const x0 = cw.slice(0, ci).reduce((s, v) => s + v, 0);
        const w = cw.slice(ci, ci + span).reduce((s, v) => s + v, 0) || cw[ci] || 72;
        const r = cellItems(cell, w, rst, c, depth);
        placed.push({ x0, w, r });
        rowH = Math.max(rowH, r.h);
        col = ci + span;
        x = x0 + w;
      }
      void x;
      for (const { x0, w, r } of placed) {
        const deco = r.box.BackgroundColor || ['Top', 'Left', 'Bottom', 'Right'].some(s => r.box[`${s}Border`]);
        if (deco || r.f.items.length > 1) {
          items.push({ Type: 'rectangle', Name: `Cell${++seq}`, Left: pt(x0), Top: pt(y), Width: pt(w), Height: pt(rowH), ReportItems: r.f.items, Style: r.box });
        } else for (const i of r.f.items) items.push({ ...i, Left: pt(x0 + (parseFloat(i.Left) || 0)), Top: pt(y + (parseFloat(i.Top) || 0)) });
      }
      if (rst.backgroundColor && !placed.length) void 0;
      y += rowH;
    }
    it.ReportItems = items;
    it.Height = pt(Math.max(y, len(prop(e, 'height'), 0, 0)));
    it.Style = rdlxStyle(st, it, c);
    return it;
  }

  /** bound columns of a table or list, by name */
  const bindingsOf = (e) => new Map(listProp(e, 'boundDataColumns').map(b => [prop(b, 'name'), b]).filter(([k]) => k != null));
  /** sorts and filters of a table, list or group */
  function sortsOf(e, it, c) {
    return listProp(e, 'sort').map(s => {
      const key = prop(s, 'key');
      const v = key && setting(key, it, 'a sort', c);
      return v ? { Value: v, Direction: /desc/i.test(prop(s, 'direction') || '') ? 'Descending' : 'Ascending' } : null;
    }).filter(Boolean);
  }
  const FILTER_OPS = { eq: 'Equal', ne: 'NotEqual', lt: 'LessThan', le: 'LessThanOrEqual', gt: 'GreaterThan', ge: 'GreaterThanOrEqual', like: 'Like', between: 'Between', in: 'In', 'top-n': 'TopN', 'bottom-n': 'BottomN', 'top-percent': 'TopPercent', 'bottom-percent': 'BottomPercent' };
  function filtersOf(e, it, c) {
    const out = [];
    for (const f of listProp(e, 'filter')) {
      const op = prop(f, 'operator') || 'eq';
      const ex = prop(f, 'expr');
      if (!ex) continue;
      const vals = [prop(f, 'value1') ?? simpleList(f, 'value1').map(v => v.text), prop(f, 'value2')].flat().filter(v => v != null);
      try {
        if (FILTER_OPS[op]) out.push({ FilterExpression: '=' + vb(ex, c), Operator: FILTER_OPS[op], FilterValues: vals.map(v => '=' + vb(v, c)) });
        else out.push({ FilterExpression: '=' + condition(op, vb(ex, c), null, null), Operator: 'Equal', FilterValues: ['=True'] });
      } catch (er) { if (!(er instanceof Untranslatable)) throw er; (it.__notes ||= []).push(`a filter uses ${er.message}, so it is left out.`); }
    }
    return out;
  }
  /** a table: an RDLX table with header, groups, detail and footer rows */
  function table(e, it, W, st, c, depth) {
    it.Type = 'table';
    const ds = prop(e, 'dataSet') || c.dataSet;
    if (!prop(e, 'dataSet') && !c.dataSet) (it.__notes ||= []).push('it has no data set in BIRT.');
    if (ds) it.DataSetName = ds;
    const cc = { bindings: bindingsOf(e), outer: c.bindings ? c : undefined, dataSet: ds, region: it.Name };
    const cw = columns(e, W);
    it.TableColumns = cw.map(w => ({ Width: pt(w) }));
    let total = 0;
    const tst = { ...inherit(st) };
    const rows = (slot, sel, gc) => (slot ? kids(slot, 'row').map(row => {
      const rst = { ...tst, ...named(sel), ...named(prop(row, 'style')), ...ownStyle(row) };
      let rowH = len(prop(row, 'height'), 0, 0);
      const cells = kids(row, 'cell').map((cell, k) => {
        const span = Math.max(1, Number(prop(cell, 'colSpan')) || 1);
        const ci = Math.max(0, (Number(prop(cell, 'column')) || k + 1) - 1);
        const w = cw.slice(ci, ci + span).reduce((s, v) => s + v, 0) || 72;
        const r = cellItems(cell, w, rst, gc, depth);
        rowH = Math.max(rowH, r.h);
        /** @type {Record<string, any>} */
        const out = {};
        if (span > 1) out.ColSpan = span;
        if (Number(prop(cell, 'rowSpan')) > 1) out.RowSpan = Number(prop(cell, 'rowSpan'));
        const items = r.f.items;
        const rowBox = rdlxStyle(rst, {}, gc);
        if (items.length === 1 && items[0].Type === 'textbox') out.Item = { ...items[0], Left: '0pt', Top: '0pt', Style: { ...pick(rowBox), ...r.box, ...items[0].Style } };
        else if (items.length) out.Item = { Type: 'rectangle', Name: `Cell${++seq}`, Left: '0pt', Top: '0pt', Width: pt(w), Height: pt(r.h), ReportItems: items, Style: { ...pick(rowBox), ...r.box } };
        else out.Item = { Type: 'textbox', Name: `Cell${++seq}`, Value: '', Style: { ...pick(rowBox), ...r.box } };
        return out;
      });
      rowH = rowH || 18;
      total += rowH;
      return { Height: pt(rowH), TableCells: cells };
    }) : []);
    const head = kid(e, 'header'), foot = kid(e, 'footer'), det = kid(e, 'detail');
    it.Header = { TableRows: rows(head, 'table-header', cc), ...(prop(e, 'repeatHeader') !== 'false' ? { RepeatOnNewPage: true } : {}) };
    it.TableGroups = kids(e, 'group').map((g, i) => {
      const gname = prop(g, 'groupName') || `Group${i + 1}`;
      const gc = { ...cc, group: gname };
      /** @type {Record<string, any>} */
      const G = { Group: { Name: gname, GroupExpressions: [] } };
      const key = prop(g, 'keyExpr');
      const k = key && setting(key, it, `The group "${gname}"`, cc);
      if (k) G.Group.GroupExpressions.push(k);
      if ((prop(g, 'interval') || 'none') !== 'none') (it.__notes ||= []).push(`the group "${gname}" groups by ${prop(g, 'interval')} intervals in BIRT; ReportWright groups by the value.`);
      const dir = prop(g, 'sortDirection');
      if (k && dir) G.SortExpressions = [{ Value: k, Direction: dir === 'desc' ? 'Descending' : 'Ascending' }];
      if (/always/.test(prop(g, 'pageBreakBefore') || '') || /always/.test(prop(g, 'pageBreakAfter') || '')) G.Group.PageBreak = { BreakLocation: 'Between' };
      G.Header = { TableRows: rows(kid(g, 'header'), `table-group-header-${i + 1}`, gc), ...(prop(g, 'repeatHeader') === 'true' ? { RepeatOnNewPage: true } : {}) };
      G.Footer = { TableRows: rows(kid(g, 'footer'), `table-group-footer-${i + 1}`, gc) };
      if (prop(g, 'hideDetail') === 'true') (it.__notes ||= []).push(`the group "${gname}" hides its detail rows in BIRT; ReportWright shows them.`);
      return G;
    });
    it.Details = { TableRows: rows(det, 'table-detail', cc) };
    // pageBreakInterval: a new page every N detail rows; unset is BIRT's default of 40 (ground truth), 0 is none
    const pbi = prop(e, 'pageBreakInterval');
    PAGE_BREAKS.set(it.Name, pbi == null ? 40 : Math.max(0, Math.trunc(Number(pbi)) || 0));
    it.Footer = { TableRows: rows(foot, 'table-footer', cc) };
    const sorts = sortsOf(e, it, cc);
    if (sorts.length) it.SortExpressions = sorts;
    const filters = filtersOf(e, it, cc);
    if (filters.length) it.Filters = filters;
    it.Height = pt(total);
    it.Style = rdlxStyle(st, it, c);
    return it;
  }
  const pick = (box) => Object.fromEntries(Object.entries(box).filter(([k]) => /^(BackgroundColor|Color|Font\w+|TextAlign|VerticalAlign|TextDecoration|Format)$/.test(k)));
  /** a list: a banded list (header, groups, detail, footer), each slot's items stacked */
  function list(e, it, W, st, c, depth) {
    it.Type = 'bandedlist';
    const ds = prop(e, 'dataSet') || c.dataSet;
    if (ds) it.DataSetName = ds;
    const cc = { bindings: bindingsOf(e), outer: c.bindings ? c : undefined, dataSet: ds, region: it.Name };
    const slot = (s, sel, gc) => { const f = flow(s?.children || [], W, { ...inherit(st), ...named(sel) }, gc, depth + 1); return { Height: pt(f.h), ReportItems: f.items, h: f.h }; };
    const head = slot(kid(e, 'header'), 'list-header', cc), det = slot(kid(e, 'detail'), 'list-detail', cc), foot = slot(kid(e, 'footer'), 'list-footer', cc);
    let total = head.h + det.h + foot.h;
    it.Groups = kids(e, 'group').map((g, i) => {
      const gname = prop(g, 'groupName') || `Group${i + 1}`;
      const gc = { ...cc, group: gname };
      const key = prop(g, 'keyExpr');
      const k = key && setting(key, it, `The group "${gname}"`, cc);
      const gh = slot(kid(g, 'header'), `list-group-header-${i + 1}`, gc), gf = slot(kid(g, 'footer'), `list-group-footer-${i + 1}`, gc);
      total += gh.h + gf.h;
      return { Group: { Name: gname, GroupExpressions: k ? [k] : [] }, Header: { Height: gh.Height, ReportItems: gh.ReportItems }, Footer: { Height: gf.Height, ReportItems: gf.ReportItems } };
    });
    it.Header = { Height: head.Height, ReportItems: head.ReportItems };
    it.Details = { Height: det.Height, ReportItems: det.ReportItems };
    it.Footer = { Height: foot.Height, ReportItems: foot.ReportItems };
    const sorts = sortsOf(e, it, cc);
    if (sorts.length) it.SortExpressions = sorts;
    it.Height = pt(total);
    return it;
  }

  /* ---------------------------------------------------------------- page, body, header and footer */

  const mp = kid(kid(root, 'page-setup'), 'simple-master-page');
  const typ = prop(mp, 'type') || 'us-letter';
  let [pw, ph] = PAGE_TYPES[typ] || [len(prop(mp, 'width'), 0, 612), len(prop(mp, 'height'), 0, 792)];
  if (prop(mp, 'orientation') === 'landscape') [pw, ph] = [Math.max(pw, ph), Math.min(pw, ph)];
  const m = (k, d) => len(prop(mp, k), 0, d);
  const tm = m('topMargin', 72), bm = m('bottomMargin', 72), lm = m('leftMargin', 90), rm = m('rightMargin', 90);
  const CW = pw - lm - rm;
  const reportStyle = { ...named('report'), ...ownStyle(root) };
  const body = flow(kid(root, 'body')?.children || [], CW, reportStyle, {}, 0);
  const band = (el, hk) => {
    const f = flow(el?.children || [], CW, reportStyle, {}, 0);
    const h = Math.max(f.h, len(prop(mp, hk), 0, 0));
    return { Height: pt(f.items.length ? h : 0), PrintOnFirstPage: true, PrintOnLastPage: true, ReportItems: f.items };
  };
  const PageHeader = band(kid(mp, 'page-header'), 'headerHeight');
  const PageFooter = band(kid(mp, 'page-footer'), 'footerHeight');
  if (kids(kid(root, 'page-setup'), 'simple-master-page').length > 1) note('The report has more than one master page; the first one is used for every page.');

  /* ---------------------------------------------------------------- data */

  const DataSources = [], DataSets = [];
  const sources = new Map();
  for (const s of kid(root, 'data-sources')?.children || []) {
    const id = s.attrs.extensionID || s.name;
    const jdbc = /jdbc|sampledb/i.test(id);
    sources.set(s.attrs.name, { jdbc, kind: id });
    if (jdbc) DataSources.push({ Name: s.attrs.name, ConnectionProperties: { DataProvider: 'SQL', ConnectString: '' } });
    else {
      note(`Data source "${s.attrs.name}" is a ${/flatfile/i.test(id) ? 'flat file (CSV)' : /xml/i.test(id) ? 'XML' : /script/i.test(id) ? 'scripted' : id} source; point the ReportWright data source at the data (JSON or CSV).`);
      DataSources.push({ Name: s.attrs.name, ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=[]' } });
    }
  }
  const TYPES = { integer: 'Integer', float: 'Float', decimal: 'Float', 'date-time': 'Date', date: 'Date', time: 'Date', boolean: 'Boolean', string: 'String' }; // string: "" stays "" (an untyped field reads it as null)
  for (const d of kid(root, 'data-sets')?.children || []) {
    const name = d.attrs.name;
    if (!name) continue;
    const srcName = prop(d, 'dataSource');
    if (d.name !== 'oda-data-set' || !srcName) {
      note(`Data set "${name}" is a ${d.name === 'joint-data-set' ? 'joint data set (a join of two data sets)' : d.name}; it has no rows until you point it at data.`);
      DataSources.push({ Name: `${name}Source`, ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=[]' } });
    }
    const src = sources.get(srcName);
    const cols = (listProp(d, 'resultSet').length ? listProp(d, 'resultSet') : listProp(struct(d, 'cachedMetaData'), 'resultSet'));
    /** @type {any[]} */
    const Fields = cols.map(col => { const t = TYPES[prop(col, 'dataType') || '']; const n = prop(col, 'name'); return n ? { Name: n, DataField: (prop(col, 'nativeName') || n) + (t ? `[${t}]` : '') } : null; }).filter(Boolean);
    for (const cc of listProp(d, 'computedColumns')) {
      const n = prop(cc, 'name'), ex = prop(cc, 'expression');
      if (!n || ex == null) continue;
      /** @type {Record<string, any>} */
      const holder = {};
      const v = setting(ex, holder, `The computed column "${n}"`, { inSet: true });
      for (const x of holder.__notes || []) note(`Data set "${name}": ${x}`);
      if (v) Fields.push({ Name: n, Value: v });
    }
    /** @type {Record<string, any>} */
    const set = { Name: name, Fields, Query: { DataSourceName: src && d.name === 'oda-data-set' ? srcName : `${name}Source`, CommandText: '' } };
    if (src?.jdbc) {
      let q = String(prop(d, 'queryText') ?? '');
      const ps = listProp(d, 'parameters').filter(p => prop(p, 'isInput') !== 'false').sort((a, b) => (Number(prop(a, 'position')) || 0) - (Number(prop(b, 'position')) || 0));
      let k = 0;
      // the ?s in order (outside quotes) → @report parameter (the one the data set parameter is linked to)
      q = q.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\?/g, (tok) => {
        if (tok !== '?') return tok;
        const p = ps[k++];
        const linked = p && (prop(p, 'paramName') || /^params\["([^"]+)"\](\.value)?$/.exec(String(prop(p, 'defaultValue') ?? '').trim())?.[1]);
        if (linked) return `@${linked}`;
        note(`Data set "${name}": the query parameter ${p ? prop(p, 'name') : k} is not linked to a report parameter; add one and use @name in the query.`);
        return `@${p ? prop(p, 'name') : `p${k}`}`;
      });
      set.Query.CommandText = q;
    } else if (src) note(`Data set "${name}": its query is not converted; point the ReportWright data source at the data and set its path.`);
    const filters = filtersOf(d, set, { inSet: true });
    for (const x of set.__notes || []) note(`Data set "${name}": ${x}`);
    delete set.__notes;
    if (filters.length) set.Filters = filters;
    DataSets.push(set);
  }

  /* ---------------------------------------------------------------- parameters */

  const PTYPES = { integer: 'Integer', float: 'Float', decimal: 'Float', dateTime: 'DateTime', date: 'DateTime', time: 'DateTime', boolean: 'Boolean' };
  const ReportParameters = params.map(p => {
    /** @type {Record<string, any>} */
    const rp = { Name: p.attrs.name, DataType: PTYPES[prop(p, 'dataType') || ''] || 'String', Prompt: (prop(p, 'promptText') || prop(p, 'displayName') || p.attrs.name).trim() };
    if (prop(p, 'hidden') === 'true') rp.Hidden = true;
    if (prop(p, 'isRequired') === 'false' || prop(p, 'allowNull') === 'true') rp.Nullable = true;
    if (prop(p, 'allowBlank') === 'true') rp.AllowBlank = true;
    if (prop(p, 'paramType') === 'multi-value') rp.MultiValue = true;
    const defs = simpleList(p, 'defaultValue');
    const d = defs.length ? defs.map(v => (v.attrs.type === 'javascript' ? null : v.text)) : [prop(p, 'defaultValue')];
    if (d.some(v => v == null) && defs.length) note(`The parameter "${p.attrs.name}" has a default set by a script; it has no default here.`);
    const vals = d.filter(v => v != null);
    if (vals.length) rp.DefaultValue = { Values: vals.map(v => String(v).replace(/^"(.*)"$/, '$1')) };
    if (prop(p, 'valueType') === 'dynamic') {
      const ds = prop(p, 'dataSetName');
      const field = (ex) => /^\s*(?:row|dataSetRow)\["([^"]+)"\]\s*$/.exec(ex || '')?.[1];
      const vf = field(prop(p, 'valueExpr')), lf = field(prop(p, 'labelExpr'));
      if (ds && vf) rp.ValidValues = { DataSetReference: { DataSetName: ds, ValueField: vf, ...(lf ? { LabelField: lf } : {}) } };
      else note(`The choices of parameter "${p.attrs.name}" are computed in a way ReportWright cannot read; it takes any value.`);
    } else {
      const sel = listProp(p, 'selectionList');
      if (sel.length) rp.ValidValues = { ParameterValues: sel.map(s => ({ Value: prop(s, 'value'), Label: prop(s, 'label') ?? prop(s, 'value') })) };
    }
    return rp;
  });

  /* ---------------------------------------------------------------- images */

  const EmbeddedImages = listProp(root, 'images').map(im => {
    const n = prop(im, 'name'), data = prop(im, 'data');
    if (!n || !data) return null;
    const type = prop(im, 'type') || (/\.png$/i.test(n) ? 'image/png' : /\.gif$/i.test(n) ? 'image/gif' : 'image/jpeg');
    return { Name: n, MIMEType: type, ImageData: data.replace(/\s+/g, '') };
  }).filter(Boolean);

  return {
    Name: prop(root, 'title') || reportName, Page: { PageWidth: pt(pw), PageHeight: pt(ph), LeftMargin: pt(lm), RightMargin: pt(rm), TopMargin: pt(tm), BottomMargin: pt(bm) },
    DataSources, DataSets, ReportParameters, EmbeddedImages,
    Body: { Height: pt(body.h), ReportItems: body.items }, PageHeader, PageFooter,
  };
}
