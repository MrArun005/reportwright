// @ts-check
import { checkValue, checkFunctions, parseValue, callIssues, compile } from '../expr/evaluate.js';
import { ITEMS } from '../items/index.js';
import { symbologyError } from '../items/barcode.js';
import { rowCells } from '../items/cells.js';
import { REPORT_SCHEMA } from './report.schema.js';

export const SCHEMA_ID = 'pagewright/report@1'; // kept after the rename: every saved report carries it
export const SCHEMA_ALIAS = 'reportwright/report@1'; // the same format under the new name

/** Properties the engine reads on any item, beyond each type's own (its inspector props and defaults). ponytail: a
 *  list; a new item property is added here (or to the type's props) or validate() calls it unknown. */
const ITEM_KEYS = new Set(('id type name x y w h style styleName items hidden layer locked label alt value dataSet canGrow canShrink action bookmark tooltip '
  + 'keepTogether pageBreakBefore pageBreakAfter pageBreakBetween newSection filters sort groups groupBy groupAdjacent inheritRows columns header detail '
  + 'footer repeatHeader noRowsText pageBreakEvery cells rows rowGroup rowGroups columnGroup columnGroups values value valueFormat rowSort columnSort '
  + 'rowTotals columnTotals cellStyle headerStyle totalStyle corner partProps library part properties overflow overflowTo src fit headingLevel '
  + 'rotate shrinkToFit minFontSize shrinkStep tocDots tocLink tocPage format chartType series seriesGroup category title legend palette stacked '
  + 'valueAxis xTitle maxCategories categorySort categoryFormat showValues labelPosition symbology quietZone report params text toggle '
  + 'initiallyCollapsed collapsible expandLevels repeatColumns columnGap rowHeaderWidth anim animation visual comment notes description').split(' '));
/** Report-level properties. */
const DEF_KEYS = new Set(('$schema name description locale currency timeZone page parameters dataSources dataSets styles sections functions layers '
  + 'images theme themeDef master nullPropagation caseSensitive naturalSort nullOrder collation arithmetic bandRows version id tags author folder '
  + 'stylesheet parts partProperties dashboard comment notes customCode libraries liveParameters parameterLayout drafts history nonFinite').split(' '));
for (const k of Object.keys(REPORT_SCHEMA.$defs.Report.properties)) DEF_KEYS.add(k); // the schema's, too
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
/** The nearest known name: a typo (2 edits) or the start of a longer one (noRows → noRowsText). */
export function didYouMean(k, known) {
  let best = null, bd = 3;
  for (const c of known) {
    const dd = c.toLowerCase().startsWith(k.toLowerCase()) && k.length >= 3 ? 1 : lev(k, c);
    if (dd < bd) { bd = dd; best = c; }
  }
  return best;
}
/** Each item type's properties in the report JSON Schema (its own and ItemBase's): type → Map(key → schema). */
const SCHEMA_ITEMS = (() => {
  const defs = /** @type {Record<string, any>} */ (REPORT_SCHEMA.$defs);
  const of = (/** @type {any} */ s) => (s?.$ref ? defs[s.$ref.replace('#/$defs/', '')] : s);
  /** @type {Map<string, Map<string, any>>} */
  const out = new Map();
  for (const r of defs.Item.anyOf) {
    const props = new Map();
    for (const part of of(r).allOf || []) for (const [k, v] of Object.entries(of(part).properties || {})) props.set(k, v);
    out.set(props.get('type').const, props);
  }
  return out;
})();
/** A value outside its property's enum in the schema (a literal, not an expression), else null. @param {any} sch @param {any} v */
const offEnum = (sch, v) => {
  const list = sch?.enum || (sch?.anyOf?.every((/** @type {any} */ x) => 'const' in x) ? sch.anyOf.map((/** @type {any} */ x) => x.const) : null);
  if (!list || v == null || (typeof v === 'string' && v.startsWith('='))) return null;
  return list.includes(v) ? null : list;
};
const ownKeys = (type) => {
  const spec = ITEMS[type];
  let dflt = {};
  try { dflt = spec?.defaults?.() || {}; } catch { /* none */ }
  return [...(spec?.props || []).map(p => p.key), ...Object.keys(dflt), ...(SCHEMA_ITEMS.get(type)?.keys() || [])];
};

