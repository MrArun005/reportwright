// @ts-check
import { checkValue, checkFunctions, parseValue, callIssues, compile, isAggregate, didYouMean, noParam } from '../expr/evaluate.js';
import { ITEMS } from '../items/index.js';
import { symbologyError } from '../items/barcode.js';
import { rowCells } from '../items/cells.js';
import { REPORT_SCHEMA } from './report.schema.js';
import { toDate } from '../expr/format.js';
import { PAGE_SIZES, normalizePageSize, resolvePage } from '../units.js';

export const SCHEMA_ID = 'reportwright/report@1';
export const SCHEMA_ALIAS = 'pagewright/report@1'; // deprecated: the name before the rename, still read as the same format

/** Properties the engine reads on any item, beyond each type's own (its inspector props and defaults). ponytail: a
 *  list; a new item property is added here (or to the type's props) or validate() calls it unknown. */
const ITEM_KEYS = new Set(('id type name x y w h style styleName items hidden layer locked label alt value dataSet canGrow canShrink action bookmark tooltip '
  + 'keepTogether pageBreakBefore pageBreakAfter pageBreakBetween newSection filters sort groups groupBy groupAdjacent inheritRows columns header detail '
  + 'footer repeatHeader widowControl noRowsText pageBreakEvery cells rows rowGroup rowGroups columnGroup columnGroups values value valueFormat rowSort columnSort '
  + 'rowTotals columnTotals cellStyle headerStyle totalStyle corner partProps library part properties overflow overflowTo src fit headingLevel '
  + 'rotate shrinkToFit minFontSize shrinkStep tocDots tocLink tocPage format chartType series seriesGroup category title legend palette stacked '
  + 'valueAxis xTitle maxCategories outliers categorySort categoryFormat showValues labelPosition symbology quietZone report params text toggle '
  + 'initiallyCollapsed collapsible expandLevels repeatColumns columnGap rowHeaderWidth anim animation visual comment notes description').split(' '));
/** Chart types that take their bars from ganttStart and ganttEnd, not from a series (items/chart-more.js). */
const NO_SERIES_CHARTS = new Set(['gantt']);
/** Text styled as a link (underlined, in a blue link colour) with no action: a reader clicks it and nothing happens. */
function looksLikeLink(it) {
  if (it.type !== 'textbox' || (it.action && it.action.type && it.action.type !== 'none')) return false;
  const st = it.style && typeof it.style === 'object' ? it.style : {};
  if (!/underline/i.test(String(st.textDecoration || ''))) return false;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(st.color || '').trim());
  if (!m) return false;
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16));
  return b > 150 && b > r + 60 && b > g + 30; // a blue: #2563eb, #0000ee, #1a0dab
}
/** Report-level properties. */
const DEF_KEYS = new Set(('$schema name description locale currency timeZone page parameters dataSources dataSets styles sections functions layers '
  + 'images theme themeDef master nullPropagation caseSensitive naturalSort nullOrder collation arithmetic bandRows version id tags author folder '
  + 'stylesheet parts partProperties dashboard comment notes customCode libraries liveParameters parameterLayout drafts history nonFinite').split(' '));
