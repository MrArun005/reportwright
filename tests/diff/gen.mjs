// Differential testing (docs/DIFF-TESTING.md): a seeded generator of small JasperReports (.jrxml) and BIRT
// (.rptdesign) designs that vary along the axes the engine reviews found bugs on: group nesting, aggregates and their
// scopes (Jasper resetType / incrementType / evaluationTime, BIRT aggregateOn), running totals, page numbers,
// integer and decimal arithmetic, casts and rounding, number and date patterns in five locales, null handling,
// string functions and sorting.
//
// Every compared value is one line: a static label "@<band><n>" and, to its right, the value. Both sides' text is
// read line by line (pdftotext for the real engines, the page model for ReportWright) and compared cell by cell.
// Same seed, same cases: the recorded ground truth (tests/diff/truth/*.json) is keyed by case id and a hash of the
// design text, so a changed generator shows up as stale truth rather than as a mismatch.

export const LOCALES = ['en-US', 'de-DE', 'en-IN', 'ar-SA', 'ja-JP'];

/** mulberry32: a small, fast, seeded PRNG */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p,
    some: (xs, k) => { const c = [...xs], out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(next() * c.length), 1)[0]); return out; } };
  return r;
}

export function hash(s) { // FNV-1a, 32 bits, as hex
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s) => `<![CDATA[${s}]]>`;
const LINE = 12; // one compared value per 12pt line

/* ------------------------------------------------------------------ data */

const STRINGS = ['apple', 'Banana', 'cherry', 'Émile', 'zed', '10', '9', 'a10', 'a9', 'ABC', 'abc', 'Hello World', '  pad  ', ''];
const VALUES = [1, 2, 2.5, -3.25, 10, 1.005, 0.125, 7, -7, 100, 0.5, 1.5, 3, 1234.5];
const DATES = ['2026-03-05T14:30:00', '2026-01-01T00:05:00', '2025-12-31T23:59:59', '2024-02-29T12:00:00', '2026-07-14T09:07:03'];

/** rows with group keys g1/g2, numbers v (decimal, maybe null) and n/m (integers), a string s, a date d, a boolean b */
function makeRows(r, { count, nulls = 0.1, sortBy = ['g1', 'g2'], nullStrings = 0, nullNumbers = true } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: i + 1,
      g1: r.pick(['A', 'B', 'C']), g2: r.pick(['x', 'y']),
      v: nullNumbers && r.chance(nulls) ? null : r.pick(VALUES),
      n: r.int(-4, 9), m: r.int(1, 5),
      s: r.chance(nullStrings) ? null : r.pick(STRINGS),
      d: r.pick(DATES), b: r.chance(0.5),
    });
  }
  if (sortBy.length) rows.sort((a, b) => { for (const k of sortBy) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return a.id - b.id; });
  return rows;
}

/* ------------------------------------------------------------------ JasperReports */

const JTYPES = { id: 'Integer', g1: 'String', g2: 'String', v: 'Double', n: 'Integer', m: 'Integer', s: 'String', d: 'java.util.Date', b: 'Boolean' };
const jField = (f) => `<field name="${f}" class="${JTYPES[f].includes('.') ? JTYPES[f] : `java.lang.${JTYPES[f]}`}"><property name="net.sf.jasperreports.json.field.expression" value="${f}"/></field>`;
/** one labelled value: a static "@label" and a text field */
function jLine(label, i, expr, { pattern, evalTime, evalGroup, blank } = {}) {
  const y = i * LINE;
  return `<element kind="staticText" x="0" y="${y}" width="90" height="${LINE}"><text>${cdata(label)}</text></element>`
    + `<element kind="textField" x="100" y="${y}" width="420" height="${LINE}"${pattern ? ` pattern="${xe(pattern)}"` : ''}${evalTime ? ` evaluationTime="${evalTime}"` : ''}${evalGroup ? ` evaluationGroup="${evalGroup}"` : ''}${blank ? ' blankWhenNull="true"' : ''}><expression>${cdata(expr)}</expression></element>`;
}
const jBand = (lines) => (lines.length ? `<band height="${lines.length * LINE}">${lines.join('')}</band>` : '');
const jSection = (tag, lines) => (lines.length ? `<${tag} height="${lines.length * LINE}">${lines.join('')}</${tag}>` : '');

