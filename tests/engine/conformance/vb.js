// Runs an SSRS (VB) expression the way an imported report runs it: translated by the importer, then evaluated.
import { translateExpression } from '../../../src/importers/rdlx.js';
import { evalValue } from '../../../src/engine/expr/evaluate.js';

export const ROW = { n: null, s: 'abc', zero: 0, d: new Date(2025, 0, 31, 14, 5, 9, 123) };
export const CTX = { fields: ROW, params: {}, globals: { ExecutionTime: new Date(2025, 0, 31, 14, 5, 9) }, dataSets: {}, locale: 'en-US', currency: 'USD' };

/** Translate a VB expression as the importers do and evaluate it. */
export function vb(src, ctx = CTX) {
  const t = translateExpression(src);
  if (!t.ok) throw new Error(`not translated: ${t.notes.join('; ')}`);
  return evalValue(t.value, ctx);
}