for (const k of Object.keys(REPORT_SCHEMA.$defs.Report.properties)) DEF_KEYS.add(k); // the schema's, too
export { didYouMean };
/** Colour names the renderer reads (exporters/color.js; the engine does not import the exporters). Another word is not drawn. */
const COLOUR_NAMES = ['black', 'white', 'red', 'green', 'blue', 'gray', 'grey', 'orange', 'yellow'];
const COLOUR_KEYS = ['color', 'backgroundColor', 'fill', 'stroke', 'textDecorationColor'];
/** A standard numeric format code with a stray letter after it: "N2x" (the code is "N2"). */
const NUMERIC_FORMAT = /^([CcNnFfPpEeXxGgRr])(\d{1,2})[A-Za-z]/;
/** A source the browser cannot load: a Windows or relative path, file:, or a bare image file name. */
const LOCAL_IMAGE = /^(?:[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|file:|[^:/\\\s]+\.(?:png|jpe?g|gif|webp|svg)$)/i;
/** Keys a sort entry is often written with, for the one it means: {by, dir}. */
const SORT_ALIAS = { expr: 'by', expression: 'by', field: 'by', direction: 'dir', order: 'dir' };
/** Warnings for a style object: an unknown colour name, a numeric format code with a stray letter. */
/** Style properties the schema lists (it allows others: the engine reads a few more, e.g. direction). */
const STYLE_KEYS = Object.keys(REPORT_SCHEMA.$defs.Style.properties);
function styleIssues(st, label, out) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return;
  // a near miss of a style property ("fontWieght") is ignored silently otherwise; another name may be read, so says nothing
  for (const k in st) { const g = !STYLE_KEYS.includes(k) && didYouMean(k, STYLE_KEYS); if (g) out.push(`${label}: unknown style property "${k}" (did you mean "${g}"?); it is ignored`); }
  for (const k of COLOUR_KEYS) {
    const v = st[k];
    if (typeof v !== 'string' || v.startsWith('=')) continue;
    const s = v.trim().toLowerCase();
    if (!/^[a-z]+$/.test(s) || COLOUR_NAMES.includes(s) || s === 'none' || s === 'transparent') continue;
    const g = didYouMean(s, COLOUR_NAMES);
    out.push(`${label}: "${v}" is not a colour name the report can draw${g ? ` (did you mean "${g}"?)` : ''}; use a name such as "red" or a hex colour such as "#dc2626"`);
  }
  formatIssue(st.format, label, out);
}
function formatIssue(f, label, out) {
  const m = typeof f === 'string' ? NUMERIC_FORMAT.exec(f) : null;
  if (m) out.push(`${label}: the format "${f}" is not a format code (did you mean "${m[1]}${m[2]}"?)`);
}
/** A sort is a list of {by, dir}: an entry without "by" (or with other keys) is ignored, so it says so. */
function sortIssues(sort, label, out, known = new Set()) {
  sort.forEach((s, i) => {
    const at = `${label}, sort ${i + 1}`;
    if (!s || typeof s !== 'object' || Array.isArray(s) || !('by' in s)) { out.push(`${at}: a sort entry is {by, dir}, e.g. {"by": "=Fields.Name", "dir": "asc"}; this one has no "by" and is ignored`); return; }
    // a bare field name sorts by the field (bareSorts); other text is a constant: no order
    const f = fieldNamed(s.by, known), g = f || (typeof s.by === 'string' && s.by.trim() && !s.by.startsWith('=') && didYouMean(s.by, known));
    if (f || g !== false) out.push(`${at}: "by" is ${f ? `"${s.by}", the name of a field; it sorts by that field` : `the constant "${s.by}", so the rows are not sorted;`} (did you mean "=Fields.${g || 'Name'}"?)`);
    for (const k of Object.keys(s)) {
      if (k === 'by' || k === 'dir' || k.startsWith('_')) continue;
      const g = SORT_ALIAS[k] || didYouMean(k, ['by', 'dir']);
      out.push(`${at}: "${k}" is ignored; a sort entry is {by, dir}${g ? ` (did you mean "${g}"?)` : ''}`);
    }
    if (s.dir != null && !['asc', 'desc'].includes(s.dir)) out.push(`${at}: "dir" is ${JSON.stringify(s.dir)}; expected "asc" or "desc"`);
  });
}
const FILTER_KEYS = ['expr', 'op', 'value', 'value2', 'skipBlank'];
const FILTER_ALIAS = { expression: 'expr', field: 'expr', by: 'expr', operator: 'op', comparison: 'op', values: 'value', value1: 'value' };
/** A filter is {expr, op, value, value2, skipBlank}: any other key is ignored (the filter then matches on undefined), so it says so. */
function filterIssues(filters, label, out) {
  filters.forEach((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return;
    for (const k of Object.keys(f)) {
      if (FILTER_KEYS.includes(k) || k.startsWith('_')) continue;
      const g = FILTER_ALIAS[k] || didYouMean(k, FILTER_KEYS);
      out.push(`${label}, filter ${i + 1}: "${k}" is ignored; a filter is {${FILTER_KEYS.join(', ')}}${g ? ` (did you mean "${g}"?)` : ''}`);
    }
  });
}
/** The operators rowFilter() reads (data/index.js); TopN... in any case. */
const FILTER_OPS = '= <> > >= < <= in like contains between Between TopN BottomN TopPercent BottomPercent'.split(' ');
/**
 * A half-written filter is an error: with no expr, an unknown op, no value, or a Between with no upper bound it
 * matches every row or none and says nothing. {expr, value} with no op is "=" (documented, kept); with neither op nor
 * value (the whole comparison written in expr) it is an error, not a test of expr's truth: whether a missing op meant
 * "=" would then hang on whether a value is there.
 */