function jReport(name, { fields, vars = [], groups = [], title = [], pageHeader = [], columnHeader = [], detail = [], columnFooter = [], pageFooter = [], summary = [], sort = [], pageHeight = 842 }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jasperReport name="${name}" language="java" pageWidth="595" pageHeight="${pageHeight}" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20" whenNoDataType="AllSectionsNoDetail">
<style name="Base" default="true" fontName="Inter" fontSize="8"/>
${fields.map(jField).join('')}
${sort.map(s => `<sortField name="${s.field}"${s.desc ? ' order="Descending"' : ''}/>`).join('')}
${vars.join('')}
${groups.map(g => `<group name="${g.name}"><expression>${cdata(g.expr)}</expression>${g.header.length ? `<groupHeader>${jBand(g.header)}</groupHeader>` : ''}${g.footer.length ? `<groupFooter>${jBand(g.footer)}</groupFooter>` : ''}</group>`).join('')}
${jSection('title', title)}
${jSection('pageHeader', pageHeader)}
${jSection('columnHeader', columnHeader)}
${detail.length ? `<detail>${jBand(detail)}</detail>` : ''}
${jSection('columnFooter', columnFooter)}
${jSection('pageFooter', pageFooter)}
${jSection('summary', summary)}
</jasperReport>`;
}

const JCALC = ['Sum', 'Count', 'Average', 'Lowest', 'Highest', 'DistinctCount', 'First'];

/** aggregates: variables with resetType / incrementType, shown in every band with an evaluationTime */
function jAgg(r, id) {
  const depth = r.int(0, 2);
  const groups = [{ name: 'G1', expr: '$F{g1}' }, { name: 'G2', expr: '$F{g2}' }].slice(0, depth).map(g => ({ ...g, header: [], footer: [] }));
  const vars = [], names = [];
  const nv = r.int(2, 4);
  for (let k = 0; k < nv; k++) {
    const calc = r.pick(JCALC);
    const field = calc === 'DistinctCount' ? r.pick(['g2', 'n']) : r.pick(['v', 'n']);
    const reset = groups.length && r.chance(0.5) ? r.pick(groups).name : null;
    const incr = groups.length && r.chance(0.15) ? r.pick(groups).name : null;
    const cls = calc === 'Count' || calc === 'DistinctCount' ? 'java.lang.Long' : calc === 'First' && field !== 'v' ? `java.lang.${JTYPES[field]}` : field === 'n' && calc !== 'Average' ? 'java.lang.Integer' : 'java.lang.Double';
    const nm = `V${k}`;
    vars.push(`<variable name="${nm}" class="${cls}" calculation="${calc}"${reset ? ` resetType="Group" resetGroup="${reset}"` : ''}${incr ? ` incrementType="Group" incrementGroup="${incr}"` : ''}><expression>${cdata(`$F{${field}}`)}</expression></variable>`);
    names.push(nm);
  }
  const shown = () => r.some([...names, 'REPORT_COUNT', ...groups.map(g => `${g.name}_COUNT`)], r.int(1, 3));
  let seq = 0;
  const line = (label, list, band) => list.map((v, i) => {
    const et = r.pick(band === 'detail' ? ['Now', 'Now', 'Report'] : ['Now', 'Now', 'Report', ...(groups.length ? ['Group'] : [])]);
    const eg = et === 'Group' ? r.pick(groups).name : undefined;
    return jLine(`@${label}${seq++}`, i, `$V{${v}}`, { evalTime: et === 'Now' ? undefined : et, evalGroup: eg, pattern: r.chance(0.3) ? '#,##0.00' : undefined });
  });
  for (const g of groups) { g.header = line(`H${g.name}.`, shown(), 'gh'); g.footer = line(`F${g.name}.`, shown(), 'gf'); }
  const detailKeys = [jLine('@Dkey', 0, '$F{g1} + "/" + $F{g2} + "/" + $F{v}')];
  const det = line('D', shown(), 'detail').map((s) => s);
  // detail lines start below the key line
  const detail = [detailKeys[0], ...det.map((s, i) => s.replace(/y="\d+"/g, `y="${(i + 1) * LINE}"`))];
  const summary = line('S', shown(), 'summary');
  const title = r.chance(0.3) ? line('T', shown(), 'title') : [];
  return { family: 'jr-agg', xml: jReport(id, { fields: ['id', 'g1', 'g2', 'v', 'n'], vars, groups, title, detail, summary }), rows: makeRows(r, { count: r.int(4, 9) }), locale: 'en-US' };
}

/** Java expressions: integer and decimal arithmetic, casts, Math, strings, null and boolean concatenation */
const JEXPR = [
  '$F{n} / 2', '$F{n} % 3', '$F{n} / 2.0', '(double)$F{n} / 4', '$F{n} * $F{m}', '-$F{n} / 2', '$F{n} / -2', '$F{n} / $F{m}', '$F{n} % $F{m}',
  '$F{v} / 3', '(int)($F{v} * 10) / 10', 'Math.round($F{v})', 'Math.round($F{v} * 100) / 100.0', 'Math.floor($F{v})', 'Math.ceil($F{v})',
  'Math.abs($F{n})', 'Math.max($F{n}, $F{m})', 'Math.min($F{v}, $F{n})', 'Math.pow($F{n}, 2)', 'Math.sqrt(Math.abs($F{v}))', '$F{v}.longValue()', '(int)$F{v}.doubleValue()',
  'Integer.valueOf($F{n} + 1)', '$F{n} + $F{m} + ""', '"" + $F{n} + $F{m}', '$F{n} + $F{m}', '1.0 * $F{n} / 3', '$F{v} * 2', '$F{v} + $F{n}',
  '$F{s} == null ? "-" : $F{s}.toUpperCase()', '$F{s} == null ? "-" : $F{s}.toLowerCase()', '$F{s} == null ? 0 : $F{s}.length()',
  '$F{s} == null ? "-" : $F{s}.trim()', '$F{s} == null ? -9 : $F{s}.indexOf("a")', '$F{s} == null ? "-" : $F{s}.replace("a", "o")',
  '$F{s} == null ? "-" : $F{s}.substring(0, Math.min(2, $F{s}.length()))', '$F{s} == null ? false : $F{s}.startsWith("a")',
  '$F{s} == null ? false : $F{s}.contains("an")', '$F{s} == null ? false : $F{s}.equalsIgnoreCase("ABC")', '"[" + $F{s} + "]"',
  '"[" + $F{b} + "]"', '"[" + ($F{n} * 2) + "]"', '"[" + ($F{n} / 2.0) + "]"', '"[" + ($F{n} > 2) + "]"', 'String.valueOf($F{n} * 1.0)',
  '$F{n} > 2 ? "big" : "small"', '"A".equals($F{g1})', '$F{g1} + $F{g2}', '$F{b} ? "yes" : "no"', '!$F{b}',
  'Integer.parseInt("12") + $F{n}', 'Double.parseDouble("1.5") * 2', 'Integer.toString($F{n})', 'String.valueOf($F{m})',
  'new java.math.BigDecimal("2.345").setScale(2, java.math.RoundingMode.HALF_UP)', 'new java.math.BigDecimal("2.345").setScale(2, java.math.RoundingMode.HALF_EVEN)',
  'String.format("%05d", $F{n})', 'String.format("%.2f", 2.5)', '$F{n} == 0 ? null : "x"',
];
function jExpr(r, id) {
  const exprs = r.some(JEXPR, r.int(4, 8));
  const detail = exprs.map((e, i) => jLine(`@E${JEXPR.indexOf(e)}`, i, e));
  return { family: 'jr-expr', xml: jReport(id, { fields: ['id', 'n', 'm', 's', 'b', 'g1', 'g2', 'v'], detail }), rows: makeRows(r, { count: r.int(2, 5), nullNumbers: false, sortBy: [] }), locale: 'en-US' };
}

const NUM_PATTERNS = ['#,##0.00', '0.0', '#,##0', '0.00%', '0%', '¤#,##0.00', '#,##0.00;(#,##0.00)', '0.0‰', '00000', '#.##', '0.###E0', '##0.##E0', '$#,##0.00', '#,##0.00 €', '#,##0.###', '0', '-0.00'];
const NUM_VALUES = [-1234.567, 0, 0.5, 1.005, 2.5, -0.001, 1234567.891, 12345678.9, -5, 0.125, 99.995];
const DATE_PATTERNS = ['dd/MM/yyyy', 'MMMM d, yyyy', 'EEE, d MMM yyyy', 'HH:mm:ss', 'h:mm a', "yyyy-MM-dd'T'HH:mm", 'EEEE', 'MMM', 'D', 'u', 'k', 'K', 'yyyy', 'dd.MM.yy', 'd MMMM', 'MM/dd/yyyy hh:mm a', 'E', 'H:mm'];
function jFormat(r, id) {
  const locale = r.pick(LOCALES);
  const nums = r.some(NUM_PATTERNS, r.int(3, 5)), dates = r.some(DATE_PATTERNS, r.int(2, 4));
  const detail = [
    ...nums.map((p, i) => jLine(`@N${NUM_PATTERNS.indexOf(p)}`, i, '$F{v}', { pattern: p, blank: true })),
    ...dates.map((p, i) => jLine(`@T${DATE_PATTERNS.indexOf(p)}`, nums.length + i, '$F{d}', { pattern: p })),
  ];
  const rows = Array.from({ length: r.int(2, 4) }, (_, i) => ({ id: i + 1, v: r.chance(0.08) ? null : r.pick(NUM_VALUES), d: r.pick(DATES) }));
  return { family: 'jr-format', xml: jReport(id, { fields: ['id', 'v', 'd'], detail }), rows, locale };
}

function jSort(r, id) {
  const field = r.pick(['s', 's', 'v', 'n']);
  const desc = r.chance(0.5);
  const detail = [jLine('@K', 0, `$F{${field}}`, { blank: false })];
  return { family: 'jr-sort', xml: jReport(id, { fields: ['id', 's', 'v', 'n'], sort: [{ field, desc }], detail }), rows: makeRows(r, { count: r.int(6, 12), sortBy: [], nullStrings: 0.15, nulls: 0.15 }), locale: r.pick(['en-US', 'de-DE']) };
}

/** pages: page numbers with evaluationTime, page header and footer, page-reset sums, report row counts */
function jPage(r, id) {
  const count = r.int(30, 140);
  const vars = ['<variable name="PSUM" class="java.lang.Integer" calculation="Sum" resetType="Page"><expression><![CDATA[$F{n}]]></expression></variable>',
    '<variable name="RSUM" class="java.lang.Integer" calculation="Sum"><expression><![CDATA[$F{n}]]></expression></variable>'];
  const pageHeader = [jLine('@PH', 0, '"Page " + $V{PAGE_NUMBER}')];
  const pageFooter = [
    jLine('@PFnow', 0, '$V{PAGE_NUMBER}'),
    jLine('@PFrep', 1, '$V{PAGE_NUMBER}', { evalTime: 'Report' }),
    ...(r.chance(0.5) ? [jLine('@PFauto', 2, '"Page " + $V{PAGE_NUMBER} + " of "', { evalTime: 'Auto' })] : []),
  ];
  const detail = [jLine('@D', 0, '$V{REPORT_COUNT} + ":" + $F{n}')];
  const columnFooter = r.chance(0.5) ? [jLine('@CFrsum', 0, '$V{RSUM}')] : [];
  const summary = [jLine('@Scount', 0, '$V{REPORT_COUNT}'), jLine('@Ssum', 1, '$V{RSUM}')];
  return { family: 'jr-page', xml: jReport(id, { fields: ['id', 'n'], vars, pageHeader, pageFooter, detail, columnFooter, summary, pageHeight: r.pick([400, 600, 842]) }), rows: makeRows(r, { count, sortBy: [] }), locale: 'en-US' };
}

/** groups whose data is not in group order: Jasper starts a new group at every change of the key */
function jUnsorted(r, id) {
  const groups = [{ name: 'G1', expr: '$F{g1}', header: [jLine('@HG1', 0, '$F{g1}')], footer: [jLine('@FG1', 0, '$V{G1_COUNT}')] }];
  return { family: 'jr-groups', xml: jReport(id, { fields: ['id', 'g1', 'n'], groups, detail: [jLine('@D', 0, '$F{g1} + $F{n}')] }), rows: makeRows(r, { count: r.int(4, 8), sortBy: [] }), locale: 'en-US' };
}

export const JRXML_FAMILIES = { agg: jAgg, expr: jExpr, format: jFormat, sort: jSort, page: jPage, groups: jUnsorted };

/* ------------------------------------------------------------------ BIRT */

const BTYPES = { id: 'integer', g1: 'string', g2: 'string', v: 'float', n: 'integer', m: 'integer', s: 'string', d: 'date-time', b: 'boolean' };
const bp = (n, v) => `<property name="${n}">${xe(v)}</property>`;
let bid = 100;
/** a table row of two cells: the "@label" and a data item bound to `col` */
const bRow = (label, col, fmt = '') => `<row id="${bid++}">${bp('height', `${LINE}pt`)}<cell id="${bid++}"><label id="${bid++}"><text-property name="text">${xe(label)}</text-property></label></cell><cell id="${bid++}"><data id="${bid++}">${fmt}${bp('resultSetColumn', col)}</data></cell></row>`;
const bBind = (name, type, expr) => `<structure>${bp('name', name)}<expression name="expression">${xe(expr)}</expression>${bp('dataType', type)}</structure>`;
const bAggBind = (name, type, fn, expr, on) => `<structure>${bp('name', name)}${bp('dataType', type)}${bp('aggregateFunction', fn)}<list-property name="arguments"><structure>${bp('name', 'Expression')}<expression name="value">${xe(expr)}</expression></structure></list-property>${on && on !== 'All' ? `<simple-property-list name="aggregateOn"><value>${xe(on)}</value></simple-property-list>` : ''}</structure>`;

function bReport({ fields, table, footer = '' }) {
  const hints = fields.map((f, i) => `<structure>${bp('position', i + 1)}${bp('name', f)}${bp('dataType', BTYPES[f])}</structure>`).join('');
  const fetch = fields.map(f => (BTYPES[f] === 'date-time' ? `row["${f}"] = r.${f} == null ? null : new Date(Date.parse(r.${f} + "Z"));` : `row["${f}"] = r.${f};`)).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://www.eclipse.org/birt/2005/design" version="3.2.23" id="1">
${bp('units', 'pt')}
<data-sources><script-data-source name="src" id="2"><method name="open">${cdata('var cx = Packages.org.mozilla.javascript.Context.getCurrentContext(); doc = new Packages.org.mozilla.javascript.json.JsonParser(cx, cx.initStandardObjects()).parseValue(reportContext.getAppContext().get("JSON"));')}</method></script-data-source></data-sources>
<data-sets><script-data-set name="R" id="3"><list-property name="resultSetHints">${hints}</list-property><structure name="cachedMetaData"><list-property name="resultSet">${hints}</list-property></structure>${bp('dataSource', 'src')}
<method name="open">${cdata('R_rows = doc; R_i = 0;')}</method>
<method name="fetch">${cdata(`if (R_i >= R_rows.length) return false; var r = R_rows[R_i++]; ${fetch} return true;`)}</method></script-data-set></data-sets>
<styles><style name="report" id="4">${bp('fontFamily', '"Inter"')}${bp('fontSize', '8pt')}</style></styles>
<page-setup><simple-master-page name="Simple MasterPage" id="5">${bp('type', 'a4')}${['top', 'left', 'bottom', 'right'].map(m => bp(`${m}Margin`, '20pt')).join('')}${bp('headerHeight', '0pt')}${bp('footerHeight', footer ? '30pt' : '0pt')}${footer}</simple-master-page></page-setup>
<body>${table}</body>
</report>`;
}
/** a table over data set R: header/detail/footer rows ([label, col, fmt]), groups [{ name, key, header, footer }], bindings */
function bTable({ fields, bindings = [], header = [], detail = [], footer = [], groups = [], sort = [], pageBreakInterval }) {
  const row = ([l, c, f]) => bRow(l, c, f);
  return `<table id="${bid++}">${bp('width', '520pt')}${bp('dataSet', 'R')}${pageBreakInterval != null ? bp('pageBreakInterval', pageBreakInterval) : ''}
<list-property name="boundDataColumns">${fields.map(f => bBind(f, BTYPES[f], `dataSetRow["${f}"]`)).join('')}${bindings.join('')}</list-property>
${sort.length ? `<list-property name="sort">${sort.map(s => `<structure><expression name="key">${xe(s.key)}</expression>${bp('direction', s.desc ? 'desc' : 'asc')}</structure>`).join('')}</list-property>` : ''}
<column id="${bid++}">${bp('width', '90pt')}</column><column id="${bid++}">${bp('width', '430pt')}</column>
${header.length ? `<header>${header.map(row).join('')}</header>` : ''}
${groups.map(g => `<group id="${bid++}">${bp('groupName', g.name)}${bp('interval', 'none')}${bp('sortDirection', 'asc')}<expression name="keyExpr">${xe(g.key)}</expression>${g.header.length ? `<header>${g.header.map(row).join('')}</header>` : ''}${g.footer.length ? `<footer>${g.footer.map(row).join('')}</footer>` : ''}</group>`).join('')}
${detail.length ? `<detail>${detail.map(row).join('')}</detail>` : ''}
${footer.length ? `<footer>${footer.map(row).join('')}</footer>` : ''}</table>`;
}