/**
 * Structural checks. Errors stop the render; warnings do not. exprErrors: the errors that are an item's expression
 * that does not parse. They are in `errors` too (the designer shows them), but render() goes on and draws #Error in
 * that item or cell with a warning, as SSRS does.
 * @param {any} def
 */
export function validate(def) {
  // checkOnly: errors a render reports itself where it meets them (an unknown function, a symbology): non-fatal, and
  // left out of the render's own warnings so they are not said twice
  const errors = [], warnings = [], exprErrors = [], checkOnly = [];
  if (!def || typeof def !== 'object') return { errors: ['The report definition is empty'], warnings, exprErrors, checkOnly };
  if (def.$schema && def.$schema !== SCHEMA_ID && def.$schema !== SCHEMA_ALIAS) warnings.push(`Unknown schema "${def.$schema}". Expected "${SCHEMA_ID}".`);
  for (const k of Object.keys(def)) if (!DEF_KEYS.has(k) && !k.startsWith('_')) { const g = didYouMean(k, DEF_KEYS); warnings.push(`Unknown report property "${k}"${g ? ` (did you mean "${g}"?)` : ''}; it is ignored`); }
  const body = def.sections?.body;
  if (!body || (Array.isArray(body) && !body.length)) errors.push('The report has no body section');
  if (Array.isArray(body)) body.forEach((b, i) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) errors.push(`Body section ${i + 1} is not an object`);
    else if (b.page != null && (typeof b.page !== 'object' || Array.isArray(b.page))) errors.push(`Body section ${i + 1}: "page" must be an object`);
    for (const k of ['pageHeader', 'pageFooter']) if (b && b[k] != null && (typeof b[k] !== 'object' || Array.isArray(b[k]))) errors.push(`Body section ${i + 1}: "${k}" must be an object`);
  });

  errors.push(...checkFunctions(def.functions));

  for (const p of def.parameters || []) {
    if (p?.hidden && p.required && (p.default == null || p.default === '') && !p.nullable) {
      warnings.push(`Parameter "${p.name}" is hidden and required but has no default: only a URL, the API or a drill-through can set it`);
    }
  }

  const srcNames = new Set();
  for (const s of def.dataSources || []) {
    if (!s.name) errors.push('A data source has no name');
    if (srcNames.has(s.name)) errors.push(`Two data sources have the name "${s.name}"`);
    srcNames.add(s.name);
  }
  const dsNames = new Set();
  for (const d of def.dataSets || []) {
    if (!d.name) errors.push('A data set has no name');
    if (dsNames.has(d.name)) errors.push(`Two data sets have the name "${d.name}"`);
    if (d.relation) {
      // a nested data set: rows come from each parent row, so the parent must be built first
      if (!d.relation.parent || !dsNames.has(d.relation.parent)) errors.push(`Data set "${d.name}": its parent "${d.relation.parent}" must be a data set declared above it`);
      if (d.relation.path != null && typeof d.relation.path !== 'string') errors.push(`Data set "${d.name}": the relation path must be text, e.g. $.items[*]`);
    } else if (!srcNames.has(d.source)) errors.push(`Data set "${d.name}" uses the source "${d.source}", which does not exist`);
    dsNames.add(d.name);
  }

  const names = new Set();
  const check = (where, v, label) => {
    if (v == null) return;
    const err = checkValue(v);
    if (err) { errors.push(`${label}: ${err}`); exprErrors.push(`${label}: ${err}`); }
  };
  // PageNumber and TotalPages anywhere in the body (a cell, a group header, an item inside a list or a cell): the body
  // is laid out before it is paginated, so they show 1 there. SSRS refuses them; ReportWright warns once per item.
  const PAGE_GLOBALS = /Globals\s*[.!]\s*(PageNumber|TotalPages)/i;
  const paged = new Set();
  const scan = (n, label, depth) => {
    if (depth > 64 || n == null) return;
    if (typeof n === 'string') { if (PAGE_GLOBALS.test(n) && !paged.has(label)) { paged.add(label); warnings.push(`${label}: PageNumber and TotalPages work only in the page header and footer`); } return; }
    if (Array.isArray(n)) { for (const x of n) scan(x, label, depth + 1); return; }
    if (typeof n === 'object') {
      const own = n.type && n.name ? n.name : label;
      for (const [k, v] of Object.entries(n)) scan(v, k === 'cells' && own === label ? `${label} cell` : own, depth + 1);
    }
  };
  const lists = [];
  for (const where of ['pageHeader', 'body', 'pageFooter']) {
    const sec = def.sections?.[where];
    if (!sec) continue;
    for (const b of Array.isArray(sec) ? sec : [sec]) if (b && typeof b === 'object') lists.push([where, b.items]);
  }
  // a body section's own page header and footer are checked as the shared ones are
  if (Array.isArray(body)) for (const b of body) for (const k of ['pageHeader', 'pageFooter']) if (b?.[k] && typeof b[k] === 'object') lists.push([k, b[k].items]);
  for (const [where, items] of lists) {
    if (where === 'body') for (const it of Array.isArray(items) ? items : []) scan(it, it?.name || it?.type, 0);
    for (const it of Array.isArray(items) ? items : []) {
      const label = it.name || it.type;
      if (!ITEMS[it.type]) { warnings.push(`Unknown item type "${it.type}"`); continue; }
      if (it.name) {
        if (names.has(it.name)) warnings.push(`Two items have the name "${it.name}"`);
        names.add(it.name);
      }
      for (const k of ['x', 'y', 'w', 'h']) if (typeof it[k] !== 'number' || Number.isNaN(it[k])) errors.push(`${label}: "${k}" must be a number`);
      // a mistyped property is ignored silently otherwise ("vale" for value: a blank box)
      const own = ownKeys(it.type);
      for (const k of Object.keys(it)) {
        if (k.startsWith('_') || k.startsWith('$') || ITEM_KEYS.has(k) || own.includes(k)) continue;
        const g = didYouMean(k, [...own, 'value', 'style', 'hidden', 'name', 'dataSet']);
        warnings.push(`${label}: unknown property "${k}"${g ? ` (did you mean "${g}"?)` : ''}; it is ignored`);
      }
      // a literal outside the schema's choices ("dir": "rtl2")
      for (const [k, sch] of SCHEMA_ITEMS.get(it.type) || []) {
        const list = k === 'type' ? null : offEnum(sch, it[k]);
        if (list) warnings.push(`${label}: "${k}" is ${JSON.stringify(it[k])}; expected one of ${list.map(x => JSON.stringify(x)).join(', ')}`);
      }
      check(where, it.value, label);
      check(where, it.src, label);
      check(where, it.hidden, label);
      if (it.dataSet && !dsNames.has(it.dataSet)) warnings.push(`${label}: the data set "${it.dataSet}" does not exist`);
      if (it.type === 'matrix') {
        for (const k of ['rowGroups', 'columnGroups', 'values']) {
          if (it[k] == null) continue;
          if (!Array.isArray(it[k])) { errors.push(`${label}: "${k}" must be a list`); continue; }
          it[k].forEach((g, i) => {
            if (!g || typeof g !== 'object') { errors.push(`${label}: ${k} ${i + 1} is not an object`); return; }
            for (const e of ['expr', 'label', 'sortBy', 'value', 'parent']) check(where, g[e], `${label} ${k} ${i + 1}`);
          });
        }
      }
      if (it.type === 'table') {
        for (const g of it.groups || []) for (const e of ['expr', 'parent', 'sortBy']) check(where, g?.[e], `${label} group`);
        if (!Array.isArray(it.columns) || !it.columns.length) errors.push(`${label}: the table has no columns`);
        if (where !== 'body') errors.push(`${label}: tables can only be in the body`);
        for (const part of ['header', 'detail', 'footer']) {
          for (const row of it[part] || []) for (const c of row.cells || []) if (c) check(where, c.value, `${label} ${part} cell`);
        }
        const n = Array.isArray(it.columns) ? it.columns.length : 0;
        const rowsOf = [['header', it.header], ['detail', it.detail], ['footer', it.footer], ...(it.groups || []).flatMap((g, gi) => [[`group ${gi + 1} header`, g?.header], [`group ${gi + 1} footer`, g?.footer]])];
        for (const [part, rows] of rowsOf) (Array.isArray(rows) ? rows : []).forEach((row, ri) => {
          for (const [k, j] of rowCells(row?.cells, n).covered) warnings.push(`${label} ${part} row ${ri + 1}: cell ${k} is covered by colSpan of cell ${j}, so it is not drawn (leave it null, or omit the spanned cells: a row with fewer cells than columns places each cell after the previous one's span)`);
        });
      }
    }
  }
  // functions an expression calls that do not exist, anywhere in the report (items, data sets, parameters, functions)
  const custom = new Set((Array.isArray(def.functions) ? def.functions : []).map(f => String(f?.name ?? '').toLowerCase()));
  const callErr = (label, msg) => { const e = `${label}: ${msg}`; if (!errors.includes(e)) { errors.push(e); exprErrors.push(e); checkOnly.push(e); } };
  const asts = (v, key) => {
    if (typeof v !== 'string' || !(v.startsWith('=') || (TEMPLATE_KEYS.has(key) && v.includes('{')))) return [];
    try { const p = parseValue(v); return p.kind === 'expr' ? [p.ast] : p.kind === 'tpl' ? p.parts.filter(x => typeof x === 'object').map(x => x.ast) : []; } catch { return []; } // a syntax error is reported above
  };
  /** items: an object with a type and a name is an item, its messages carry its name (not in data sets or parameters) */
  const calls = (n, label, depth, key, items = false) => {
    if (depth > 64 || n == null) return;
    if (typeof n === 'string') { for (const a of asts(n, key)) for (const m of callIssues(a, custom, didYouMean)) callErr(label, m); return; }
    if (Array.isArray(n)) { for (const x of n) calls(x, label, depth + 1, key, items); return; }
    if (typeof n === 'object') for (const [k, v] of Object.entries(n)) calls(v, items && n.type && n.name ? n.name : label, depth + 1, k, items);
  };
  for (const [, items] of lists) for (const it of Array.isArray(items) ? items : []) {
    calls(it, it?.name || it?.type, 0, null, true);
    walkItems(it, (x) => { if (x.type === 'barcode' && x.symbology != null) { const e = symbologyError(x.symbology); if (e) callErr(x.name || 'Barcode', e); } });
  }
  for (const d of def.dataSets || []) calls(d, `Data set "${d?.name}"`, 0, null);
  for (const p of def.parameters || []) calls(p, `Parameter "${p?.name}"`, 0, null);
  for (const f of Array.isArray(def.functions) ? def.functions : []) {
    if (typeof f?.body !== 'string') continue;
    try { for (const m of callIssues(compile(f.body.replace(/^=/, '')), custom, didYouMean)) callErr(`Function "${f.name}"`, m); } catch { /* checkFunctions says it */ }
  }
  return { errors, warnings, exprErrors, checkOnly };
}

/** Keys whose text may hold {expression} parts (a text template). */
const TEMPLATE_KEYS = new Set(['value', 'text', 'label', 'tooltip', 'title', 'noRowsText']);
/** fn on an item and every item inside it (containers, lists, table cells). @param {any} it @param {(x: any) => void} fn */
function walkItems(it, fn, depth = 0) {
  if (!it || typeof it !== 'object' || depth > 64) return;
  if (it.type) fn(it);
  for (const v of Object.values(it)) {
    if (Array.isArray(v)) for (const x of v) { if (x && typeof x === 'object') walkItems(x, fn, depth + 1); }
    else if (v && typeof v === 'object') walkItems(v, fn, depth + 1);
  }
}
