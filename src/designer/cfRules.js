// @ts-check
// Conditional formatting rules → the style expressions they stand for. The wizard keeps the rules (`cf`) next to the
// expressions it writes, so they reopen as rules; an expression edited by hand no longer matches and shows as custom.
// cf: { mode: 'first' | 'stack', rules: [{ field?: string, op, value?, value2?, n?, format: { color?, backgroundColor?,
//   fontWeight?, fontStyle?, icon?: 'good' | 'warn' | 'bad' } }], databar?: boolean }
import { FUNCTION_NAMES } from '../engine/expr/evaluate.js';

export const CF_OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'between', 'top', 'bottom', 'aboveAvg', 'belowAvg', 'contains', 'startsWith', 'empty', 'notEmpty'];
/** Top/bottom N need a rank function in the expression language; offered once the engine has one. */
export const HAS_RANK = FUNCTION_NAMES.includes('Rank');
export const CF_PROPS = ['color', 'backgroundColor', 'fontWeight', 'fontStyle'];

/** A literal for an expression: a number as it is, =expression as written, text quoted. */
export function literal(v) {
  const s = String(v ?? '').trim();
  if (s.startsWith('=')) return `(${s.slice(1)})`;
  if (s !== '' && !Number.isNaN(Number(s))) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `CDate("${s}")`;
  return `"${s.replace(/"/g, '""')}"`;
}
const str = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * The condition of a rule, as an expression (no leading =).
 * @param {any} r the rule
 * @param {{ subject: string, scope?: string | null, avg?: string }} at subject: what "this value" is (Fields.x or the cell's own expression); scope: the data set, for averages and ranks; avg: the average of "this value" when it is not a row's (a chart point's)
 */
export function condition(r, at) {
  const { subject, scope } = at;
  const s = r.field ? `Fields.${r.field}` : `(${subject})`;
  const sc = scope ? `, ${str(scope)}` : '';
  switch (r.op) {
    case 'eq': return `${s} = ${literal(r.value)}`;
    case 'ne': return `${s} <> ${literal(r.value)}`;
    case 'lt': return `${s} < ${literal(r.value)}`;
    case 'le': return `${s} <= ${literal(r.value)}`;
    case 'gt': return `${s} > ${literal(r.value)}`;
    case 'ge': return `${s} >= ${literal(r.value)}`;
    case 'between': return `${s} >= ${literal(r.value)} And ${s} <= ${literal(r.value2)}`;
    // a chart point's value is an aggregate per category: its average is the scope's total over the categories (at.avg)
    case 'aboveAvg': return `${s} > ${!r.field && at.avg ? at.avg : `Avg(${s}${sc})`}`;
    case 'belowAvg': return `${s} < ${!r.field && at.avg ? at.avg : `Avg(${s}${sc})`}`;
    // Rank is Nothing for a blank value, and Nothing <= n is True in VB: "> 0" leaves blanks out (engine/expr rank())
    case 'top': case 'bottom': { const k = `Rank(${s}${sc}, ${r.op === 'top' ? '"desc"' : '"asc"'})`; return `${k} > 0 And ${k} <= ${Number(r.n) || 1}`; }
    case 'contains': return `InStr(CStr(${s}), ${str(r.value)}) > 0`;
    case 'startsWith': return `StartsWith(CStr(${s}), ${str(r.value)})`;
    case 'empty': return `IsNull(${s}) Or CStr(${s}) = ""`;
    case 'notEmpty': return `Not (IsNull(${s}) Or CStr(${s}) = "")`;
    default: return 'False';
  }
}

/**
 * The style expressions for a set of rules: one per property any rule sets.
 * first: the first rule that matches decides (a later rule's format never mixes in); stack: each property takes the
 * first matching rule that sets it. A property no rule sets is not written.
 * @returns {{ style: Record<string, string>, icon: string | null }}
 */
export function cfExpressions(cf, at) {
  const rules = (cf?.rules || []).filter(r => r && r.op);
  const style = {};
  for (const p of CF_PROPS) {
    if (!rules.some(r => r.format?.[p])) continue;
    let e = 'Nothing';
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i], v = r.format?.[p];
      if (!v && cf.mode === 'stack') continue;
      e = `IIf(${condition(r, at)}, ${v ? str(v) : 'Nothing'}, ${e})`;
    }
    style[p] = `=${e}`;
  }
  // icons: 3 good, 2 warn, 1 bad (an icon set's thresholds 1.5 and 2.5); no rule: no icon
  const LEVEL = { good: 3, warn: 2, bad: 1 };
  let icon = null;
  if (rules.some(r => r.format?.icon)) {
    let e = 'Nothing';
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (!r.format?.icon && cf.mode === 'stack') continue;
      e = `IIf(${condition(r, at)}, ${LEVEL[r.format?.icon] || 'Nothing'}, ${e})`;
    }
    icon = `=${e}`;
  }
  return { style, icon };
}

/** Write the rules into a target (a text box, a cell, a row): its style expressions, an icon or data bar visual, and cf. */
export function applyCf(target, cf, at, { visuals = false } = {}) {
  const prev = target.cf ? cfExpressions(target.cf, at) : { style: {}, icon: null };
  const next = cfExpressions(cf, at);
  target.style ||= {};
  // the wizard's own expressions are replaced; a property it never wrote keeps its value
  for (const p of CF_PROPS) {
    if (prev.style[p] && target.style[p] === prev.style[p]) delete target.style[p];
    if (next.style[p]) target.style[p] = next.style[p];
  }
  if (!Object.keys(target.style).length) delete target.style;
  if (visuals) {
    const ours = target.visual?.cf;
    if (ours) delete target.visual;
    const val = at.subject ? `=${at.subject}` : undefined;
    if (cf.databar && val) target.visual = { type: 'databar', value: val, cf: true };
    else if (next.icon) target.visual = { type: 'iconset', value: next.icon, iconSet: 'trafficLights', lower: '=1.5', upper: '=2.5', cf: true };
  }
  if ((cf.rules || []).length || cf.databar) target.cf = cf; else delete target.cf;
}

/** Style properties written by hand (an expression the rules did not produce): shown as custom in the wizard. */
export function customProps(target, at) {
  const ours = target.cf ? cfExpressions(target.cf, at).style : {};
  return CF_PROPS.filter(p => typeof target.style?.[p] === 'string' && target.style[p].startsWith('=') && target.style[p] !== ours[p]);
}

/** A chart point's average: Sum/Count over the scope divided by its number of categories (null for other aggregates). */
export function pointAverage(subject, category, scope) {
  const m = /^(Sum|Count|CountRows)\((.*)\)$/.exec(String(subject || '').trim());
  if (!m || !category || !scope) return null;
  const sc = `"${scope.replace(/"/g, '""')}"`;
  const total = m[1] === 'CountRows' ? `CountRows(${sc})` : `${m[1]}(${m[2]}, ${sc})`;
  return `${total} / CountDistinct(${String(category).replace(/^=/, '')}, ${sc})`;
}