const BFN = ['SUM', 'COUNT', 'AVE', 'MIN', 'MAX', 'COUNTDISTINCT', 'RUNNINGSUM', 'RUNNINGCOUNT', 'FIRST', 'LAST'];
const BTOTAL = ['Total.sum(row["v"])', 'Total.sum(row["v"], null, "Overall")', 'Total.count()', 'Total.ave(row["n"])', 'Total.max(row["n"])', 'Total.min(row["v"], null, "Overall")',
  'row["v"] / Total.sum(row["v"], null, "Overall") * 100', 'Total.sum(row["n"], null, "G1")', 'Total.runningSum(row["n"])', 'Total.countDistinct(row["g2"])'];
function bAgg(r, id) {
  bid = 100;
  const depth = r.int(0, 2);
  const groups = [{ name: 'G1', key: 'row["g1"]' }, { name: 'G2', key: 'row["g2"]' }].slice(0, depth).map(g => ({ ...g, header: [], footer: [] }));
  const bindings = [], cols = [];
  const nb = r.int(2, 4);
  for (let k = 0; k < nb; k++) {
    const fn = r.pick(BFN);
    const field = fn === 'COUNTDISTINCT' ? r.pick(['g2', 'n']) : r.pick(['v', 'n']);
    const on = groups.length && r.chance(0.6) ? r.pick([...groups.map(g => g.name), 'All']) : r.chance(0.3) ? 'All' : undefined;
    const nm = `A${k}`;
    bindings.push(bAggBind(nm, fn.includes('COUNT') ? 'integer' : 'float', fn, `row["${field}"]`, on));
    cols.push(nm);
  }
  const totals = r.some(BTOTAL.filter(t => groups.length || !/"G1"/.test(t)), r.int(1, 3));
  totals.forEach((t, k) => { bindings.push(bBind(`T${k}`, 'float', t)); cols.push(`T${k}`); });
  let seq = 0;
  const lines = (label) => r.some(cols, r.int(1, 3)).map(c => [`@${label}${seq++}`, c, '']);
  for (const g of groups) { g.header = lines(`H${g.name}.`); g.footer = lines(`F${g.name}.`); }
  bindings.push(bBind('key', 'string', 'row["g1"] + "/" + row["g2"] + "/" + row["v"]'));
  const detail = [['@Dkey', 'key', ''], ...lines('D')];
  const table = bTable({ fields: ['id', 'g1', 'g2', 'v', 'n'], bindings, header: r.chance(0.3) ? lines('TH') : [], detail, footer: lines('TF'), groups });
  return { family: 'birt-agg', xml: bReport({ fields: ['id', 'g1', 'g2', 'v', 'n'], table }), rows: makeRows(r, { count: r.int(4, 9) }), locale: 'en-US' };
}