function filterShape(filters, label, out) {
  filters.forEach((f, i) => {
    if (!f || typeof f !== 'object') return;
    const at = `${label}, filter ${i + 1}`, op = f.op, eg = `; a filter is {expr, op, value}, e.g. { expr: '=Fields.a', op: '>=', value: 2 }`;
    const msg = /^=?\s*$/.test(f.expr ?? '') ? ' has no expr' : op == null || op === '' ? (f.value == null ? ' has no op' : '')
      : !FILTER_OPS.some(o => o === op || (o.length > 7 && o.toLowerCase() === String(op).toLowerCase())) ? `: the op ${JSON.stringify(op)} is not a filter operator (${FILTER_OPS.join(' ')})`
        : f.value == null ? ` (${op}) has no value` : /^between$/i.test(op) && f.value2 == null && !Array.isArray(f.value) && !String(f.value).startsWith('=') ? ` (${op}) has no value2, the upper bound (or give value as [low, high])` : '';
    if (msg) out.push(at + msg + eg);
  });
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
  if (!def.$schema) warnings.push(`The report has no "$schema", so an editor cannot check it; add "$schema": "${SCHEMA_ID}" at the top. It renders as before.`);
  if (def.$schema && def.$schema !== SCHEMA_ID && def.$schema !== SCHEMA_ALIAS) warnings.push(`Unknown schema "${def.$schema}". Expected "${SCHEMA_ID}".`);
  for (const k of Object.keys(def)) if (!DEF_KEYS.has(k) && !k.startsWith('_')) { const g = didYouMean(k, DEF_KEYS); warnings.push(`Unknown report property "${k}"${g ? ` (did you mean "${g}"?)` : ''}; it is ignored`); }
  const body = def.sections?.body;
  if (!body || (Array.isArray(body) && !body.length)) errors.push('The report has no body section');
  const size = def.page?.size;
  if (typeof size === 'string' && !normalizePageSize(size)) {
    const g = didYouMean(size.trim(), [...Object.keys(PAGE_SIZES), 'Pageless']);
    warnings.push(`Unknown page size "${size}"${g ? ` (did you mean "${g}"?)` : ''}; the page falls back to A4 unless width and height are set`);
  }
  for (const [n, st] of Object.entries(def.styles?.named || {})) styleIssues(st, `Named style "${n}"`, warnings);
  styleIssues(def.styles?.base, 'Base style', warnings);
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
    // required + nullable: an unset value is null (the engine keeps that: an explicit null is a value), so the report can draw blank
    if (p?.required && p.nullable && !p.multi && (p.default == null || p.default === '')) {
      warnings.push(`Parameter "${p.name}" is required and nullable with no default: when no value is given it is null and the report can draw blank; give it a default, or drop "nullable" to require a value`);
    }
    // an explicit nullable:false or allowBlank:false promises a value, but only "required" asks for one: otherwise an unset parameter is null
    if (p && !p.required && !p.multi && (p.nullable === false || p.allowBlank === false) && (p.default == null || p.default === '')) {
      warnings.push(`Parameter "${p.name}" is ${p.nullable === false ? 'nullable: false' : 'allowBlank: false'} but is not required and has no default, so when no value is given it is null; add "required": true or a default`);
    }
    // a date default is read as a date in the invariant form (2026-12-31); "31/12/2026" is none, and the parameter stays blank
    if (p?.type === 'date' && typeof p.default === 'string' && p.default.trim() && !p.default.startsWith('=') && !toDate(p.default)) {
      warnings.push(`Parameter "${p.name}": its default "${p.default}" is not a date; write it as 2026-12-31 (year-month-day)`);
    }
  }

  const known = fieldNames(def), srcNames = new Set();
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
    if (Array.isArray(d.sort)) sortIssues(d.sort, `Data set "${d.name}"`, warnings, known);
    if (Array.isArray(d.filters)) { filterIssues(d.filters, `Data set "${d.name}"`, warnings); filterShape(d.filters, `Data set "${d.name}"`, errors); }
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
  const lists = [], refErrors = [];
  const fields = inlineFields(def), params = new Set((Array.isArray(def.parameters) ? def.parameters : []).map(p => p?.name));
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
      walkItems(it, (x) => { itemRefs(x, warnings, fields, params, refErrors); if (Array.isArray(x.filters)) filterShape(x.filters, x.name || x.type, errors); });
      if (it.name) {
        if (names.has(it.name)) warnings.push(`Two items have the name "${it.name}"`);
        names.add(it.name);
      }
      for (const k of ['x', 'y', 'w', 'h']) if (typeof it[k] !== 'number' || Number.isNaN(it[k])) errors.push(`${label}: "${k}" must be a number`);
      if (looksLikeLink(it)) warnings.push(`${label}: its text looks like a link (underlined, in a link colour) but it has no action; give it one (Action) or a plain style`);
      styleIssues(it.style, label, warnings);
      formatIssue(it.format, label, warnings);
      if (it.styleName != null && typeof it.styleName === 'string' && !it.styleName.startsWith('=') && !def.styles?.sheet && !def.master && !def.theme && !Object.hasOwn(def.styles?.named || {}, it.styleName)) {
        const g = didYouMean(it.styleName, Object.keys(def.styles?.named || {}));
        warnings.push(`${label}: there is no named style "${it.styleName}"${g ? ` (did you mean "${g}"?)` : ''}; it is ignored`);
      }
      if (Array.isArray(it.sort)) sortIssues(it.sort, label, warnings, known);
      // a group on a constant is one group of every row
      for (const [g, at] of [...(it.groups || []).map((g, i) => [g, `${label}, group ${i + 1}`]), ...['rowGroups', 'columnGroups'].flatMap(k => (Array.isArray(it[k]) ? it[k] : []).map((g, i) => [g, `${label} ${k} ${i + 1}`]))]) {
        if (fieldNamed(g?.expr, known)) warnings.push(`${at}: "expr" is "${g.expr}", the name of a field, so every row is in one group; did you mean "=Fields.${g.expr}"?`);
      }
      if (Array.isArray(it.filters)) filterIssues(it.filters, label, warnings);
      if (it.type === 'chart' && it.legend != null && it.legend !== 'bottom' && it.legend !== 'none') {
        const shown = typeof it.legend === 'object' ? `is an object (${JSON.stringify(it.legend).slice(0, 60)})` : `is ${JSON.stringify(it.legend)}`;
        warnings.push(`${label}: "legend" ${shown}; only "bottom" (show the legend) or "none" (hide it) is supported, and the legend is drawn at the bottom`);
      }
      if (it.type === 'chart' && !NO_SERIES_CHARTS.has(it.chartType) && !(Array.isArray(it.series) && it.series.length)) warnings.push(`${label}: the chart has no series, so it plots a count of its rows; add one, e.g. series: [{ "name": "Value", "value": "=Sum(Fields.Amount)" }]`);
      if (it.type === 'chart' && it.chartType === 'polar' && it.xValue == null) warnings.push(`${label}: a polar chart needs xValue, the angle of each point in degrees (0 at the top, clockwise); without it no point is drawn`);
      if (it.type === 'image' && typeof it.src === 'string' && !it.src.startsWith('=') && LOCAL_IMAGE.test(it.src.trim())) warnings.push(`${label}: "${it.src}" is a local file path, which a browser cannot load; embed the image (images: { name: "data:image/png;base64,..." } and src: "embedded:name") or use an https:// address`);
      if (it.style != null && (typeof it.style !== 'object' || Array.isArray(it.style))) warnings.push(`${label}: "style" must be an object of style properties, such as { "fontWeight": "bold" }; ${JSON.stringify(it.style).slice(0, 40)} is ignored`);
      // a mistyped property is ignored silently otherwise ("vale" for value: a blank box)
      const own = ownKeys(it.type);
      for (const k of Object.keys(it)) {
        if (k.startsWith('_') || k.startsWith('$') || ITEM_KEYS.has(k) || own.includes(k)) continue;
        const g = didYouMean(k, [...own, 'value', 'style', 'hidden', 'name', 'dataSet']);
        warnings.push(`${label}: unknown property "${k}"${g ? ` (did you mean "${g}"?)` : ''}; it is ignored`);
      }
      // a literal outside the schema's choices ("dir": "rtl2")
      for (const [k, sch] of SCHEMA_ITEMS.get(it.type) || []) {
        if (it.type === 'chart' && k === 'legend') continue; // its own message, above
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
          // cells placed as rowCells places them: a short row with a colSpan covers its gap with the spans, else each cell takes one column
          const cells = Array.isArray(row?.cells) ? row.cells : [];
          const placed = cells.length < n && cells.some(c => Number(c?.colSpan) > 1) ? cells.reduce((s, c) => s + (Math.max(1, Math.floor(Number(c?.colSpan)) || 1)), 0) : cells.length;
          if (placed < n) warnings.push(`${label} ${part} row ${ri + 1}: the row has ${placed} of ${n} cells and no colSpan covers the other ${n - placed}; add the cells or a colSpan`);
          for (const [k, j] of rowCells(row?.cells, n).covered) warnings.push(`${label} ${part} row ${ri + 1}: cell ${k} is covered by colSpan of cell ${j}, so it is not drawn (leave it null, or omit the spanned cells: a row with fewer cells than columns places each cell after the previous one's span)`);
        });
      }
    }
  }
  for (const e of new Set(refErrors)) { errors.push(e); exprErrors.push(e); }
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
  // an aggregate with no scope outside a data region (a table, list, matrix, chart, or an item with a data set) sums the
  // report's first data set: it works, and says nothing
  const REGIONS = new Set(['table', 'list', 'matrix', 'chart', 'subreport', 'part']);
  const bare = (n, out, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return;
    if (Array.isArray(n)) { for (const x of n) bare(x, out, depth + 1); return; }
    if (n.type === 'call' && !n.obj && isAggregate(String(n.name).toLowerCase()) && n.args?.length === 1) out.add(n.name);
    for (const k in n) if (k !== 'p' && n[k] && typeof n[k] === 'object') bare(n[k], out, depth + 1);
  };
  const strs = (n, f, key = null, depth = 0) => {
    if (depth > 64 || n == null) return;
    if (typeof n === 'string') { f(n, key); return; }
    if (Array.isArray(n)) { for (const x of n) strs(x, f, key, depth + 1); return; }
    if (typeof n === 'object') for (const [k, v] of Object.entries(n)) if (k !== 'items') strs(v, f, k, depth + 1);
  };
  const unscoped = (it) => {
    if (!it || typeof it !== 'object' || it.dataSet || REGIONS.has(it.type)) return;
    const found = new Set();
    strs(it, (v, key) => { for (const a of asts(v, key)) bare(a, found); });
    if (found.size) warnings.push(`${it.name || it.type}: ${[...found].join(', ')} is outside a table or list and names no scope, so it uses the first data set; name one as the last argument, e.g. ${[...found][0]}(Fields.x, "DataSetName"), or give the item a dataSet`);
    for (const c of Array.isArray(it.items) ? it.items : []) unscoped(c);
  };
  for (const [, items] of lists) for (const it of Array.isArray(items) ? items : []) unscoped(it);
  for (const d of def.dataSets || []) calls(d, `Data set "${d?.name}"`, 0, null);
  for (const p of def.parameters || []) calls(p, `Parameter "${p?.name}"`, 0, null);
  for (const f of Array.isArray(def.functions) ? def.functions : []) {
    if (typeof f?.body !== 'string') continue;
    try { for (const m of callIssues(compile(f.body.replace(/^=/, '')), custom, didYouMean)) callErr(`Function "${f.name}"`, m); } catch { /* checkFunctions says it */ }
  }
  // SILENT-6: an item taller than the room the page has for the body (the page less its margins, page header and
  // footer; a body section's own page and bands count). The paginator cuts such an item at the page bottom (text of
  // more lines than fit is split first); tables, matrices, lists and subreports split by their rows. render() says it
  // itself where it cuts (with the page), so these are left out of its warnings (renderSays).
  const renderSays = [];
  const band = (own, shared) => (!own || typeof own !== 'object' || Array.isArray(own) ? Number(shared?.height) || 0 : own.hidden ? 0 : Number(own.height) || 0);
  for (const b of Array.isArray(body) ? body : body ? [body] : []) {
    if (!b || typeof b !== 'object') continue;
    const pg = resolvePage({ ...(def.page || {}), ...(b.page && typeof b.page === 'object' ? b.page : {}) });
    if (pg.pageless) continue;
    const room = pg.height - pg.margins.top - pg.margins.bottom - band(b.pageHeader, def.sections?.pageHeader) - band(b.pageFooter, def.sections?.pageFooter);
    for (const it of Array.isArray(b.items) ? b.items : []) {
      if (!it || typeof it !== 'object' || ['table', 'matrix', 'list', 'subreport', 'toc'].includes(it.type) || !(Number(it.h) > room + 0.5)) continue;
      const text = it.type === 'textbox' || it.type === 'richtext';
      const msg = `${it.name || it.type}: it is ${Math.round(it.h)} pt tall, taller than the ${Math.round(room)} pt the page has for the body (the page less its margins, page header and footer). ${text ? 'Its text of more than one line continues on the next page; otherwise the lower part of the box is cut at the page bottom' : 'Its lower part is cut at the page bottom'}; make it shorter.`;
      warnings.push(msg); renderSays.push(msg);
    }
  }
  return { errors, warnings, exprErrors, checkOnly, renderSays };
}

