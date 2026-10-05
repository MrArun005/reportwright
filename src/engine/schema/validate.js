// @ts-check
import { checkValue, checkFunctions } from '../expr/evaluate.js';
import { ITEMS } from '../items/index.js';

export const SCHEMA_ID = 'pagewright/report@1';

/**
 * Structural checks. Errors stop the render; warnings do not. exprErrors: the errors that are an item's expression
 * that does not parse. They are in `errors` too (the designer shows them), but render() goes on and draws #Error in
 * that item or cell with a warning, as SSRS does.
 * @param {any} def
 */
export function validate(def) {
  const errors = [], warnings = [], exprErrors = [];
  if (!def || typeof def !== 'object') return { errors: ['The report definition is empty'], warnings, exprErrors };
  if (def.$schema && def.$schema !== SCHEMA_ID) warnings.push(`Unknown schema "${def.$schema}". Expected "${SCHEMA_ID}".`);
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
  // is laid out before it is paginated, so they show 1 there. SSRS refuses them; Pagewright warns once per item.
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
      }
    }
  }
  return { errors, warnings, exprErrors };
}