/** BIRT JavaScript: float arithmetic, Math, parseInt/parseFloat, strings, null concatenation, BirtStr/BirtMath */
const BEXPR = [
  ['row["n"] / 2', 'float'], ['row["n"] % 3', 'float'], ['row["n"] / row["m"]', 'float'], ['Math.round(row["v"])', 'float'], ['Math.floor(row["v"])', 'float'],
  ['Math.ceil(row["v"])', 'float'], ['Math.abs(row["n"])', 'integer'], ['Math.max(row["n"], row["m"])', 'integer'], ['Math.pow(row["n"], 2)', 'float'],
  ['row["v"] * 2', 'float'], ['row["v"] + row["n"]', 'float'], ['row["n"] + row["m"] + ""', 'string'], ['"" + row["n"] + row["m"]', 'string'],
  ['parseInt("2.7")', 'integer'], ['parseInt("12abc")', 'integer'], ['parseFloat("1.5") * 2', 'float'], ['parseInt(row["v"])', 'integer'],
  ['row["s"] == null ? "-" : row["s"].toUpperCase()', 'string'], ['row["s"] == null ? 0 : row["s"].length', 'integer'], ['row["s"] == null ? -9 : row["s"].indexOf("a")', 'integer'],
  ['row["s"] == null ? "-" : row["s"].replace("a", "o")', 'string'], ['row["s"] == null ? "-" : row["s"].substring(0, 2)', 'string'], ['"[" + row["s"] + "]"', 'string'],
  ['"[" + row["b"] + "]"', 'string'], ['row["n"] > 2 ? "big" : "small"', 'string'], ['row["g1"] + row["g2"]', 'string'], ['row["b"] ? "yes" : "no"', 'string'],
  ['BirtStr.left(row["g1"] + "xyz", 2)', 'string'], ['BirtStr.toUpper(row["g2"])', 'string'], ['BirtMath.round(row["v"], 1)', 'float'], ['BirtMath.mod(row["n"], 3)', 'float'],
  ['(row["v"] * 3).toFixed(2)', 'string'], ['row["n"] / 0', 'float'], ['row["n"] == 0 ? null : "x"', 'string'], ['String(row["n"] * 1.0)', 'string'], ['row["n"] * 1.5', 'float'],
  ['BirtStr.trim("  pad  ")', 'string'], ['BirtComp.equalTo(row["g1"], "A")', 'boolean'], ['row["v"] == null ? "nil" : row["v"]', 'any'],
];
function bExpr(r, id) {
  bid = 100;
  const picks = r.some(BEXPR, r.int(4, 8));
  const bindings = picks.map(([e, t], k) => bBind(`E${k}`, t === 'any' ? 'string' : t, e));
  const detail = picks.map(([e], k) => [`@E${BEXPR.findIndex(x => x[0] === e)}`, `E${k}`, '']);
  const fields = ['id', 'n', 'm', 's', 'b', 'g1', 'g2', 'v'];
  return { family: 'birt-expr', xml: bReport({ fields, table: bTable({ fields, bindings, detail }) }), rows: makeRows(r, { count: r.int(2, 5), nullNumbers: false, sortBy: [] }), locale: 'en-US' };
}

