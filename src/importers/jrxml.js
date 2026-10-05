// @ts-check
/**
 * JasperReports importer: a .jrxml design (JasperReports 3 to 6, and the 7.x format with <element kind="…">) becomes a
 * Pagewright report definition.
 *
 * Like rdl.js, a front end: the XML (read safely, see xml.js) is rewritten into the RDLX-JSON shape and rdlx.js does the
 * mapping, the expression translation, the notes and the stats. The bands map as Jasper prints them:
 *   title, then the detail and the groups as a banded list (group header and footer bands around the detail), then
 *   the summary: the body;  page header with the column header below it: the page header;  column footer above the
 *   page footer: the page footer.
 * Java and Groovy expressions become VB (java.js); variables are inlined as aggregates with their reset scope (a sum
 * that resets per group is Sum(…, "Group"); in the detail band it is the running value Jasper prints there).
 * Charts become Pagewright charts directly (their datasets have no RDLX shape). Crosstabs, tables and other
 * components are noted and left out; lists and barcodes are kept.
 *
 * Pure JavaScript, no Node APIs and no DOM. It never throws: whatever it cannot map becomes a warning.
 */
import { parseXml, XmlError } from './xml.js';
import { importRdlx, translateExpression, ImportBudgetError, OUTPUT_LIMITS, reportId, safeName } from './rdlx.js';
import { javaToVb, javaPattern, kindOf, Untranslatable } from './java.js';

const MAX_EXPR = 20_000;
const MAX_DEPTH = 32; // frames in frames
const MAIN = 'Main'; // the report's own data set
const DETAILS = 'Details'; // the banded list: the scope of report totals

/**
 * Convert a JasperReports design.
 * @param {string} input the .jrxml text
 * @param {{ name?: string }} [opts]
 * @returns {{ definition: any, warnings: string[], stats: { items: number, mapped: number, approximated: number, dropped: number }, error?: string }}
 */
