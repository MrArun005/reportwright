// @ts-check
import { checkValue } from '../expr/evaluate.js';
import { ITEMS } from '../items/index.js';

export const SCHEMA_ID = 'pagewright/report@1';

/**
 * Structural checks. Errors stop the render; warnings do not.
 * @param {any} def
 */
export function validate(def) {
  const errors = [], warnings = [];
  if (!def || typeof def !== 'object') return { errors: ['The report definition is empty'], warnings };
  if (def.$schema && def.$schema !== SCHEMA_ID) warnings.push(`Unknown schema "${def.$schema}". Expected "${SCHEMA_ID}".`);
  if (!def.sections || !def.sections.body) errors.push('The report has no body section');

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
    dsNames.add(d.name);
    if (!srcNames.has(d.source)) errors.push(`Data set "${d.name}" uses the source "${d.source}", which does not exist`);
  }

  const names = new Set();
  const check = (where, v, label) => {
    if (v == null) return;
    const err = checkValue(v);
    if (err) errors.push(`${label}: ${err}`);
    else if (where === 'body' && typeof v === 'string' && /Globals\s*\.\s*(PageNumber|TotalPages)/i.test(v)) {
      warnings.push(`${label}: PageNumber and TotalPages work only in the page header and footer`);
    }
  };
  for (const where of ['pageHeader', 'body', 'pageFooter']) {
    const sec = def.sections?.[where];
    if (!sec) continue;
    for (const it of sec.items || []) {
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
      if (it.type === 'table') {
        if (!Array.isArray(it.columns) || !it.columns.length) errors.push(`${label}: the table has no columns`);
        if (where !== 'body') errors.push(`${label}: tables can only be in the body`);
        for (const part of ['header', 'detail', 'footer']) {
          for (const row of it[part] || []) for (const c of row.cells || []) if (c) check(where, c.value, `${label} ${part} cell`);
        }
      }
    }
  }
  return { errors, warnings };
}