const BNUM = [['Custom', '#,##0.00'], ['Custom', '0.0'], ['Custom', '#,##0'], ['Custom', '0.00%'], ['Custom', '¤#,##0.00'], ['Custom', '#,##0.00;(#,##0.00)'],
  ['Custom', '0.0‰'], ['Custom', '00000'], ['Custom', '#.##'], ['Custom', '0.###E0'], ['Currency', '¤#,##0.00'], ['Percent', '0.00%'], ['Fixed', '#,##0.00'],
  ['Scientific', '0.00E00'], ['General Number', 'General Number'], ['Unformatted', ''], ['Currency', '$#,##0.00;$(#,##0.00)'], ['Percent', 'Percent'],
  ['Fixed', '#,##0.00{RoundingMode=HALF_UP}'], ['Currency', '$#,##0']];
const BDATE = [['Custom', 'dd/MM/yyyy'], ['Custom', 'MMMM d, yyyy'], ['Custom', 'EEE, d MMM yyyy'], ['Custom', 'HH:mm:ss'], ['Custom', 'h:mm a'], ['Custom', 'EEEE'],
  ['Custom', 'D'], ['Custom', 'u'], ['Custom', 'd MMMM'], ['Short Date', 'Short Date'], ['Medium Date', 'Medium Date'], ['Long Date', 'Long Date'],
  ['General Date', 'General Date'], ['Short Time', 'Short Time'], ['Long Time', 'Long Time'], ['Unformatted', '']];