export function importJrxml(input, opts = {}) {
  const name = opts.name || 'Imported JasperReports report';
  let root;
  try {
    root = parseXml(stripJasperDoctype(String(input ?? '')));
  } catch (e) {
    const error = e instanceof XmlError ? `The file is not readable XML: ${e.message}` : `The file could not be read (${e instanceof Error ? e.message : e})`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  if (root.name !== 'jasperReport') {
    const error = `The file is not a JasperReports design: its root is <${root.name}>, not <jasperReport>`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {Map<string, any>} chart placeholders → Pagewright charts */
  const charts = new Map();
  let ar;
  try { ar = toRdlx(root, notes, charts, opts.name || root.attrs.name); } catch (e) {
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
  const warnings = [...notes, ...r.warnings].map(w => w.replace(/ActiveReports/g, 'JasperReports'));
  return { definition: r.definition, warnings: [...new Set(warnings)], stats: r.stats };
}

/**
 * Old designs start with <!DOCTYPE jasperReport PUBLIC "…" "…jasperreport.dtd">. A DOCTYPE with no internal subset
 * ("[…]") defines no entities (the external DTD is never fetched), so that one is dropped before the safe reader,
 * which refuses every DOCTYPE. Anything else is left for the reader to refuse.
 */
export function stripJasperDoctype(s) {
  const i = s.indexOf('<!DOCTYPE');
  if (i < 0 || i > 2000) return s;
  const e = s.indexOf('>', i);
  if (e < 0) return s;
  const decl = s.slice(i, e + 1);
  if (decl.includes('[') || !/^<!DOCTYPE\s+jasperReport\s/.test(decl)) return s;
  return s.slice(0, i) + s.slice(e + 1);
}

/* ================================================================ the design → RDLX-JSON */

/**
 * @param {import('./xml.js').XmlElement} root @param {string[]} notes @param {Map<string, any>} charts @param {string} reportName
 */
function toRdlx(root, notes, charts, reportName) {
  const kid = (e, n) => e?.children.find(c => c.name === n);
  const kids = (e, n) => (e ? e.children.filter(c => n == null || c.name === n) : []);
  const txt = (e, n) => { const c = kid(e, n); return c ? c.text : undefined; };
  const A = root.attrs;
  const note = (m) => { if (!notes.includes(m)) notes.push(m); };
  let produced = 0;
  const budget = (s) => { produced += s.length; if (produced > OUTPUT_LIMITS.chars) throw new ImportBudgetError(`its expressions grow past ${OUTPUT_LIMITS.chars / 1e6} million characters`); return s; };

  /* ---------------------------------------------------------------- data: fields, parameters, variables, groups */
  const lang = String(A.language || 'java').toLowerCase();
  if (lang !== 'java' && lang !== 'groovy') note(`Expressions are written in ${A.language}; they are read as Java, so some may show as text.`);
  if (A.scriptletClass || kids(root, 'scriptlet').length) note('The report uses scriptlets (Java code that runs while it fills); Pagewright does not run them, so values they set are missing.');
  if (A.resourceBundle) note(`Texts come from the resource bundle "${A.resourceBundle}"; Pagewright shows the keys instead (put the texts in the report or in parameters).`);

  const fieldKinds = new Map(), paramKinds = new Map();
  const fields = kids(root, 'field');
  for (const f of fields) fieldKinds.set(f.attrs.name, kindOf(f.attrs.class));
  const params = kids(root, 'parameter');
  for (const p of params) paramKinds.set(p.attrs.name, kindOf(p.attrs.class));
  const vars = new Map(kids(root, 'variable').map(v => [v.attrs.name, v]));
  const groups = kids(root, 'group');
  const groupNames = new Set(groups.map(g => g.attrs.name));

  /** an expression element's text: JR7 <expression>, JR6 <…Expression> */
  const exprOf = (e, ...names) => { for (const n of names) { const t = txt(e, n); if (t != null && t.trim() !== '') return t; } return undefined; };

  /**
   * Java → VB in a band context. inDetail: a sum shows the running value; evalLater: evaluated at the end of the
   * report or a group (totals, TotalPages).
   * @param {string} src @param {{ inDetail?: boolean, evalLater?: boolean, chart?: boolean, page?: boolean }} c
   */
  function vb(src, c = {}) {
    if (src.length > MAX_EXPR) throw new Untranslatable(`an expression of ${src.length} characters`);
    const env = {
      notes: [],
      field: (n) => { if (c.page) throw new Untranslatable(`$F{${n}} in a page header or footer (Pagewright page bands show no row values)`); return fieldRef(n, fieldKinds.get(n)); },
      param: (n) => paramRef(n),
      variable: (n) => varRef(n, c, 0),
      resource: (k) => { note('Texts from the resource bundle ($R{…}, str(…)) show their keys.'); return { s: `"${String(k).replace(/"/g, '""')}"`, t: 'str', p: 9 }; },
    };
    const v = javaToVb(src, env);
    if (v.s.length > MAX_EXPR) throw new Untranslatable('an expression that grows too long once its variables are filled in');
    return budget(v.s);
  }
  const fieldRef = (n, k) => ({ s: /^[A-Za-z_]\w*$/.test(n) ? `Fields!${n}.Value` : `Fields("${n.replace(/"/g, '""')}").Value`, t: k || 'any', p: 9 });
  function paramRef(n) {
    if (n === 'REPORT_LOCALE' || n === 'REPORT_TIME_ZONE' || n === 'REPORT_CONNECTION' || n === 'REPORT_DATA_SOURCE' || n === 'REPORT_PARAMETERS_MAP' || n === 'REPORT_SCRIPTLET' || n === 'REPORT_RESOURCE_BUNDLE' || n === 'JASPER_REPORT' || n === 'REPORT_CONTEXT') throw new Untranslatable(`the built-in parameter ${n}`);
    return { s: /^[A-Za-z_]\w*$/.test(n) ? `Parameters!${n}.Value` : `Parameters("${n.replace(/"/g, '""')}").Value`, t: paramKinds.get(n) || 'any', p: 9 };
  }
  const CALC = { Sum: 'Sum', Count: 'Count', DistinctCount: 'CountDistinct', Average: 'Avg', Lowest: 'Min', Highest: 'Max', StandardDeviation: 'StDev', Variance: 'Var', First: 'First' };
  const scopeOf = (v) => {
    const rt = v.attrs.resetType || 'Report';
    if (rt === 'Group' && groupNames.has(v.attrs.resetGroup)) return v.attrs.resetGroup;
    if (rt === 'Page' || rt === 'Column') note(`Variables that restart on each ${rt.toLowerCase()} (${v.attrs.name}) add up over their band's rows instead: Pagewright has no page totals over data rows.`);
    return rt === 'Report' ? DETAILS : null;
  };
  /** $V{name} as VB: built-ins, then the report's variables (inlined) */
  function varRef(n, c, depth) {
    if (depth > 16) throw new Untranslatable('variables that use each other more than 16 deep');
    if (n === 'PAGE_NUMBER' || n === 'MASTER_CURRENT_PAGE') return { s: c.evalLater ? 'Globals!TotalPages' : 'Globals!PageNumber', t: 'num', p: 9 };
    if (n === 'MASTER_TOTAL_PAGES') return { s: 'Globals!TotalPages', t: 'num', p: 9 };
    if (n === 'REPORT_COUNT') {
      if (!(c.inDetail && !c.evalLater)) return { s: `CountRows("${DETAILS}")`, t: 'num', p: 9 };
      if (groups.length) note('Row numbers and running totals over the whole report restart at each group here (REPORT_COUNT, report-wide sums in the detail band).');
      return { s: `RowNumber("${DETAILS}")`, t: 'num', p: 9 };
    }
    const gc = /^(.+)_COUNT$/.exec(n);
    if (gc && groupNames.has(gc[1]) && !vars.has(n)) return { s: c.inDetail && !c.evalLater ? `RowNumber("${gc[1]}")` : `CountRows("${gc[1]}")`, t: 'num', p: 9 };
    if (n === 'PAGE_COUNT' || n === 'COLUMN_COUNT' || n === 'COLUMN_NUMBER') throw new Untranslatable(`the built-in variable ${n}`);
    const v = vars.get(n);
    if (!v) throw new Untranslatable(`the variable ${n}, which is not in the report`);
    const calc = v.attrs.calculation || 'Nothing';
    const e = exprOf(v, 'expression', 'variableExpression');
    if (!e) {
      const init = exprOf(v, 'initialValueExpression');
      if (init && calc === 'Nothing') return sub(init, c, depth);
      if (calc === 'System') throw new Untranslatable(`the variable ${n}, which a scriptlet or subreport sets`);
      throw new Untranslatable(`the variable ${n}, which has no expression`);
    }
    if (calc === 'Nothing') return sub(e, c, depth);
    if (calc === 'System') throw new Untranslatable(`the variable ${n}, which a scriptlet or subreport sets`);
    const agg = CALC[calc];
    if (!agg) throw new Untranslatable(`the ${calc} calculation of ${n}`);
    const inner = sub(e, { ...c, inDetail: false }, depth);
    if (/\b(Sum|Count|CountDistinct|Avg|Min|Max|StDev|Var|First|RunningValue|RowNumber|CountRows)\(/.test(inner.s)) throw new Untranslatable(`the variable ${n}, a total of other totals`);
    if (v.attrs.incrementType && v.attrs.incrementType !== 'None') note(`Variables that add up only at a group or page end (${n}) add up every row in Pagewright.`);
    if (c.chart) return { s: `${agg}(${inner.s})`, t: 'num', p: 9 };
    const scope = scopeOf(v);
    const sc = scope ? `, "${scope}"` : '';
    if (c.inDetail && !c.evalLater) {
      // the detail rows of a group are their own region in Pagewright: a report-wide running total restarts per group
      if (scope === DETAILS && groups.length) note('Row numbers and running totals over the whole report restart at each group here (REPORT_COUNT, report-wide sums in the detail band).');
      return { s: `RunningValue(${inner.s}, ${agg}${sc || `, "${DETAILS}"`})`, t: 'num', p: 9 };
    }
    return { s: `${agg}(${inner.s}${sc})`, t: agg === 'First' ? inner.t : 'num', p: 9 };
  }
  function sub(src, c, depth) {
    const env = {
      notes: [],
      field: (n) => fieldRef(n, fieldKinds.get(n)),
      param: (n) => paramRef(n),
      variable: (n) => varRef(n, c, depth + 1),
    };
    const v = javaToVb(src, env);
    return { ...v, s: `(${v.s})`, p: 9 };
  }

  /** "=vb" for an expression, or the literal text of a string-literal expression; on failure, notes and the source as text */
  function value(src, item, c) {
    if (src == null) return '';
    const s = String(src).trim();
    const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
    if (lit && !/\\u|\$\{/.test(lit[1])) { const t = lit[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1'); return t.startsWith('=') ? `="${t.replace(/"/g, '""')}"` : t; }
    try { return '=' + vb(s, c); } catch (e) {
      if (!(e instanceof Untranslatable)) throw e;
      (item.__notes ||= []).push(`${e.message} has no Pagewright equivalent, so the expression ${s.length > 200 ? s.slice(0, 200) + '…' : s} is shown as text.`);
      return s.startsWith('=') ? `="${s.replace(/"/g, '""')}"` : s;
    }
  }
  /** an expression for a setting (visibility, a group key): "=vb", or undefined with a note */
  function setting(src, item, what, c = {}) {
    try { return '=' + vb(String(src).trim(), c); } catch (e) {
      if (!(e instanceof Untranslatable)) throw e;
      (item.__notes ||= []).push(`${what} uses ${e.message}, which has no Pagewright equivalent, so it is left out.`);
      return undefined;
    }
  }

  /* ---------------------------------------------------------------- styles */

  const styles = new Map(kids(root, 'style').map(s => [s.attrs.name, s]));
  const defStyle = kids(root, 'style').find(s => s.attrs.isDefault === 'true' || s.attrs.default === 'true');
  /** normalised attributes of a style element (JR6 isBold… and JR7 bold… both read), parents first */
  function styleAttrs(name, seen = 0) {
    const s = styles.get(name);
    if (!s || seen > 10) return {};
    const parent = s.attrs.style ? styleAttrs(s.attrs.style, seen + 1) : {};
    return { ...parent, ...normAttrs(s.attrs), ...boxAttrs(kid(s, 'box')), ...paraAttrs(kid(s, 'paragraph')), __cond: [...(parent.__cond || []), ...kids(s, 'conditionalStyle')] };
  }
  const B = (v) => (v == null ? undefined : v === 'true');
  /** element/style attributes → one vocabulary */
  function normAttrs(a) {
    /** @type {Record<string, any>} */
    const o = {};
    const set = (k, v) => { if (v !== undefined && v !== null && v !== '') o[k] = v; };
    set('forecolor', a.forecolor); set('backcolor', a.backcolor); set('mode', a.mode);
    set('fontName', a.fontName); set('fontSize', a.fontSize ?? a.size);
    set('bold', B(a.bold ?? a.isBold)); set('italic', B(a.italic ?? a.isItalic)); set('underline', B(a.underline ?? a.isUnderline)); set('strike', B(a.strikeThrough ?? a.isStrikeThrough));
    set('hAlign', a.hTextAlign ?? a.textAlignment ?? a.hAlign ?? a.horizontalAlignment ?? a.horizontalTextAlign);
    set('vAlign', a.vTextAlign ?? a.verticalAlignment ?? a.vAlign ?? a.verticalTextAlign);
    set('pattern', a.pattern); set('rotation', a.rotation); set('markup', a.markup);
    set('radius', a.radius);
    set('blankWhenNull', B(a.blankWhenNull ?? a.isBlankWhenNull));
    return o;
  }
  function boxAttrs(box) {
    if (!box) return {};
    /** @type {Record<string, any>} */
    const o = {};
    const a = box.attrs;
    for (const [k, side] of [['padding', ''], ['topPadding', 'Top'], ['leftPadding', 'Left'], ['bottomPadding', 'Bottom'], ['rightPadding', 'Right']]) if (a[k] != null) o[`pad${side}`] = Number(a[k]);
    const pen = (e) => (e ? { w: e.attrs.lineWidth, s: e.attrs.lineStyle, c: e.attrs.lineColor } : undefined);
    const p = pen(kid(box, 'pen'));
    if (p) o.pen = p;
    for (const side of ['top', 'left', 'bottom', 'right']) { const s = pen(kid(box, `${side}Pen`)); if (s) o[`${side}Pen`] = s; }
    // JR 3: border="Thin" borderColor=…
    if (a.border && a.border !== 'None') o.pen = { w: { Thin: '0.5', '1Point': '1', '2Point': '2', '4Point': '4', Dotted: '1' }[a.border] || '1', s: a.border === 'Dotted' ? 'Dotted' : 'Solid', c: a.borderColor };
    return o;
  }
  function paraAttrs(p) {
    if (!p) return {};
    /** @type {Record<string, any>} */
    const o = {};
    if (p.attrs.lineSpacing && p.attrs.lineSpacing !== 'Single') o.lineSpacing = p.attrs.lineSpacing;
    if (p.attrs.leftIndent || p.attrs.firstLineIndent || p.attrs.rightIndent) o.indent = true;
    return o;
  }
  const pt = (v) => `${Number(v) || 0}pt`;
  const LS = { Dashed: 'Dashed', Dotted: 'Dotted', Double: 'Double', Solid: 'Solid' };
  const border = (p) => {
    if (!p || (p.w == null && p.c == null && p.s == null)) return undefined;
    const w = p.w == null ? 1 : Number(p.w);
    if (!(w > 0)) return { Style: 'None' };
    return { Style: LS[p.s] || 'Solid', Width: pt(w), ...(p.c ? { Color: p.c } : {}) };
  };
  /** an RDLX Style from merged attributes */
  function rdlxStyle(a, kind, item, c) {
    /** @type {Record<string, any>} */
    const st = {};
    if (a.fontName) st.FontFamily = a.fontName;
    if (a.fontSize) st.FontSize = pt(a.fontSize);
    if (a.bold) st.FontWeight = 'Bold';
    if (a.italic) st.FontStyle = 'Italic';
    if (a.underline) st.TextDecoration = 'Underline'; else if (a.strike) st.TextDecoration = 'LineThrough';
    if (a.forecolor) st.Color = a.forecolor;
    const opaque = a.mode ? a.mode === 'Opaque' : kind === 'rectangle' || kind === 'ellipse';
    if (opaque) st.BackgroundColor = a.backcolor || '#FFFFFF';
    if (a.hAlign) st.TextAlign = { Left: 'Left', Center: 'Center', Right: 'Right', Justified: 'Justify' }[a.hAlign] || undefined;
    if (a.vAlign) st.VerticalAlign = { Top: 'Top', Middle: 'Middle', Bottom: 'Bottom', Justified: 'Top' }[a.vAlign] || undefined;
    for (const side of ['', 'Top', 'Left', 'Bottom', 'Right']) {
      const v = a[`pad${side}`];
      if (v != null) { if (side) st[`Padding${side}`] = pt(v); else for (const s of ['Top', 'Left', 'Bottom', 'Right']) st[`Padding${s}`] ??= pt(v); }
    }
    const b = border(a.pen);
    if (b) st.Border = b;
    for (const side of ['top', 'left', 'bottom', 'right']) { const x = border(a[`${side}Pen`]); if (x) st[`${side[0].toUpperCase()}${side.slice(1)}Border`] = x; }
    // conditional styles: colours and bold as IIF(condition, …, …), the last true condition winning as in Jasper
    for (const cs of a.__cond || []) {
      const cond = exprOf(cs, 'conditionExpression');
      const sa = normAttrs({ ...cs.attrs, ...(kid(cs, 'style')?.attrs || {}) });
      if (!cond) continue;
      let ce;
      try { ce = vb(cond, c); } catch (e) {
        if (!(e instanceof Untranslatable)) throw e;
        (item.__notes ||= []).push(`a conditional style uses ${e.message}, so it is left out.`);
        continue;
      }
      const iif = (k, v, base) => { st[k] = `=IIF(${ce}, "${v}", ${base == null ? '""' : String(base).startsWith('=') ? String(base).slice(1) : `"${base}"`})`; };
      if (sa.forecolor) iif('Color', sa.forecolor, st.Color ?? '#000000');
      if (sa.backcolor) iif('BackgroundColor', sa.backcolor, st.BackgroundColor ?? 'Transparent');
      if (sa.bold != null) iif('FontWeight', sa.bold ? 'Bold' : 'Normal', st.FontWeight ?? 'Normal');
      if (sa.italic != null) iif('FontStyle', sa.italic ? 'Italic' : 'Normal', st.FontStyle ?? 'Normal');
    }
    return st;
  }

  /* ---------------------------------------------------------------- elements */

  const JR6_KINDS = new Set(['textField', 'staticText', 'image', 'line', 'rectangle', 'ellipse', 'frame', 'elementGroup', 'subreport', 'break', 'crosstab', 'componentElement', 'genericElement', 'part']);
  const CHART6 = /^(pie|pie3D|bar|bar3D|stackedBar|stackedBar3D|line|area|stackedArea|xyArea|xyBar|xyLine|timeSeries|scatter|bubble|meter|thermometer|candlestick|highLow|gantt|multiAxis)Chart$/;
  /** one element in either format → { kind, a (attributes), el (the element), re (its reportElement or itself), children } */
  function norm(e) {
    if (e.name === 'element') {
      const kind = e.attrs.kind;
      return { kind: kind === 'chart' ? 'chart' : kind, chartType: e.attrs.chartType, a: { ...e.attrs, ...normAttrs(e.attrs) }, el: e, re: e };
    }
    if (e.name === 'part') { // a book's part (sectionType="Part"): a report on pages of its own
      partSeq++;
      return { kind: 'part', a: { ...e.attrs, x: 0, y: (partSeq - 1) * PART_H, width: colW, height: PART_H }, el: e, re: e };
    }
    if (JR6_KINDS.has(e.name) || CHART6.test(e.name)) {
      const re = CHART6.test(e.name) ? kid(kid(e, 'chart'), 'reportElement') : kid(e, 'reportElement');
      const te = kid(e, 'textElement');
      const font = kid(te, 'font');
      const g = kid(e, 'graphicElement');
      /** @type {Record<string, any>} */
      const a = { ...(re?.attrs || {}), ...e.attrs, ...normAttrs({ ...(re?.attrs || {}), ...e.attrs, ...(te?.attrs || {}), ...(font?.attrs || {}) }) };
      if (g?.attrs.pen) a.pen6 = g.attrs.pen;
      const gp = kid(g, 'pen');
      if (gp) a.linePen = { w: gp.attrs.lineWidth, s: gp.attrs.lineStyle, c: gp.attrs.lineColor };
      return { kind: CHART6.test(e.name) ? 'chart' : e.name, chartType: CHART6.test(e.name) ? e.name.replace(/Chart$/, '') : undefined, a, el: e, re: re || e, te };
    }
    return null;
  }
  const elementsOf = (container) => container ? container.children.filter(c => c.name === 'element' || JR6_KINDS.has(c.name) || CHART6.test(c.name)) : [];
  let seq = 0, partSeq = 0;
  const PART_H = 20;
  const NAME_OK = /^[A-Za-z_][\w]{0,60}$/;
  const nameFor = (n, kind) => (n.a.key && NAME_OK.test(n.a.key) ? n.a.key : `${kind[0].toUpperCase()}${kind.slice(1)}${++seq}`);

  /**
   * Elements of a band or frame → RDLX report items.
   * @param {any} container @param {{ inDetail?: boolean, page?: boolean, depth?: number, dataSet?: string }} c
   */
  function items(container, c = {}) {
    const out = [];
    for (const e of elementsOf(container)) {
      const n = norm(e);
      if (!n) continue;
      if (n.kind === 'elementGroup') { out.push(...items(e, c)); continue; }
      const it = item(n, c);
      if (it) out.push(it);
    }
    return out;
  }

  /** @param {any} n @param {any} c */
  function item(n, c) {
    const a = n.a, re = n.re, e = n.el;
    const base = { Name: nameFor(n, n.kind), Left: pt(a.x), Top: pt(a.y), Width: pt(a.width), Height: pt(a.height) };
    /** @type {Record<string, any>} */
    const it = { ...base };
    const st = { ...(defStyle ? styleAttrs(defStyle.attrs.name) : {}), ...(a.style ? styleAttrs(a.style) : {}), ...stripUndef(normAttrs(re.attrs === e.attrs ? e.attrs : { ...re.attrs, ...e.attrs, ...(n.te?.attrs || {}), ...(kid(n.te, 'font')?.attrs || {}) })), ...boxAttrs(kid(e, 'box')) };
    if (a.style && !styles.has(a.style)) (it.__notes ||= []).push(`its style "${a.style}" is not in the file (a style template?), so it has the default style.`);
    const evalLater = /^(Report|Group|Page|Column|Auto)$/.test(a.evaluationTime || '');
    const ctx = { ...c, evalLater };
    const pw = exprOf(re, 'printWhenExpression') ?? exprOf(e, 'printWhenExpression');
    if (pw) { const v = setting(pw, it, 'the condition that prints it', ctx); if (v) it.Visibility = { Hidden: `=Not (${v.slice(1)})` }; }
    if (a.positionType === 'FixRelativeToBottom') (it.__notes ||= []).push('it stays at the bottom of a band that grows in JasperReports; here it keeps its place.');
    if (a.rotation && a.rotation !== 'None') (it.__notes ||= []).push(`its text is rotated (${a.rotation}) in JasperReports; here it is not.`);
    switch (n.kind) {
      case 'staticText': {
        it.Type = 'textbox';
        const t = txt(e, 'text') ?? '';
        it.Value = t.startsWith('=') ? `="${t.replace(/"/g, '""')}"` : t;
        it.CanGrow = false;
        it.Style = rdlxStyle(st, 'text', it, ctx);
        if (st.markup && st.markup !== 'none') (it.__notes ||= []).push(`its text is ${st.markup} markup; Pagewright shows it as plain text.`);
        return it;
      }
      case 'textField': {
        it.Type = 'textbox';
        const src = exprOf(e, 'expression', 'textFieldExpression');
        it.Value = value(src ?? '', it, ctx);
        it.CanGrow = a.isStretchWithOverflow === 'true' || /StretchHeight/.test(a.textAdjust || '') || a.stretchWithOverflow === 'true';
        const style = rdlxStyle(st, 'text', it, ctx);
        const pat = exprOf(e, 'patternExpression');
        if (st.pattern) style.Format = javaPattern(st.pattern, kindOfExpr(src));
        if (pat) (it.__notes ||= []).push('its format is set by an expression (patternExpression); it is left out.');
        it.Style = style;
        if (st.markup && st.markup !== 'none') (it.__notes ||= []).push(`its text is ${st.markup} markup; Pagewright shows it as plain text.`);
        link(e, it, ctx);
        return it;
      }
      case 'image': {
        it.Type = 'image';
        const src = exprOf(e, 'expression', 'imageExpression') ?? '';
        const fk = /^\s*\$F\{([^}]+)\}\s*$/.exec(src);
        if (fk) { it.Source = 'Database'; it.Value = `=${fieldRef(fk[1]).s}`; }
        else { it.Source = 'External'; it.Value = value(src, it, ctx); }
        it.Sizing = { RetainShape: 'FitProportional', FillFrame: 'Fit', Clip: 'Clip', RealSize: 'AutoSize', RealHeight: 'AutoSize' }[a.scaleImage || 'RetainShape'] || 'FitProportional';
        it.Style = rdlxStyle(st, 'image', it, ctx);
        link(e, it, ctx);
        return it;
      }
      case 'line': {
        it.Type = 'line';
        const w = Number(a.width) || 0, h = Number(a.height) || 0;
        const x = Number(a.x) || 0, y = Number(a.y) || 0;
        const p = a.linePen || st.pen || {};
        // a 1-point-high line is a horizontal rule (Jasper draws it along the top), a 1-wide one vertical
        if (h <= 1) { it.StartPoint = { X: pt(x), Y: pt(y) }; it.EndPoint = { X: pt(x + w), Y: pt(y) }; }
        else if (w <= 1) { it.StartPoint = { X: pt(x), Y: pt(y) }; it.EndPoint = { X: pt(x), Y: pt(y + h) }; }
        else if (a.direction === 'BottomUp') { it.StartPoint = { X: pt(x), Y: pt(y + h) }; it.EndPoint = { X: pt(x + w), Y: pt(y) }; }
        else { it.StartPoint = { X: pt(x), Y: pt(y) }; it.EndPoint = { X: pt(x + w), Y: pt(y + h) }; }
        it.LineColor = p.c || st.forecolor || '#000000';
        it.LineWidth = pt(p.w ?? 1);
        it.LineStyle = LS[p.s] || 'Solid';
        return it;
      }
      case 'rectangle': case 'ellipse': {
        it.Type = 'shape';
        it.Shape = n.kind === 'ellipse' ? 'Ellipse' : Number(st.radius) > 0 ? 'RoundRect' : 'Rectangle';
        if (Number(st.radius) > 0) it.RoundingRadius = pt(st.radius);
        const style = rdlxStyle(st, n.kind, it, ctx);
        const p = a.linePen || st.pen || {};
        style.Border = Number(p.w ?? 1) > 0 ? { Style: LS[p.s] || 'Solid', Width: pt(p.w ?? 1), Color: p.c || st.forecolor || '#000000' } : { Style: 'None' };
        it.Style = style;
        return it;
      }
      case 'frame': {
        if ((c.depth || 0) >= MAX_DEPTH) { it.Type = 'rectangle'; it.__drop = `frames are nested more than ${MAX_DEPTH} deep, so this one was left out.`; return it; }
        it.Type = 'rectangle';
        it.ReportItems = items(e, { ...c, depth: (c.depth || 0) + 1 });
        it.Style = rdlxStyle(st, 'frame', it, ctx);
        return it;
      }
      case 'subreport': {
        it.Type = 'subreport';
        const src = exprOf(e, 'expression', 'subreportExpression') ?? '';
        const lit = /^\s*"([^"]+)"\s*$/.exec(src);
        if (lit) it.ReportName = lit[1];
        else {
          const pm = /^\s*\$P\{([^}]+)\}\s*$/.exec(src);
          it.ReportName = pm ? pm[1] : 'subreport';
          (it.__notes ||= []).push(`the subreport is chosen at run time (${src.trim().slice(0, 120)}); it shows the report "${reportId(it.ReportName)}", so import that one under this id.`);
        }
        it.Parameters = [];
        for (const p of [...kids(e, 'subreportParameter'), ...kids(e, 'parameter')]) {
          const pe = exprOf(p, 'expression', 'subreportParameterExpression');
          if (!p.attrs.name || pe == null) continue;
          const v = value(pe, it, ctx);
          it.Parameters.push({ ParameterName: p.attrs.name, Value: v });
        }
        if (exprOf(e, 'dataSourceExpression') || exprOf(e, 'connectionExpression')) (it.__info ||= []).push('JasperReports passes it a data source or connection; in Pagewright the subreport reads its own data sets.');
        if (kids(e, 'returnValue').length) (it.__notes ||= []).push('it returns values to the master report (returnValue); Pagewright subreports return nothing.');
        return it;
      }
      case 'part': {
        const sp = e.children.find(x => x.name === 'subreportPart') || e.children.find(x => x.name !== 'property' && x.name !== 'partNameExpression');
        if (!sp || sp.name !== 'subreportPart') { it.Type = 'part'; it.__drop = `a book part of the kind "${sp?.name || '?'}" is not supported, so it was left out.`; return it; }
        const r = item({ kind: 'subreport', a, el: sp, re: sp }, c);
        r.PageBreakAtStart = true;
        const label = exprOf(e, 'partNameExpression');
        if (label) r.Label = value(label, r, ctx);
        return r;
      }
      case 'break':
        if (a.type === 'Column') { it.Type = 'rectangle'; it.__drop = 'a column break: Pagewright prints one column, so it was left out.'; return it; }
        return { ...base, Type: 'rectangle', Width: '0pt', Height: '0pt', PageBreakAtStart: true, ReportItems: [] };
      case 'chart': return chart(n, it, c);
      case 'crosstab':
        it.Type = 'crosstab';
        it.__drop = 'a crosstab is not converted; rebuild it as a matrix (row and column groups).';
        return it;
      case 'componentElement': case 'component': return component(n, it, c);
      case 'list': case 'table': return component(n, it, c);
      case 'genericElement':
        it.Type = 'genericElement';
        it.__drop = 'a generic element (drawn by an exporter plug-in) has no Pagewright equivalent, so it was left out.';
        return it;
    }
    it.Type = String(n.kind);
    it.__drop = `the element "${n.kind}" is not supported, so it was left out.`;
    return it;
  }
  const stripUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  /** the kind of value an expression gives, for its pattern: a field's class, else a guess */
  function kindOfExpr(src) {
    const m = /^\s*\$([FPV])\{([^}]+)\}\s*$/.exec(src || '');
    if (m?.[1] === 'F') return fieldKinds.get(m[2]) || 'any';
    if (m?.[1] === 'P') return paramKinds.get(m[2]) || 'any';
    if (m?.[1] === 'V') { const v = vars.get(m[2]); return v ? kindOf(v.attrs.class) : m[2].endsWith('_COUNT') || m[2] === 'PAGE_NUMBER' ? 'num' : 'any'; }
    return 'any';
  }
  /** hyperlinks, anchors and tooltips */
  function link(e, it, c) {
    const type = e.attrs.hyperlinkType || (kid(e, 'hyperlink')?.attrs.hyperlinkType);
    const ref = exprOf(e, 'hyperlinkReferenceExpression');
    const anchor = exprOf(e, 'hyperlinkAnchorExpression');
    const tip = exprOf(e, 'hyperlinkTooltipExpression');
    const name = exprOf(e, 'anchorNameExpression');
    if ((type === 'Reference' || (!type && ref)) && ref) it.Action = { Hyperlink: value(ref, it, c) };
    else if (type === 'LocalAnchor' && anchor) it.Action = { BookmarkLink: value(anchor, it, c) };
    else if (type && type !== 'None' && type !== 'NullHyperlink') (it.__notes ||= []).push(`its ${type} link is not converted.`);
    if (tip) it.ToolTip = value(tip, it, c);
    if (name) it.Bookmark = value(name, it, c);
    if (e.attrs.bookmarkLevel && name) it.Label = it.Bookmark;
  }

  /* ---------------------------------------------------------------- charts */

  const CHART_TYPES = {
    pie: 'pie', pie3D: 'pie', bar: 'column', bar3D: 'column', stackedBar: 'column', stackedBar3D: 'column', line: 'line', area: 'area',
    stackedArea: 'area', xyArea: 'area', xyBar: 'column', xyLine: 'line', timeSeries: 'line', scatter: 'scatter', bubble: 'bubble',
    meter: 'gauge', thermometer: 'gauge', candlestick: 'candlestick', highLow: 'ohlc', gantt: 'gantt',
  };
  const pwExpr = (vbExpr) => { const r = translateExpression(`=${vbExpr}`, {}); return r.ok ? r.value : undefined; };
  function chart(n, it, c) {
    const e = n.el, type = n.chartType;
    it.Type = 'rectangle';
    it.ReportItems = [];
    const pwType = CHART_TYPES[type];
    if (!pwType) { it.__drop = `a ${type} chart has no Pagewright equivalent, so it was left out.`; return it; }
    const key = `pwchart§${charts.size + 1}`;
    const chartName = it.Name;
    it.Name = key;
    const plotEl = e.children.find(x => /Plot$/.test(x.name)) || kid(e, 'plot');
    const plot = { ...(kid(plotEl, 'plot')?.attrs || {}), ...(plotEl?.attrs || {}) };
    // the dataset: JR6 <pieDataset>/<categoryDataset>… with <dataset>, JR7 <dataset kind="…">
    const dsEl = e.children.find(x => /Dataset$/.test(x.name)) || kid(e, 'dataset');
    const inner = kid(dsEl, 'dataset') || dsEl;
    const run = kid(inner, 'datasetRun');
    const dataSet = run?.attrs.subDataset || MAIN;
    if (run && kids(run, 'datasetParameter').length) (it.__notes ||= []).push('the chart passes parameters to its data set; Pagewright reads that data set as it is.');
    const seriesEls = dsEl ? dsEl.children.filter(x => /^(categorySeries|xySeries|xyzSeries|timeSeries|timePeriodSeries|ganttSeries|series)$/.test(x.name)) : [];
    if (!seriesEls.length && dsEl) seriesEls.push(dsEl); // a pie: key and value on the dataset itself
    const cc = { chart: true };
    const conv = (src, what) => {
      if (src == null) return undefined;
      try { const x = pwExpr(vb(src, cc)); if (x === undefined) throw new Untranslatable(what); return x; } catch (er) {
        if (!(er instanceof Untranslatable)) throw er;
        (it.__notes ||= []).push(`the chart's ${what} uses ${er.message}, so it is left out.`);
        return undefined;
      }
    };
    /** @type {Record<string, any>} */
    const out = { type: 'chart', name: chartName, chartType: pwType, dataSet, series: [], legend: e.attrs.isShowLegend === 'false' || e.attrs.showLegend === 'false' || kid(e, 'chart')?.attrs.isShowLegend === 'false' ? 'none' : 'bottom' };
    if (/^stacked/.test(type)) out.stacked = true;
    if ((type === 'bar' || type === 'bar3D' || type === 'stackedBar' || type === 'stackedBar3D') && /Horizontal/i.test(plot.orientation || '')) out.chartType = 'bar';
    if (/3D/.test(type)) (it.__notes ||= []).push('it is a 3D chart in JasperReports; Pagewright draws it flat.');
    const title = exprOf(kid(kid(e, 'chart'), 'chartTitle'), 'titleExpression') ?? exprOf(e, 'titleExpression');
    if (title) { const t = /^\s*"([^"]*)"\s*$/.exec(title); out.title = t ? t[1] : conv(title, 'title') ?? ''; }
    let category, groupBy;
    for (const s of seriesEls) {
      const catSrc = exprOf(s, 'categoryExpression', 'keyExpression', 'xValueExpression', 'timePeriodExpression', 'taskExpression');
      const valSrc = exprOf(s, 'valueExpression', 'yValueExpression', 'closeExpression');
      const serSrc = exprOf(s, 'seriesExpression');
      if (catSrc != null && category == null) category = conv(catSrc, 'category');
      if (valSrc == null) continue;
      let v;
      try {
        const raw = vb(valSrc, cc);
        v = pwExpr(/\b(Sum|Count|CountDistinct|Avg|Min|Max|StDev|Var|First)\(/.test(raw) ? raw : `Sum(${raw})`);
      } catch (er) { if (!(er instanceof Untranslatable)) throw er; (it.__notes ||= []).push(`a series value uses ${er.message}, so that series is left out.`); }
      if (v === undefined) continue;
      const lit = serSrc != null ? /^\s*"([^"]*)"\s*$/.exec(serSrc) : null;
      if (serSrc != null && !lit) { groupBy ??= conv(serSrc, 'series'); }
      out.series.push({ name: lit ? lit[1] : `Series${out.series.length + 1}`, value: v });
      if (pwType === 'bubble') { const z = exprOf(s, 'zValueExpression'); if (z) out.series[out.series.length - 1].size = conv(z, 'bubble size'); }
    }
    if (pwType === 'gauge') {
      const val = exprOf(dsEl, 'valueExpression') ?? exprOf(kid(dsEl, 'valueDataset'), 'valueExpression', 'expression');
      if (val) { const v = conv(val, 'value'); if (v !== undefined) out.series = [{ name: 'Value', value: v }]; }
    }
    if (category !== undefined) {
      if (pwType === 'scatter' || pwType === 'bubble') out.xValue = category;
      else out.category = category;
      if (/^(timeSeries|xyLine|xyArea|xyBar)$/.test(type)) out.categorySort = 'asc';
    }
    if (groupBy !== undefined && out.series.length === 1) out.seriesGroup = groupBy;
    if (!out.series.length) (it.__notes ||= []).push('no series of the chart could be converted, so it is empty.');
    if (/candlestick|highLow|gantt/.test(type)) (it.__notes ||= []).push(`its ${type} values are read as one series; check the chart.`);
    charts.set(key, out);
    return it;
  }

  /* ---------------------------------------------------------------- components: list, barcodes; tables are noted */

  function component(n, it, c) {
    const e = n.el;
    const comp = e.name === 'element' ? (kid(e, 'component') || e) : e.children.find(x => x.name !== 'reportElement');
    const kind = (comp?.attrs.kind || comp?.name || '').toLowerCase();
    if (kind === 'list') {
      const run = kid(comp, 'datasetRun');
      const contents = kid(comp, 'listContents') || kid(comp, 'contents') || comp;
      it.Type = 'list';
      it.DataSetName = run?.attrs.subDataset || MAIN;
      it.ReportItems = items(contents, { ...c, inDetail: true, depth: (c.depth || 0) + 1 });
      if (run && kids(run, 'datasetParameter').length) (it.__notes ||= []).push('the list passes parameters to its data set; Pagewright reads that data set as it is (add a filter if it should show related rows only).');
      if (comp.attrs.printOrder === 'Horizontal') (it.__notes ||= []).push('its rows go across in JasperReports; here they go down.');
      return it;
    }
    if (kind === 'barbecue' || kind === 'barcode4j' || /^(code128|code39|ean13|ean8|upca|qrcode|datamatrix|pdf417|interleaved2of5|codabar|ean128)$/.test(kind)) {
      it.Type = 'barcode';
      const sym = (comp.attrs.type || kind).toLowerCase();
      it.Symbology = { code128: 'Code128', '128': 'Code128', code39: 'Code39', '3of9': 'Code39', ean13: 'EAN_13', ean8: 'EAN_8', upca: 'UPC_A', qrcode: 'QRCode', datamatrix: 'DataMatrix', pdf417: 'PDF417', ean128: 'GS1_128', int2of5: 'ITF14', interleaved2of5: 'ITF14' }[sym.replace(/[^a-z0-9]/g, '')] || 'Code128';
      it.Value = value(exprOf(comp, 'codeExpression', 'expression') ?? '', it, c);
      return it;
    }
    it.Type = kind || 'component';
    it.__drop = kind === 'table'
      ? 'a table component is not converted; rebuild it as a Pagewright table (its columns and cells are in the design).'
      : `the component "${kind || '?'}" has no Pagewright equivalent, so it was left out.`;
    return it;
  }

  /* ---------------------------------------------------------------- bands */

  /** a section element's band (JR6 <title><band>, JR7 <title height>) and its height */
  const bandOf = (sec) => { if (!sec) return null; const b = kid(sec, 'band'); return b || sec; };
  const bandH = (b) => Number(b?.attrs.height) || 0;
  /** several bands (detail, group header/footer can hold more than one) stacked into one, each band's printWhen kept */
  function stack(sec, c) {
    const bands = sec ? (kids(sec, 'band').length ? kids(sec, 'band') : [sec]) : [];
    let y = 0;
    const out = [];
    for (const b of bands) {
      partSeq = 0;
      const its = items(b, c);
      const h = bandH(b) || partSeq * PART_H;
      const pw = exprOf(b, 'printWhenExpression');
      if (pw) {
        /** @type {Record<string, any>} */
        const box = { Type: 'rectangle', Name: `Band${++seq}`, Left: '0pt', Top: pt(y), Width: pt(colW), Height: pt(h), ReportItems: its };
        const v = setting(pw, box, 'the condition that prints the band', c);
        if (v) box.Visibility = { Hidden: `=Not (${v.slice(1)})` };
        out.push(box);
      } else for (const i of its) out.push(shift(i, y));
      y += h;
    }
    return { h: y, items: out };
  }
  /** a copy of an item tree with fresh names (names are unique in a report) */
  const rename = (i) => ({ ...i, Name: `${i.Name}_1`, ...(Array.isArray(i.ReportItems) ? { ReportItems: i.ReportItems.map(rename) } : {}) });
  const shift = (i, dy) => {
    if (!dy) return i;
    const add = (v) => pt((parseFloat(v) || 0) + dy);
    const o = { ...i, Top: add(i.Top) };
    if (i.StartPoint) { o.StartPoint = { ...i.StartPoint, Y: add(i.StartPoint.Y) }; o.EndPoint = { ...i.EndPoint, Y: add(i.EndPoint.Y) }; }
    return o;
  };

  const pageW = Number(A.pageWidth) || 595, pageH = Number(A.pageHeight) || 842;
  const lm = Number(A.leftMargin ?? 20), rm = Number(A.rightMargin ?? 20), tm = Number(A.topMargin ?? 30), bm = Number(A.bottomMargin ?? 30);
  const colW = Number(A.columnWidth) || pageW - lm - rm;
  const cols = Number(A.columnCount) || 1;
  if (cols > 1) note(`The detail prints in ${cols} columns in JasperReports; it prints in ${cols} columns here too, filled down the page first.`);
  if (A.printOrder === 'Horizontal') note('Columns fill across in JasperReports; here they fill down.');

  const title = stack(kid(root, 'title'), {});
  const pageHeader = stack(kid(root, 'pageHeader'), { page: true });
  const colHeader = stack(kid(root, 'columnHeader'), { page: true });
  const colFooter = stack(kid(root, 'columnFooter'), { page: true });
  const pageFooter = stack(kid(root, 'pageFooter'), { page: true });
  const lastPageFooter = kid(root, 'lastPageFooter');
  if (lastPageFooter && bandH(bandOf(lastPageFooter))) note('The last page footer is not converted: every page gets the page footer.');
  const summary = stack(kid(root, 'summary'), {});
  const detail = stack(kid(root, 'detail'), { inDetail: true });
  for (const [k, what] of [['background', 'The background band (a watermark)'], ['noData', 'The "no data" band']]) if (kid(root, k) && bandH(bandOf(kid(root, k)))) note(`${what} is not converted.`);
  if (colHeader.items.length) note('The column header is printed at the top of every page, as part of the page header.');

  /** @type {any[]} */
  const Groups = groups.map((g) => {
    const key = exprOf(g, 'expression', 'groupExpression');
    /** @type {Record<string, any>} */
    const G = { Group: { Name: g.attrs.name, GroupExpressions: [] } };
    if (key) {
      const v = setting(key, G, `The group "${g.attrs.name}"`, {});
      if (v) G.Group.GroupExpressions.push(v);
      for (const n of G.__notes || []) note(n);
    }
    const h = stack(kid(g, 'groupHeader'), {});
    const f = stack(kid(g, 'groupFooter'), {});
    G.Header = { Height: pt(h.h), ReportItems: h.items };
    G.Footer = { Height: pt(f.h), ReportItems: f.items };
    if (g.attrs.isStartNewPage === 'true' || g.attrs.startNewPage === 'true') G.Group.PageBreak = { BreakLocation: 'Between' };
    if (g.attrs.isReprintHeaderOnEachPage === 'true' || g.attrs.reprintHeaderOnEachPage === 'true') G.Header.RepeatOnNewPage = true;
    if (g.attrs.keepTogether === 'true') G.KeepTogether = true;
    if (g.attrs.isStartNewColumn === 'true' || g.attrs.startNewColumn === 'true') note(`The group "${g.attrs.name}" starts a new column in JasperReports; here it does not.`);
    return G;
  });
  const sorts = kids(root, 'sortField').map(s => {
    if (s.attrs.type === 'Variable') { note(`Rows are sorted by the variable ${s.attrs.name} in JasperReports; that sort is left out.`); return null; }
    return { Value: `=${fieldRef(s.attrs.name).s}`, Direction: s.attrs.order === 'Descending' ? 'Descending' : 'Ascending' };
  }).filter(Boolean);

  /** @type {any[]} */
  const body = [];
  let y = 0;
  for (const i of title.items) body.push(shift(i, y));
  y += title.h;
  const titleNewPage = A.isTitleNewPage === 'true' || A.titleNewPage === 'true';
  if (titleNewPage) body.push({ Type: 'rectangle', Name: `Break${++seq}`, Left: '0pt', Top: pt(y), Width: '0pt', Height: '0pt', PageBreakAtStart: true, ReportItems: [] });
  // Jasper prints the title above the page header on page 1: there the page and column headers follow the title in the
  // body (a copy), and the page header band starts on page 2
  const headFirst = title.h > 0 && !titleNewPage && pageHeader.h + colHeader.h > 0;
  if (headFirst) {
    const copy = (list, dy) => list.map(i => shift(rename(i), dy));
    body.push(...copy(pageHeader.items, y), ...copy(colHeader.items, y + pageHeader.h));
    y += pageHeader.h + colHeader.h;
  }
  const listH = detail.h + Groups.reduce((s, g) => s + (parseFloat(g.Header.Height) || 0) + (parseFloat(g.Footer.Height) || 0), 0);
  if (detail.items.length || Groups.length) {
    body.push({ Type: 'bandedlist', Name: DETAILS, DataSetName: MAIN, Left: '0pt', Top: pt(y), Width: pt(colW), Height: pt(listH),
      Details: { Height: pt(detail.h), ReportItems: detail.items }, Groups, ...(sorts.length ? { SortExpressions: sorts } : {}) });
    y += listH;
  }
  const sumNewPage = A.isSummaryNewPage === 'true' || A.summaryNewPage === 'true';
  if (summary.items.length) {
    body.push({ Type: 'rectangle', Name: 'Summary', Left: '0pt', Top: pt(y), Width: pt(colW), Height: pt(summary.h), ReportItems: summary.items, ...(sumNewPage ? { PageBreakAtStart: true } : {}) });
    y += summary.h;
  }
  if (cols > 1 && Groups.length + detail.items.length === 0) note('Columns apply to the detail only.');

  /* ---------------------------------------------------------------- data sources and sets */

  const DataSources = [], DataSets = [];
  const queryOf = (ds) => kid(ds, 'queryString') || kid(ds, 'query');
  const addSet = (name, ds) => {
    const q = queryOf(ds);
    const ql = String(q?.attrs.language || 'sql').toLowerCase();
    const sql = q && q.text.trim() && (ql === 'sql' || ql === 'hql' || ql === 'plsql');
    const xpath = ql === 'xpath' || ql === 'xpath2'; // an XML data source: the query picks the rows, fieldDescription the fields
    const srcName = name === MAIN ? 'JasperDataSource' : `${name}Source`;
    /** @type {Record<string, any>} */
    const set = { Name: name, Fields: kids(ds, 'field').map(f => {
      const desc = txt(f, 'fieldDescription') ?? txt(f, 'description');
      const k = kindOf(f.attrs.class);
      const t = { num: /Integer|Long|Short|Byte/.test(f.attrs.class || '') ? 'Integer' : 'Float', date: 'Date', bool: 'Boolean' }[k];
      return { Name: f.attrs.name, DataField: (!sql && desc ? desc.trim() : f.attrs.name) + (t ? `[${t}]` : '') };
    }), Query: { DataSourceName: srcName, CommandText: '' } };
    if (sql) {
      let text = q.text.trim();
      if (/\$P!\{/.test(text)) note(`Data set "${name}": its SQL pastes parameters in as text ($P!{…}); Pagewright binds @parameters only, so check the query.`);
      if (/\$X\{/.test(text)) note(`Data set "${name}": its SQL uses $X{…} clauses; rewrite them with @parameters.`);
      text = text.replace(/\$P\{([^}]+)\}/g, (_, p) => `@${safeName(p)}`);
      set.Query.CommandText = text;
      DataSources.push({ Name: srcName, ConnectionProperties: { DataProvider: 'SQL', ConnectString: '' } });
    } else if (xpath) {
      set.Query.CommandText = q?.text.trim() || '';
      const at = String(root.children.find(c => c.name === 'property' && c.attrs.name === 'net.sf.jasperreports.xml.source')?.attrs.value || '').trim();
      if (!at) note(`Data set "${name}": JasperReports gets its XML from Java code; set the XML source's URL in Pagewright.`);
      DataSources.push({ Name: srcName, ConnectionProperties: { DataProvider: 'XML', ConnectString: at ? `XmlDoc=${at}` : '' } });
    } else {
      if (q && q.text.trim()) note(`Data set "${name}": its ${q.attrs.language || 'query'} query is not converted; point the data source at the data (JSON or CSV) and set its path.`);
      else note(`Data set "${name}": JasperReports gets its rows from Java code (a data source); point the Pagewright data source at the data.`);
      DataSources.push({ Name: srcName, ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=[]' } });
    }
    const filter = exprOf(ds, 'filterExpression');
    if (filter) {
      /** @type {Record<string, any>} */
      const holder = {};
      const v = setting(filter, holder, `The filter of data set "${name}"`, {});
      for (const n of holder.__notes || []) note(n);
      if (v) set.Filters = [{ FilterExpression: v, Operator: 'Equal', FilterValues: ['=True'] }];
    }
    DataSets.push(set);
  };
  addSet(MAIN, root);
  for (const sd of kids(root, 'subDataset')) if (sd.attrs.name) addSet(sd.attrs.name, sd);

  /* ---------------------------------------------------------------- parameters */

  const SKIP = /^(java\.awt\.Image|java\.io\.\w+|java\.util\.(Map|Collection|List|Locale|TimeZone|ResourceBundle)|java\.sql\.Connection|net\.sf\.jasperreports\..+|java\.lang\.Object|java\.net\.URL)$/;
  const ReportParameters = [];
  for (const p of params) {
    const nm = p.attrs.name;
    if (!nm) continue;
    if (SKIP.test(p.attrs.class || '')) { note(`The parameter "${nm}" holds a ${String(p.attrs.class).split('.').pop()} (passed by Java code); it is not a report parameter in Pagewright.`); continue; }
    const k = kindOf(p.attrs.class);
    /** @type {Record<string, any>} */
    const rp = { Name: nm, DataType: { num: /Integer|Long|Short|Byte/.test(p.attrs.class || '') ? 'Integer' : 'Float', bool: 'Boolean', date: 'DateTime' }[k] || 'String', Prompt: (txt(p, 'parameterDescription') ?? txt(p, 'description') ?? nm).trim() || nm };
    if (p.attrs.isForPrompting === 'false' || p.attrs.forPrompting === 'false') rp.Hidden = true;
    const d = exprOf(p, 'defaultValueExpression');
    if (d) {
      const lit = /^\s*(?:new\s+(?:java\.lang\.)?\w+\s*\(\s*)?(?:"([^"]*)"|(-?\d+(?:\.\d+)?)[dDfFlL]?|(true|false))\s*\)?\s*$/.exec(d);
      if (lit) rp.DefaultValue = { Values: [lit[1] ?? lit[2] ?? lit[3]] };
      else {
        /** @type {Record<string, any>} */
        const holder = {};
        const v = setting(d, holder, `The default of parameter "${nm}"`, {});
        for (const n of holder.__notes || []) note(n);
        if (v) rp.DefaultValue = { Values: [v] };
      }
    } else rp.Nullable = true;
    ReportParameters.push(rp);
  }

  /** @param {number} h @param {any[]} its */
  const band = (h, its) => ({ Height: pt(h), PrintOnFirstPage: true, PrintOnLastPage: true, ReportItems: its });
  const page = {
    PageWidth: pt(pageW), PageHeight: pt(pageH), LeftMargin: pt(lm), RightMargin: pt(rm), TopMargin: pt(tm), BottomMargin: pt(bm),
    PageOrientation: A.orientation === 'Landscape' ? 'Landscape' : 'Portrait',
    ...(cols > 1 ? { Columns: cols, ColumnSpacing: pt(Number(A.columnSpacing) || 0) } : {}),
  };
  return {
    Name: reportName, Page: page, DataSources, DataSets, ReportParameters,
    Body: { Height: pt(y), ReportItems: body },
    PageHeader: { ...band(pageHeader.h + colHeader.h, [...pageHeader.items, ...colHeader.items.map(i => shift(i, pageHeader.h))]), ...(headFirst ? { PrintOnFirstPage: false } : {}) },
    PageFooter: band(colFooter.h + pageFooter.h, [...colFooter.items, ...pageFooter.items.map(i => shift(i, colFooter.h))]),
  };
}

/** The chart placeholders (containers named pwchart§n) → the Pagewright charts, at their place and size. */
function placeCharts(def, charts) {
  if (!charts.size) return;
  const names = new Set();
  const all = (list, fn) => { for (const it of list || []) { if (!it || typeof it !== 'object') continue; fn(it); all(it.items, fn); for (const r of [...(it.header || []), ...(it.detail || []), ...(it.footer || [])]) for (const cl of r?.cells || []) if (cl?.item) all([cl.item], fn); } };
  const secs = Object.values(def.sections || {}).flatMap(s => (Array.isArray(s) ? s : [s]));
  for (const s of secs) all(s?.items, (it) => { if (it.name) names.add(it.name); });
  const swap = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || typeof it !== 'object') continue;
      const c = typeof it.name === 'string' && charts.get(it.name);
      if (c) {
        let nm = c.name, k = 2;
        while (names.has(nm)) nm = `${c.name}_${k++}`;
        names.add(nm);
        list[i] = { ...c, name: nm, x: it.x, y: it.y, w: it.w, h: it.h, ...(it.hidden !== undefined ? { hidden: it.hidden } : {}), ...(it.layer ? { layer: it.layer } : {}) };
        continue;
      }
      swap(it.items);
    }
  };
  for (const s of secs) swap(s?.items);
}