/** Keys whose text may hold {expression} parts (a text template). */
const TEMPLATE_KEYS = new Set(['value', 'text', 'label', 'tooltip', 'title', 'noRowsText']);
/**
 * The field names the inline (JSON) data has and the data sets declare, or null when some data is not inline (a
 * database or an API: the fields are not known here, so no field is reported).
 * @param {any} def
 * @returns {Set<string>|null}
 */
function inlineFields(def) {
  const srcs = Array.isArray(def.dataSources) ? def.dataSources : [];
  const names = srcs.length && srcs.every(x => x?.type === 'json' && x.data && typeof x.data === 'object') ? fieldNames(def) : null;
  return names?.size ? names : null;
}
/** Every field name the report knows: the keys of inline (JSON) rows and the data sets' declared fields. */
function fieldNames(def) {
  const names = new Set();
  // a top-level object is one row (a data set at $.meta); a list is rows
  for (const x of Array.isArray(def.dataSources) ? def.dataSources : []) if (x?.type === 'json' && x.data && typeof x.data === 'object') for (const v of Object.values(x.data)) for (const r of (Array.isArray(v) ? v.slice(0, 200) : [v])) if (r && typeof r === 'object' && !Array.isArray(r)) for (const k of Object.keys(r)) names.add(k);
  for (const d of Array.isArray(def.dataSets) ? def.dataSets : []) for (const f of Array.isArray(d?.fields) ? d.fields : []) if (f?.name) names.add(f.name);
  return names;
}
/** The field of that name (any case, as Fields.x reads it) when s is text, not an expression. */
const fieldNamed = (s, known) => typeof s === 'string' && !s.startsWith('=') && [...known].find(k => k.toLowerCase() === s.trim().toLowerCase());
/**
 * A sort "by" a bare field name ("region", not "=Fields.region") sorts by a constant, i.e. not at all: the field is
 * meant, so it sorts by it (validate() warns). def itself when there is none, else a copy with them rewritten.
 * @param {any} def
 */