const bNumFmt = ([c, p]) => `<structure name="numberFormat">${bp('category', c)}${p ? bp('pattern', p) : ''}</structure>`;
const bDateFmt = ([c, p]) => `<structure name="dateTimeFormat">${bp('category', c)}${p ? bp('pattern', p) : ''}</structure>`;
function bFormat(r, id) {
  bid = 100;
  const locale = r.pick(LOCALES);
  const nums = r.some(BNUM, r.int(3, 5)), dates = r.some(BDATE, r.int(2, 4));
  const detail = [...nums.map(f => [`@N${BNUM.indexOf(f)}`, 'v', bNumFmt(f)]), ...dates.map(f => [`@T${BDATE.indexOf(f)}`, 'd', bDateFmt(f)])];
  const rows = Array.from({ length: r.int(2, 4) }, (_, i) => ({ id: i + 1, v: r.chance(0.08) ? null : r.pick(NUM_VALUES), d: r.pick(DATES) }));
  const fields = ['id', 'v', 'd'];
  return { family: 'birt-format', xml: bReport({ fields, table: bTable({ fields, detail }) }), rows, locale };
}

function bSort(r, id) {
  bid = 100;
  const field = r.pick(['s', 's', 'v', 'n']);
  const fields = ['id', 's', 'v', 'n'];
  const table = bTable({ fields, sort: [{ key: `row["${field}"]`, desc: r.chance(0.5) }], detail: [['@K', field, '']] });
  return { family: 'birt-sort', xml: bReport({ fields, table }), rows: makeRows(r, { count: r.int(6, 12), sortBy: [], nullStrings: 0.15, nulls: 0.15 }), locale: r.pick(['en-US', 'de-DE']) };
}

function bPage(r, id) {
  bid = 100;
  const footer = `<page-footer><grid id="${bid++}">${bp('width', '520pt')}<column id="${bid++}">${bp('width', '90pt')}</column><column id="${bid++}">${bp('width', '430pt')}</column><row id="${bid++}">${bp('height', `${LINE}pt`)}<cell id="${bid++}"><label id="${bid++}"><text-property name="text">@PF</text-property></label></cell><cell id="${bid++}"><auto-text id="${bid++}">${bp('type', 'page-number')}</auto-text></cell></row><row id="${bid++}">${bp('height', `${LINE}pt`)}<cell id="${bid++}"><label id="${bid++}"><text-property name="text">@PFtotal</text-property></label></cell><cell id="${bid++}"><auto-text id="${bid++}">${bp('type', 'total-page')}</auto-text></cell></row></grid></page-footer>`;
  const fields = ['id', 'n'];
  const pbi = r.pick([undefined, 0, 20]);
  const table = bTable({ fields, bindings: [bAggBind('RC', 'integer', 'RUNNINGCOUNT', 'row["n"]'), bAggBind('TS', 'integer', 'SUM', 'row["n"]')], detail: [['@D', 'RC', '']], footer: [['@TF', 'TS', '']], pageBreakInterval: pbi });
  return { family: 'birt-page', xml: bReport({ fields, table, footer }), rows: makeRows(r, { count: r.int(30, 140), sortBy: [] }), locale: 'en-US' };
}