export function bareSorts(def) {
  const known = fieldNames(def || {}), lists = [];
  for (const d of Array.isArray(def?.dataSets) ? def.dataSets : []) lists.push(d?.sort);
  walkItems(def?.sections, (x) => lists.push(x.sort));
  if (!lists.some(l => Array.isArray(l) && l.some(s => fieldNamed(s?.by, known)))) return def;
  const out = structuredClone(def);
  const fix = (l) => { if (Array.isArray(l)) for (const s of l) if (fieldNamed(s?.by, known)) s.by = `=Fields.${s.by.trim()}`; };
  for (const d of out.dataSets || []) fix(d?.sort);
  walkItems(out.sections, (x) => fix(x.sort));
  return out;
}

/**
 * One item's sizes and references: a zero or negative width or height (a line may be flat), and Fields.x or Parameters.x
 * that the report does not declare. Child items are checked on their own (walkItems), so each is said once.
 * @param {any} it
 * @param {string[]} warnings
 * @param {Set<string>|null} fields
 * @param {Set<string>} params
 */
function itemRefs(it, warnings, fields, params, exprErrors) {
  const label = it.name || it.type;
  if (!/line/i.test(String(it.type))) for (const [k, what] of [['w', 'width'], ['h', 'height']]) {
    if (typeof it[k] === 'number' && it[k] <= 0) warnings.push(`${label}: ${what} is ${it[k]}, so the item is not drawn; give it a positive ${what}`);
  }
  const seen = new Set();
  const scan = (node, depth) => {
    if (depth > 64 || node == null) return;
    if (typeof node === 'string') {
      if (!(node.startsWith('=') || node.includes('{'))) return;
      for (const m of node.matchAll(/\b(Fields|Parameters)\.([A-Za-z_]\w*)/g)) {
        const key = `${m[1]}.${m[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // the same words as the render's own message, so the two are said once (render() drops a repeated warning)
        // a near miss of a declared name (Regoin for Region) is an error; another name stays a warning, as imported
        // reports name their tool's built-in parameters (IS_IGNORE_PAGINATION). render() draws #Error, in the same words
        if (m[1] === 'Parameters' && ![...params].some(p => String(p).toLowerCase() === m[2].toLowerCase())) (didYouMean(m[2], params) ? exprErrors : warnings).push(`${label}: ${noParam(m[2], params)}`);
        if (m[1] === 'Fields' && fields && !fields.has(m[2])) warnings.push(`${label}: The field "${m[2]}" does not exist; check the spelling, or the data set that has it`);
      }
      return;
    }
    if (Array.isArray(node)) { for (const x of node) scan(x, depth + 1); return; }
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) if (k !== 'items' && !(v && typeof v === 'object' && v.type && v.name)) scan(v, depth + 1);
  };
  scan(it, 0);
}

/** fn on an item and every item inside it (containers, lists, table cells). @param {any} it @param {(x: any) => void} fn */
function walkItems(it, fn, depth = 0) {
  if (!it || typeof it !== 'object' || depth > 64) return;
  if (it.type) fn(it);
  for (const v of Object.values(it)) {
    if (Array.isArray(v)) for (const x of v) { if (x && typeof x === 'object') walkItems(x, fn, depth + 1); }
    else if (v && typeof v === 'object') walkItems(v, fn, depth + 1);
  }
}