export const BIRT_FAMILIES = { agg: bAgg, expr: bExpr, format: bFormat, sort: bSort, page: bPage };

/** Field types for the ReportWright side (the importers declare most; data comes as JSON). */
export const FIELD_KINDS = { d: 'date' };

/**
 * The cases, in a fixed order: for each family, `per[family]` designs from one seed per case.
 * @param {'jrxml'|'birt'} engine @param {{ seed?: number, per?: Record<string, number> }} [o]
 */
export function cases(engine, { seed = 20261005, per = {} } = {}) {
  const fams = engine === 'jrxml' ? JRXML_FAMILIES : BIRT_FAMILIES;
  const out = [];
  for (const [name, fn] of Object.entries(fams)) {
    const n = per[name] ?? (globalThis.process?.env.PW_DIFF_PER ? Number(process.env.PW_DIFF_PER) : DEFAULT_PER[engine][name]);
    for (let i = 0; i < n; i++) {
      const id = `${engine === 'jrxml' ? 'jr' : 'bt'}-${name}-${String(i).padStart(3, '0')}`;
      const c = fn(rng((seed ^ parseInt(hash(id), 16)) >>> 0), id);
      out.push({ id, engine, ...c, hash: hash(c.xml + JSON.stringify(c.rows) + c.locale) });
    }
  }
  return out;
}
const DEFAULT_PER = {
  jrxml: { agg: 80, expr: 60, format: 70, sort: 30, page: 25, groups: 15 },
  birt: { agg: 80, expr: 60, format: 70, sort: 30, page: 25 },
};
