// @ts-check
/**
 * SSRS importer: a Microsoft SQL Server Reporting Services / Report Builder report (.rdl, .rdlc; RDL 2008, 2010
 * and 2016) becomes a ReportWright report definition.
 *
 * RDLX-JSON, the ActiveReportsJS format, is RDL written as JSON with the same element and property names. So this
 * file is only a front end: it reads the XML (safely, see xml.js), rewrites it into the RDLX-JSON shape and hands
 * that to the ActiveReports importer (rdlx.js), which owns the mapping, the expression translation and the notes.
 * What is SSRS-only happens here: text runs and paragraphs, the tablix XML hierarchy, the RDL 2008 chart model,
 * gauges and state indicators, shared data sources, Variables, ReportItems!x and Me.Value, custom code.
 *
 * Pure JavaScript, no Node APIs and no DOM. It never throws: whatever it cannot map becomes a warning.
 */
import { parseXml, XmlError } from './xml.js';
import { importRdlx, toPt, ImportBudgetError, OUTPUT_LIMITS } from './rdlx.js';

const RDL_NS = /^http:\/\/schemas\.microsoft\.com\/sqlserver\/reporting\/(\d{4})\/\d{2}\/reportdefinition$/i;
const MAX_EXPR = 20_000; // longer expressions are left out (the translation is linear, but its output feeds the engine)
const MAX_REGION_DEPTH = 8; // tables, charts and gauges inside table cells, inside each other

const isExpr = (v) => typeof v === 'string' && v.trimStart().startsWith('=');
/** A ReportWright-bound value as a VB operand: "=x" → (x), "text" → "text". */
const vb = (v) => (isExpr(v) ? `(${v.trimStart().slice(1)})` : `"${String(v ?? '').replace(/"/g, '""')}"`);
const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isId = (c) => isIdStart(c) || (c >= '0' && c <= '9');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Convert an SSRS report.
 * @param {string} input the .rdl / .rdlc text
 * @param {{ name?: string }} [opts] name: the report name (e.g. from the file name)
 * @returns {{ definition: any, warnings: string[], stats: { items: number, mapped: number, approximated: number, dropped: number }, error?: string }}
 */
export function importRdl(input, opts = {}) {
  const name = opts.name || 'Imported SSRS report';
  let root;
  try {
    root = parseXml(String(input ?? ''));
  } catch (e) {
    const error = e instanceof XmlError ? `The file is not readable XML: ${e.message}` : `The file could not be read (${e instanceof Error ? e.message : e})`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  const m = RDL_NS.exec(root.ns);
  if (root.name !== 'Report' || (root.ns && !m)) {
    const error = `The file is not an SSRS report: its root is <${root.name}>${root.ns ? ` in ${root.ns}` : ''}, not <Report> in an RDL namespace`;
    return { ...importRdlx({}, { name }), warnings: [`${error}, so the report is empty.`], error };
  }
  /** @type {string[]} */
  const notes = [];
  let ar;
  try { ar = toRdlx(root, notes, m ? Number(m[1]) : 2016); } catch (e) {
    if (e instanceof ImportBudgetError) {
      const error = `The report is too large to import: ${e.message}`;
      return { ...importRdlx({}, { name }), warnings: [`${error}.`], error };
    }
    notes.push(`The import stopped early (${e instanceof Error ? e.message : e}), so parts of the report are missing.`);
    ar = {};
  }
  const r = importRdlx(ar, { name });
  if (r.error) return r;
  const def = r.definition;
  for (const p of def.parameters || []) if (ar.__hidden?.has(p.name)) p.hidden = true;
  if (ar.__code) def.customCode = ar.__code;
  const warnings = [...notes, ...r.warnings.filter(w => !/is hidden in ActiveReports; ReportWright shows it/.test(w))]
    .map(w => w.replace(/ActiveReports/g, 'SSRS'));
  return { definition: def, warnings: [...new Set(warnings)], stats: r.stats };
}

/**
 * The RDL XML tree → an RDLX-JSON object (what rdlx.js reads).
 * @param {import('./xml.js').XmlElement} root @param {string[]} notes @param {number} year the RDL version
 */
function toRdlx(root, notes, year) {
  const NS = root.ns;
  /** @param {any} e @param {string} [name] */
  const kids = (e, name) => (e ? e.children.filter(c => c.ns === NS && (name == null || c.name === name)) : []);
  /** @param {any} e @param {string} name */
  const kid = (e, name) => e?.children.find(c => c.ns === NS && c.name === name);
  /** The text of a child element (as written: no substitutions). */
  const raw = (e, name) => { const c = kid(e, name); return c ? (c.attrs.nil === 'true' ? null : c.text) : undefined; };
  /** The text of a child element, with Variables, ReportItems and Me.Value resolved in expressions. */
  const val = (e, name) => fix(raw(e, name));
  const path = (e, ...names) => names.reduce((x, n) => kid(x, n), e);
  const list = (e, outer, inner) => kids(kid(e, outer), inner);

  /* ---------------------------------------------------------------- expression substitutions */

  /** Report and group variables, by lower-case name. */
  const variables = new Map();
  /** Text boxes by lower-case name: their value and the data region they sit in. */
  const boxes = new Map();
  let region = null; // the data region being converted (for ReportItems!x)
  let me = null; // the value of the text box being converted (for Me.Value)
  /** @type {string[] | null} notes of the item being converted: what is lost or changed */
  let itemNotes = null;
  /** @type {string[] | null} information about the item being converted: nothing is lost */
  let itemInfo = null;
  const note = (msg) => { if (itemNotes) { if (!itemNotes.includes(msg)) itemNotes.push(msg); } else if (!notes.includes(msg)) notes.push(msg); };
  const info = (msg) => { if (itemInfo) { if (!itemInfo.includes(msg)) itemInfo.push(msg); } else if (!notes.includes(msg)) notes.push(msg); };


  let depth = 0, produced = 0;
  /** Expansions of Variables!x and ReportItems!x, each worked out once: a chain of variables that each use the one before many times would otherwise take exponential time. */
  const memo = new Map();
  const TOO_LONG = Symbol('too long');
  /** Resolve Variables!x, ReportItems!x and Me.Value in an expression. Linear in what it reads and writes. */
  function fix(v) {
    if (!isExpr(v)) return v;
    if (v.length > MAX_EXPR) { note(`an expression of ${v.length} characters is too long to import, so it is left out.`); return ''; }
    let out;
    try { out = expand(v); } catch (e) {
      if (e !== TOO_LONG) throw e;
      note(`an expression becomes longer than ${MAX_EXPR} characters once its variables and item references are filled in, so it is left out.`);
      return '';
    }
    produced += out.length;
    if (produced > OUTPUT_LIMITS.chars) throw new ImportBudgetError(`its expressions grow past ${OUTPUT_LIMITS.chars / 1e6} million characters once variables and item references are filled in`);
    return out;
  }
  function expand(v) {
    const src = v, low = v.toLowerCase(), n = v.length;
    let out = '', last = 0, i = 0, fresh = false;
    while (i < n) {
      const c = src[i];
      if (c === '"') { i++; while (i < n && !(src[i] === '"' && src[i + 1] !== '"')) i += src[i] === '"' ? 2 : 1; i++; continue; }
      if (!isIdStart(c) || (!fresh && i > 0 && (isId(src[i - 1]) || src[i - 1] === '.' || src[i - 1] === '!'))) { i++; fresh = false; continue; }
      fresh = false;
      let j = i;
      while (j < n && isId(src[j])) j++;
      const w = low.slice(i, j);
      let rep = null, end = j;
      if ((w === 'variables' || w === 'reportitems') && src[j] === '!') {
        let k = j + 1;
        while (k < n && isId(src[k])) k++;
        const nm = src.slice(j + 1, k);
        end = low.startsWith('.value', k) && !isId(src[k + 6] || '') ? k + 6 : k;
        rep = w === 'variables' ? variable(nm) : reportItem(nm);
      } else if ((w === 'microsoft' && low.startsWith('.visualbasic.', j)) || (w === 'system' && src[j] === '.')) {
        rep = ''; end = j + (w === 'system' ? 1 : 13); fresh = true; // Microsoft.VisualBasic.DateFormat.LongDate → DateFormat.LongDate
      } else if (w === 'me' && me != null && low.startsWith('.value', j) && !isId(src[j + 6] || '')) { rep = vb(me); end = j + 6; }
      if (rep != null) {
        out += src.slice(last, i) + rep;
        last = end;
        if (out.length > MAX_EXPR) throw TOO_LONG;
      }
      i = end;
    }
    out += src.slice(last);
    if (out.length > MAX_EXPR) throw TOO_LONG;
    return out;
  }
  /** The expansion of one reference, worked out once (null: leave the reference as it is). */
  function once(key, value) {
    if (memo.has(key)) { const m = memo.get(key); if (m === TOO_LONG) throw TOO_LONG; return m; }
    if (depth >= 4) return null;
    memo.set(key, null); // a reference to itself, directly or not, is left as it is
    depth++;
    try { const r = vb(expand(value)); memo.set(key, r); return r; } catch (e) { if (e === TOO_LONG) memo.set(key, TOO_LONG); throw e; } finally { depth--; }
  }
  function variable(name) {
    const v = variables.get(name.toLowerCase());
    if (v == null) return null;
    const r = once(`v:${name.toLowerCase()}`, v);
    if (r != null) info(`Variables!${name} is replaced by its expression.`);
    return r;
  }
  function reportItem(name) {
    const b = boxes.get(name.toLowerCase());
    if (!b || b.value == null || (b.region != null && b.region !== region)) return null; // another region's value depends on the page: left to the note
    const r = once(`r:${name.toLowerCase()}:${region}`, b.value);
    if (r != null) info(`ReportItems!${name} is replaced by the expression of ${name}, which gives the same value here.`);
    return r;
  }

  /* ---------------------------------------------------------------- shared pieces */

  /** An element as a plain object: leaves are text (expressions resolved), repeated names keep the last. */
  function obj(e) {
    if (!e) return undefined;
    const ks = kids(e);
    if (!ks.length) return fix(e.attrs.nil === 'true' ? null : e.text);
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of ks) o[k.name] = obj(k);
    return o;
  }
  const styleOf = (e) => obj(kid(e, 'Style')) || {};
  const exprs = (e, outer, inner) => list(e, outer, inner).map(x => fix(x.text)).filter(x => x != null && String(x).trim() !== '');
  const visibility = (e) => { const v = kid(e, 'Visibility'); return v ? { Hidden: val(v, 'Hidden'), ToggleItem: raw(v, 'ToggleItem') } : undefined; };
  const pageBreak = (e) => { const p = kid(e, 'PageBreak'); return p ? { BreakLocation: raw(p, 'BreakLocation'), ResetPageNumber: raw(p, 'ResetPageNumber') } : undefined; };
  const filters = (e) => list(e, 'Filters', 'Filter').map(f => ({ FilterExpression: val(f, 'FilterExpression'), Operator: raw(f, 'Operator'), FilterValues: list(f, 'FilterValues', 'FilterValue').map(x => fix(x.text)) }));
  const sorts = (e) => list(e, 'SortExpressions', 'SortExpression').map(s => ({ Value: val(s, 'Value'), Direction: raw(s, 'Direction') }));
  const group = (g) => g && { Name: g.attrs.Name, GroupExpressions: exprs(g, 'GroupExpressions', 'GroupExpression'), PageBreak: pageBreak(g), Filters: filters(g), Parent: val(g, 'Parent'), DocumentMapLabel: val(g, 'DocumentMapLabel') };

  function action(e) {
    const acts = list(kid(e, 'ActionInfo'), 'Actions', 'Action');
    if (!acts.length) return undefined;
    if (acts.length > 1) note('it has more than one action; the first is kept.');
    const a = acts[0], d = kid(a, 'Drillthrough');
    if (d) return { Drillthrough: { ReportName: val(d, 'ReportName'), Parameters: list(d, 'Parameters', 'Parameter').map(p => ({ ParameterName: p.attrs.Name, Value: val(p, 'Value'), Omit: val(p, 'Omit') })) } };
    if (kid(a, 'Hyperlink')) return { Hyperlink: val(a, 'Hyperlink') };
    if (kid(a, 'BookmarkLink')) return { BookmarkLink: val(a, 'BookmarkLink') };
    return undefined;
  }

  /** What every report item has. Starts collecting the item's notes. */
  function common(e, type) {
    itemNotes = [];
    itemInfo = [];
    return {
      Type: type, Name: e.attrs.Name, __notes: itemNotes, __info: itemInfo,
      Left: raw(e, 'Left'), Top: raw(e, 'Top'), Width: raw(e, 'Width'), Height: raw(e, 'Height'), ZIndex: raw(e, 'ZIndex'),
      Visibility: visibility(e), PageBreak: pageBreak(e), ToolTip: val(e, 'ToolTip'), DocumentMapLabel: val(e, 'DocumentMapLabel'), Bookmark: val(e, 'Bookmark'),
      KeepTogether: raw(e, 'KeepTogether'), Style: styleOf(e), Action: action(e),
    };
  }

  /** Items of a <ReportItems> element. */
  const items = (e) => kids(e).map(x => item(x, false)).filter(Boolean);

  /** One report item. inCell: it fills a tablix cell. */
  let regions = 0; // data regions open around the item being converted
  function item(e, inCell) {
    const saved = itemNotes, savedInfo = itemInfo;
    const isRegion = e.name === 'Tablix' || e.name === 'Chart' || e.name === 'GaugePanel';
    if (isRegion && regions >= MAX_REGION_DEPTH) return { Type: e.name, Name: e.attrs.Name, __drop: `it is nested more than ${MAX_REGION_DEPTH} tables or charts deep, so it was left out.` };
    if (isRegion) regions++;
    try {
      switch (e.name) {
        case 'Textbox': return textbox(e, inCell);
        case 'Rectangle': return { ...common(e, 'rectangle'), ReportItems: items(kid(e, 'ReportItems')) };
        case 'Line': return common(e, 'line');
        case 'Image': return { ...common(e, 'image'), Source: raw(e, 'Source'), Value: val(e, 'Value'), MIMEType: raw(e, 'MIMEType'), Sizing: raw(e, 'Sizing') };
        case 'Subreport': return { ...common(e, 'subreport'), ReportName: raw(e, 'ReportName'), Parameters: list(e, 'Parameters', 'Parameter').map(p => ({ ParameterName: p.attrs.Name, Value: val(p, 'Value'), Omit: val(p, 'Omit') })) };
        case 'Tablix': return tablix(e);
        case 'Chart': return year >= 2008 ? chart(e) : { Type: 'Chart (RDL 2005)', Name: e.attrs.Name };
        case 'GaugePanel': return gauge(e);
        case 'Map': return { Type: 'Map', Name: e.attrs.Name }; // dropped with a note: SSRS maps (spatial layers) have no equivalent
        default: return { Type: e.name, Name: e.attrs.Name }; // the ActiveReports importer drops it with a note
      }
    } finally { itemNotes = saved; itemInfo = savedInfo; if (isRegion) regions--; }
  }

  /* ---------------------------------------------------------------- text boxes */

  function paragraphs(e) {
    return list(e, 'Paragraphs', 'Paragraph').map(p => ({
      style: obj(kid(p, 'Style')) || {},
      list: raw(p, 'ListStyle'),
      runs: list(p, 'TextRuns', 'TextRun').map(r => ({ value: raw(r, 'Value') ?? '', style: obj(kid(r, 'Style')) || {}, html: /^html$/i.test(raw(r, 'MarkupType') || '') })),
    }));
  }

  /** The runs of all paragraphs as one value: literal text, or an "=" expression joined with &. format: wrap each run in its Format. */
  function joinRuns(paras, format) {
    const ps = paras.slice();
    while (ps.length > 1 && ps[ps.length - 1].runs.every(r => r.value === '')) ps.pop(); // trailing empty paragraphs
    const parts = [];
    ps.forEach((p, k) => {
      if (k) parts.push('\n');
      for (const r of p.runs) {
        const f = format && r.style.Format;
        parts.push(isExpr(r.value) && f && !isExpr(f) ? `=Format(${r.value.trimStart().slice(1)}, ${vb(f)})` : r.value);
      }
    });
    const nonEmpty = parts.filter(x => x !== '');
    if (!nonEmpty.length) return '';
    if (!nonEmpty.some(isExpr)) return nonEmpty.join('');
    if (nonEmpty.length === 1) return nonEmpty[0];
    return '=' + nonEmpty.map(x => (x === '\n' ? 'vbCrLf' : vb(x))).join(' & ');
  }

  const RUN_CSS = { FontFamily: 'font-family', FontSize: 'font-size', FontWeight: 'font-weight', FontStyle: 'font-style', Color: 'color', TextDecoration: 'text-decoration' };
  function css(st) {
    const out = [];
    for (const [k, prop] of Object.entries(RUN_CSS)) {
      let v = st[k];
      if (v == null || v === '') continue;
      if (isExpr(v)) { note(`a text run's ${k} is set by an expression, which rich text does not support; the default is used.`); continue; }
      v = String(v);
      if (k === 'FontWeight') v = /bold|black|heavy|[6-9]00/i.test(v) ? 'bold' : 'normal';
      if (k === 'TextDecoration') v = /line/i.test(v) ? 'line-through' : /under/i.test(v) ? 'underline' : 'none';
      if (k === 'FontStyle') v = /italic/i.test(v) ? 'italic' : 'normal';
      out.push(`${prop}:${v.replace(/[;"<>]/g, '')}`);
    }
    return out.join(';');
  }

  /** Runs with different formatting: rich text, with each expression run as a mail-merge field. */
  function richHtml(paras, merge) {
    let html = '', open = '';
    for (const p of paras) {
      const kind = /bullet/i.test(p.list || '') ? 'ul' : /number/i.test(p.list || '') ? 'ol' : '';
      if (kind !== open) { if (open) html += `</${open}>`; if (kind) html += `<${kind}>`; open = kind; }
      const align = p.style.TextAlign && !isExpr(p.style.TextAlign) ? String(p.style.TextAlign).toLowerCase().replace(/[^a-z]/g, '') : '';
      let inner = '';
      for (const r of p.runs) {
        let content;
        if (isExpr(r.value)) {
          const f = r.style.Format && !isExpr(r.style.Format) ? r.style.Format : null;
          const name = `F${merge.length + 1}`;
          merge.push({ Name: name, Value: fix(f ? `=Format(${r.value.trimStart().slice(1)}, ${vb(f)})` : r.value) });
          if (r.html) note('a text run that holds HTML from an expression is shown as text here.');
          content = `<%${name}%>`;
        } else content = r.html ? r.value : esc(r.value).replace(/\r?\n/g, '<br/>');
        const st = css(r.style);
        inner += st ? `<span style="${st}">${content}</span>` : content;
      }
      const tag = kind ? 'li' : 'p';
      html += `<${tag}${align && align !== 'general' ? ` style="text-align:${align}"` : ''}>${inner}</${tag}>`;
    }
    if (open) html += `</${open}>`;
    return html;
  }

  function textbox(e, inCell) {
    itemNotes = [];
    itemInfo = [];
    me = null;
    const first = paragraphs(e);
    const value = joinRuns(first, first.flatMap(p => p.runs).length > 1);
    me = value; // styles read again with Me.Value known
    const it = common(e, 'textbox');
    try {
      const paras = paragraphs(e);
      const runs = paras.flatMap(p => p.runs);
      const key = (st) => JSON.stringify({ ...st, Format: undefined });
      const uniform = runs.every(r => key(r.style) === key(runs[0].style)) && paras.every(p => key(p.style) === key(paras[0].style) && !p.list);
      const base = { ...it.Style, ...(paras[0]?.style || {}), ...(runs[0]?.style || {}) };
      if (runs.length > 1) delete base.Format; // each run carries its own format
      Object.assign(it, { CanGrow: raw(e, 'CanGrow'), CanShrink: raw(e, 'CanShrink'), Style: base });
      const us = kid(e, 'UserSort');
      if (us) it.UserSort = { SortExpression: val(us, 'SortExpression') };
      if (/true/i.test(raw(e, 'HideDuplicates') ?? '')) note('repeated values are shown (Hide duplicates is not supported).');
      const html = runs.some(r => r.html);
      if (html && runs.length === 1 && !inCell) return { ...it, Type: 'formattedtext', Html: fix(runs[0].value) };
      if ((uniform && !html) || inCell || !runs.length) {
        if (!uniform && inCell) note('its text runs are formatted differently; in a table cell the text keeps the first run\'s formatting.');
        if (html && inCell) note('its HTML is shown as text in a table cell.');
        return { ...it, Value: fix(value) };
      }
      const merge = [];
      return { ...it, Type: 'formattedtext', Html: richHtml(paras, merge), MailMergeFields: merge };
    } finally { me = null; }
  }

  /* ---------------------------------------------------------------- tablix */

  /** The report item in a <CellContents>, and its spans. */
  function contents(cc) {
    if (!cc) return null;
    const x = kids(cc).find(k => k.name !== 'ColSpan' && k.name !== 'RowSpan');
    return { Item: x ? item(x, true) : undefined, ColSpan: raw(cc, 'ColSpan'), RowSpan: raw(cc, 'RowSpan') };
  }

  /** A row or column hierarchy: members (headers span levels by their ColSpan / RowSpan) and the size of each level. */
  function hierarchy(h, rows) {
    const sizes = [];
    const members = (ms, level) => kids(ms, 'TablixMember').map(m => {
      const hd = kid(m, 'TablixHeader');
      const cc = hd && kid(hd, 'CellContents');
      const span = hd ? Math.max(1, Math.min(16, Math.floor(Number(raw(cc, rows ? 'ColSpan' : 'RowSpan')) || 1))) : 0;
      if (hd && sizes[level] == null) sizes[level] = raw(hd, 'Size');
      const g = kid(m, 'Group');
      return {
        Group: group(g), SortExpressions: sorts(m), Visibility: visibility(m),
        Header: hd ? { Item: contents(cc)?.Item, LevelCount: span } : undefined,
        Children: members(kid(m, 'TablixMembers'), level + span),
        KeepTogether: raw(m, 'KeepTogether'), RepeatOnNewPage: raw(m, 'RepeatOnNewPage'), KeepWithGroup: raw(m, 'KeepWithGroup'),
      };
    });
    const Members = members(kid(h, 'TablixMembers'), 0);
    return { LevelSizes: Array.from(sizes, s => s ?? '1in'), Members };
  }

  /**
   * Row members as bands: static rows before / after, one group (or the details) per level. null: not a simple chain
   * (row headers, groups side by side, groups under the details).
   */
  function rowChain(ms) {
    let n = 0;
    const statics = (m) => {
      if (m.Group || m.Header) return null;
      if (!m.Children.length) return [n++];
      const out = [];
      for (const k of m.Children) { const r = statics(k); if (!r) return null; out.push(...r); }
      return out;
    };
    const level = (list) => {
      /** @type {any} */
      const out = { before: [], after: [], group: null, inner: null, details: null, detailsMember: null };
      let seen = false;
      for (const m of list) {
        if (m.Header) return null;
        if (m.Group) {
          if (seen) return null;
          seen = true;
          if (m.Group.GroupExpressions.length) {
            out.group = m;
            out.inner = m.Children.length ? level(m.Children) : { before: [n++], after: [], group: null, inner: null, details: null };
            if (!out.inner) return null;
          } else {
            const rows = [];
            for (const k of m.Children.length ? m.Children : [{ Children: [] }]) { const r = statics(k); if (!r) return null; rows.push(...r); }
            out.details = rows;
            out.detailsMember = m;
          }
        } else {
          const r = statics(m);
          if (!r) return null;
          (seen ? out.after : out.before).push(...r);
        }
      }
      return out;
    };
    return level(ms);
  }

  function tablix(e) {
    const saved = region;
    region = e.attrs.Name || region;
    try {
      const body = kid(e, 'TablixBody');
      const cols = list(body, 'TablixColumns', 'TablixColumn').map(c => raw(c, 'Width'));
      const rowEls = list(body, 'TablixRows', 'TablixRow');
      // checked before any cell is converted: the grid is rows × columns whatever the file spells out
      if ((rowEls.length + 8) * (cols.length + 8) > OUTPUT_LIMITS.cellsPerTable) {
        return { Type: 'Tablix', Name: e.attrs.Name, __drop: `it has ${rowEls.length} rows × ${cols.length} columns, more than the ${OUTPUT_LIMITS.cellsPerTable.toLocaleString('en-US')} cells a table may have, so it was left out.` };
      }
      const base = { ...common(e, 'tablix'), DataSetName: raw(e, 'DataSetName'), Filters: filters(e), SortExpressions: sorts(e), NoRowsMessage: val(e, 'NoRowsMessage'),
        RepeatColumnHeaders: raw(e, 'RepeatColumnHeaders') };
      const notesOf = base.__notes;

      // a List: one cell holding a rectangle, repeated per row (or per group)
      const rowH = hierarchy(kid(e, 'TablixRowHierarchy'), true), colH = hierarchy(kid(e, 'TablixColumnHierarchy'), false);
      const cell0 = kids(kid(rowEls[0], 'TablixCells'), 'TablixCell')[0];
      const rect = kids(kid(cell0, 'CellContents')).find(k => k.name === 'Rectangle');
      const rm = rowH.Members[0], cm = colH.Members[0];
      if (cols.length === 1 && rowEls.length === 1 && rect && rowH.Members.length === 1 && colH.Members.length === 1 && !rm.Header && !cm.Header && !cm.Group && !rm.Children.length && !cm.Children.length) {
        itemNotes = notesOf;
        const r = item(rect, false);
        const G = rm.Group?.GroupExpressions?.length ? rm.Group : { GroupExpressions: [], PageBreak: rm.Group?.PageBreak };
        if (!G.PageBreak && r.PageBreak) G.PageBreak = r.PageBreak;
        if (rm.Visibility) notesOf.push('its rows are hidden or toggled in SSRS; here they are always shown.');
        return { ...base, Type: 'list', Group: G, SortExpressions: rm.SortExpressions?.length ? rm.SortExpressions : base.SortExpressions,
          Filters: [...base.Filters, ...(rm.Group?.Filters || [])], ReportItems: r.ReportItems || [], Style: { ...base.Style, ...r.Style }, __notes: [...notesOf, ...(r.__notes || [])], __info: [...base.__info, ...(r.__info || [])] };
      }
      // a stack of rectangles: one column whose rows hold rectangles (letters, invoices) → the bands of a banded list
      const cellItem = (r) => kids(kid(kids(kid(r, 'TablixCells'), 'TablixCell')[0], 'CellContents')).find(k => k.name !== 'ColSpan' && k.name !== 'RowSpan');
      if (cols.length === 1 && colH.Members.length === 1 && !cm.Group && !cm.Header && rowEls.some(r => cellItem(r)?.name === 'Rectangle')) {
        const chain = rowChain(rowH.Members);
        if (chain) {
          const band = (idx) => {
            let y = 0;
            const its = [];
            for (const i of idx) {
              const r = rowEls[i], x = r && cellItem(r);
              if (x) its.push({ ...item(x, false), Left: '0pt', Top: `${y}pt`, Width: cols[0], Height: raw(r, 'Height') });
              y += toPt(raw(r, 'Height'));
            }
            return { Height: `${y}pt`, ReportItems: its };
          };
          itemNotes = notesOf;
          const Groups = [];
          let c = chain;
          for (; c.group; c = c.inner) {
            if (c.group.Visibility) notesOf.push(`the group "${c.group.Group.Name}" is hidden or toggled in SSRS; here it is always shown.`);
            Groups.push({ Group: c.group.Group, SortExpressions: c.group.SortExpressions, KeepTogether: c.group.KeepTogether, Header: band(c.inner.before), Footer: band(c.inner.after) });
          }
          return { ...base, Type: 'bandedlist', Width: cols[0], Header: band(chain.before), Footer: band(chain.after), Groups, Details: band(c.details || []),
            SortExpressions: c.detailsMember?.SortExpressions?.length ? c.detailsMember.SortExpressions : base.SortExpressions };
        }
      }
      // SSRS sorts detail rows on the details member; ReportWright sorts the table's rows (groups keep their own order)
      const detailsOf = (ms) => { for (const m of ms) { if (m.Group && !m.Group.GroupExpressions.length) return m; const d = detailsOf(m.Children); if (d) return d; } return null; };
      const dsort = detailsOf(rowH.Members)?.SortExpressions || [];
      if (dsort.length) base.SortExpressions = [...base.SortExpressions, ...dsort];
      const N = cols.length;
      const clampSpan = (c, max) => { if (c && Number(c.ColSpan) > max) c.ColSpan = String(max); return c; };
      const Rows = rowEls.map(r => ({ Height: raw(r, 'Height'), Cells: kids(kid(r, 'TablixCells'), 'TablixCell').slice(0, N).map((c, k) => clampSpan(contents(kid(c, 'CellContents')), N - k)) }));
      const Corner = list(kid(e, 'TablixCorner'), 'TablixCornerRows', 'TablixCornerRow').map(r => kids(r, 'TablixCornerCell').map(c => contents(kid(c, 'CellContents'))));
      itemNotes = notesOf;
      return { ...base, Body: { Columns: cols.map(w => ({ Width: w })), Rows }, Corner, RowHierarchy: rowH, ColumnHierarchy: colH };
    } finally { region = saved; }
  }

  /* ---------------------------------------------------------------- charts and gauges */

  const PALETTE = { default: 'Standard', earthtones: 'Cocoa', excel: 'Office', grayscale: 'GrayScale', light: 'Light', pastel: 'Light', brightpastel: 'Light',
    semitransparent: 'Standard', berry: 'Pink', chocolate: 'Cocoa', fire: 'Orange', seagreen: 'Green' };
  const SHAPE = { pie: 'Pie', explodedpie: 'Pie', doughnut: 'Doughnut', explodeddoughnut: 'Doughnut', funnel: 'Funnel', pyramid: 'Pyramid', '3dpie': 'Pie', treemap: 'Treemap' };
  const RANGE = { plain: 'RangeArea', smooth: 'RangeArea', column: 'RangeColumn', bar: 'RangeBar', stock: 'HighLowOpenClose', candlestick: 'Candlestick' };

  /** RDL Type + Subtype → an ActiveReports plot type, the subtype it keeps and the value names it reads. */
  function plotType(type, sub) {
    const t = String(type || 'Column').toLowerCase(), s = String(sub || 'Plain').toLowerCase();
    if (t === 'shape') return { type: SHAPE[s] || 'Pie', values: ['Y'] };
    if (t === 'range') {
      if (!RANGE[s]) note(`its ${sub} range series is drawn as a range column.`);
      const pt = RANGE[s] || 'RangeColumn';
      return { type: pt, values: pt === 'HighLowOpenClose' || pt === 'Candlestick' ? ['High', 'Low', 'Open', 'Close'] : ['Low', 'High'] };
    }
    if (t === 'scatter') return s === 'bubble' ? { type: 'Bubble', values: ['Y', 'Size'] } : { type: 'Scatter', values: ['Y'] };
    if (t === 'polar') return { type: s === 'radar' ? 'Radar' : 'Polar', values: ['Y'] };
    const pt = { column: 'Column', bar: 'Bar', line: 'Line', area: 'Area' }[t];
    if (!pt) { note(`the "${type}" chart type is drawn as a column chart.`); return { type: 'Column', values: ['Y'] }; }
    return { type: pt, values: ['Y'], sub: /percent/.test(s) ? 'PercentStacked' : /stack/.test(s) ? 'Stacked' : undefined, line: s === 'smooth' ? 'Spline' : s === 'stepped' ? 'StepCenter' : undefined };
  }
  const num = (v) => (v == null || v === '' || isExpr(v) || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const firstDyn = (ms) => {
    for (const m of ms) {
      if (exprs(kid(m, 'Group'), 'GroupExpressions', 'GroupExpression').length) return m;
      const d = firstDyn(list(m, 'ChartMembers', 'ChartMember'));
      if (d) return d;
    }
    return null;
  };
  const leaves = (ms) => ms.flatMap(m => { const k = list(m, 'ChartMembers', 'ChartMember'); return k.length ? leaves(k) : [m]; });
  /** SSRS label keywords → ReportWright label placeholders. */
  const keywords = (s) => String(s).replace(/#(PERCENT|VALY|VALX|AXISLABEL|SERIESNAME|LABEL|TOTAL|INDEX)(\{[^{}]{0,20}\})?/gi, (_, k) =>
    ({ percent: '{percent}', valy: '{value}', valx: '{category}', axislabel: '{category}', seriesname: '{series}', label: '{category}' }[k.toLowerCase()] ?? `#${k}`));

  /** An SSRS data bar or sparkline (a chart that Report Builder made for a cell): ReportWright's own visual. */
  function cellVisual(e, mode) {
    const it = common(e, 'visual');
    const cat = firstDyn(list(kid(e, 'ChartCategoryHierarchy'), 'ChartMembers', 'ChartMember'));
    const s = list(kid(e, 'ChartData'), 'ChartSeriesCollection', 'ChartSeries')[0];
    const y = val(kid(list(s, 'ChartDataPoints', 'ChartDataPoint')[0], 'ChartDataPointValues'), 'Y');
    const type = String(raw(s, 'Type') || 'Column').toLowerCase();
    const color = obj(kid(list(s, 'ChartDataPoints', 'ChartDataPoint')[0], 'Style'))?.Color;
    const out = { ...it, Kind: mode === 'databar' ? 'databar' : 'sparkline', Value: y, Color: isExpr(color) ? undefined : color };
    if (out.Kind === 'sparkline') {
      out.Category = cat ? exprs(kid(cat, 'Group'), 'GroupExpressions', 'GroupExpression')[0] : undefined;
      out.VisualStyle = type === 'line' ? 'line' : type === 'area' ? 'area' : 'column';
    } else {
      // SSRS scales the bars to the largest one in the region; ReportWright needs a maximum: the region's total keeps their proportions
      const m = isExpr(y) ? /^\s*=\s*(Sum|Count)\(([^"]*)\)\s*$/i.exec(y) : null;
      if (m && region) { out.Max = `=${m[1]}(${m[2]}, "${region}")`; note('its bars are scaled to the region\'s total, not to the largest bar, so they are shorter than in SSRS.'); }
      else note('its bars have no maximum; set one so they are scaled.');
    }
    return out;
  }

  function chart(e) {
    const mode = String(e.children.find(c => c.name === 'DesignerMode' && c.ns !== NS)?.text || '').toLowerCase();
    if (mode === 'databar' || mode === 'sparkline') return cellVisual(e, mode);
    const saved = region;
    region = e.attrs.Name || region;
    try {
      const it = { ...common(e, 'dvchart'), DataSetName: raw(e, 'DataSetName'), Filters: filters(e) };
      const catMs = list(kid(e, 'ChartCategoryHierarchy'), 'ChartMembers', 'ChartMember');
      const serMs = list(kid(e, 'ChartSeriesHierarchy'), 'ChartMembers', 'ChartMember');
      const cat = firstDyn(catMs);
      const catExpr = cat ? exprs(kid(cat, 'Group'), 'GroupExpressions', 'GroupExpression')[0] : undefined;
      if (cat && firstDyn(list(cat, 'ChartMembers', 'ChartMember'))) note('only its first category grouping is drawn.');
      const catSort = cat ? sorts(cat)[0] : undefined;
      const ser = firstDyn(serMs);
      const serExpr = ser ? exprs(kid(ser, 'Group'), 'GroupExpressions', 'GroupExpression')[0] : undefined;
      const statics = leaves(serMs).filter(m => !kid(m, 'Group'));
      const area = list(e, 'ChartAreas', 'ChartArea')[0];
      const valueAxes = list(area, 'ChartValueAxes', 'ChartAxis');
      const secondName = valueAxes[1]?.attrs.Name;
      /** @type {Map<string, any>} */
      const plots = new Map();
      list(kid(e, 'ChartData'), 'ChartSeriesCollection', 'ChartSeries').forEach((s, i) => {
        if (/^true$/i.test(raw(s, 'Hidden') || '')) return;
        const pt = plotType(raw(s, 'Type'), raw(s, 'Subtype'));
        const axis = secondName && raw(s, 'ValueAxisName') === secondName ? 'secondary' : 'primary';
        const k = `${pt.type}|${pt.sub || ''}|${axis}`;
        let p = plots.get(k);
        if (!p) {
          p = { PlotName: `Plot${plots.size + 1}`, PlotChartType: pt.type, PlotChartSubtype: pt.sub, Config: { LineAspect: pt.line }, Encodings: { Values: [] }, axis };
          plots.set(k, p);
        }
        const dp = list(s, 'ChartDataPoints', 'ChartDataPoint')[0];
        const vals = kid(dp, 'ChartDataPointValues');
        const srcs = pt.values.map(n => val(vals, n)).filter(v => v != null && v !== '');
        if (!srcs.length) return;
        const caption = val(path(s, 'ChartItemInLegend'), 'LegendText') || (statics[i] && val(statics[i], 'Label')) || s.attrs.Name;
        p.Encodings.Values.push({ Field: { Value: srcs }, Caption: isExpr(caption) ? s.attrs.Name : caption });
        const x = val(vals, 'X');
        if (x && !p.x) p.x = x;
        const lbl = kid(dp, 'ChartDataLabel');
        if (lbl && /^true$/i.test(raw(lbl, 'Visible') || '') && !p.Config.Text) {
          const lf = obj(kid(lbl, 'Style'))?.Format;
          let l = val(lbl, 'Label');
          if (isExpr(l) && lf && !isExpr(lf)) l = `=Format(${l.trimStart().slice(1)}, ${vb(lf)})`;
          p.Config.Text = { Template: l && !/^true$/i.test(raw(lbl, 'UseValueAsLabel') || '') ? keywords(l) : '{value}', TextPosition: /inside|outside|center/i.test(raw(lbl, 'Position') || '') ? raw(lbl, 'Position') : 'Auto' };
        }
        const a = action(dp);
        if (a && !p.Action) p.Action = a;
      });
      const enc = (v) => (v == null ? undefined : { Field: { Value: [v] } });
      const Plots = [...plots.values()].map(p => {
        const { axis, x, ...rest } = p;
        rest.Encodings.Category = enc(x || catExpr);
        if (rest.Encodings.Category && catSort && !x) { rest.Encodings.Category.Sort = catSort.Direction || 'Ascending'; rest.Encodings.Category.SortingField = catSort.Value; }
        if (serExpr) rest.Encodings.Details = [enc(serExpr)];
        return rest;
      });
      if (!Plots.length) note('it has no series with a value.');
      const axis = (a, type) => {
        if (!a) return null;
        if (/^false$/i.test(raw(a, 'Visible') || '')) { note(`its ${type === 'X' ? 'category' : 'value'} axis is hidden in SSRS; ReportWright draws it.`); return { AxisType: type }; }
        const grid = raw(kid(a, 'ChartMajorGridLines'), 'Enabled');
        const title = val(kid(a, 'ChartAxisTitle'), 'Caption');
        const st = obj(kid(a, 'Style')) || {};
        return { AxisType: type, Title: title || undefined, Format: st.Format, Min: num(raw(a, 'Minimum')), Max: num(raw(a, 'Maximum')),
          Scale: /^true$/i.test(raw(a, 'LogScale') || '') ? 'Logarithmic' : undefined, LogBase: raw(a, 'LogBase'), Reversed: raw(a, 'Reverse'),
          LabelAngle: num(raw(a, 'Angle')), MajorGrid: /^(true|false)$/i.test(grid || '') ? { Hidden: /^false$/i.test(grid) } : undefined };
      };
      const Axes = [axis(list(area, 'ChartCategoryAxes', 'ChartAxis')[0], 'X'), axis(valueAxes[0], 'Y'), axis(valueAxes[1], 'Y')].filter(Boolean);
      if (Axes[2]) Axes[2].Plots = Plots.filter((_, k) => [...plots.values()][k].axis === 'secondary').map(p => p.PlotName);
      const legend = list(e, 'ChartLegends', 'ChartLegend')[0];
      const title = list(e, 'ChartTitles', 'ChartTitle').find(t => !/^true$/i.test(raw(t, 'Hidden') || ''));
      const pal = String(raw(e, 'Palette') || '').toLowerCase();
      const custom = list(e, 'ChartCustomPaletteColors', 'ChartCustomPaletteColor').map(c => c.text);
      return {
        ...it, Plots, PlotArea: { Axes }, Legend: { Hidden: !legend || /^true$/i.test(raw(legend, 'Hidden') || '') },
        Header: title ? { Title: val(title, 'Caption') } : undefined,
        Palette: custom.length ? 'Custom' : PALETTE[pal] || (pal ? raw(e, 'Palette') : undefined), CustomPalette: custom.length ? custom : undefined,
      };
    } finally { region = saved; }
  }

  /** A gauge becomes ReportWright's half-circle gauge; a state indicator its icon set. */
  function gauge(e) {
    const it = common(e, 'dvchart');
    const ind = list(e, 'StateIndicators', 'StateIndicator')[0];
    const gauges = [...list(e, 'RadialGauges', 'RadialGauge'), ...list(e, 'LinearGauges', 'LinearGauge')];
    if (ind && !gauges.length) {
      const value = val(kid(ind, 'GaugeInputValue'), 'Value');
      const style = String(raw(ind, 'IndicatorStyle') || '');
      const states = list(ind, 'IndicatorStates', 'IndicatorState').map(s => num(raw(kid(s, 'StartValue'), 'Value'))).filter(v => v != null).sort((a, b) => a - b);
      const transform = raw(ind, 'TransformationType') ?? 'Percentage';
      if (!/^none$/i.test(transform)) note('its states are percentages of the value range in SSRS; here the thresholds compare the value itself.');
      if (states.length !== 3) note(`it has ${states.length} states; ReportWright icon sets have 3 (low, middle, high).`);
      return { ...it, Type: 'indicator', Value: value, Lower: states[1] != null ? `=${states[1]}` : undefined, Upper: states[2] != null ? `=${states[2]}` : undefined,
        IconSet: /arrow/i.test(style) ? 'arrows' : /flag/i.test(style) ? 'flags' : /sign|symbol/i.test(style) ? 'symbols' : /star|rating|box|pie|bar/i.test(style) ? 'ratings' : 'trafficLights' };
    }
    if (!gauges.length) return { ...it, Type: 'GaugePanel' };
    if (gauges.length > 1) note('only its first gauge is drawn.');
    const g = gauges[0];
    const scale = kids(kid(g, 'GaugeScales'))[0];
    const pointer = kids(kid(scale, 'GaugePointers'))[0];
    const value = val(kid(pointer, 'GaugeInputValue'), 'Value');
    note('its ranges, ticks, extra pointers and frame are left out.');
    const gcfg = { Sweep: num(raw(scale, 'SweepAngle')), PointerType: raw(pointer, 'Type') }; // shape from the sweep; Needle, Marker or Bar
    return { ...it, DataSetName: raw(e, 'DataSetName'), Plots: value ? [{ PlotChartType: 'Gauge', Config: gcfg, Encodings: { Values: [{ Field: { Value: [value] } }] } }] : [],
      PlotArea: { Axes: [{ AxisType: 'Y', Min: num(raw(kid(scale, 'MinimumValue'), 'Value')), Max: num(raw(kid(scale, 'MaximumValue'), 'Value')) }] }, Legend: { Hidden: true } };
  }

  /* ---------------------------------------------------------------- data, parameters, page, report */

  // what Variables!x and ReportItems!x refer to
  (function prepass(e, reg) {
    if (e.ns !== NS) return;
    if (e.name === 'Variable' && e.attrs.Name) variables.set(e.attrs.Name.toLowerCase(), raw(e, 'Value') ?? '');
    if (e.name === 'Textbox' && e.attrs.Name) boxes.set(e.attrs.Name.toLowerCase(), { value: joinRuns(paragraphs(e), false), region: reg });
    const r = e.name === 'Tablix' || e.name === 'Chart' ? e.attrs.Name || reg : reg;
    for (const c of e.children) prepass(c, r);
  })(root, null);

  const TYPE_OF = (t) => (/datetime|date$/i.test(t) ? 'date' : /int|decimal|double|single|byte|float/i.test(t) ? 'number' : /boolean/i.test(t) ? 'boolean' : null);
  const DataSources = list(root, 'DataSources', 'DataSource').map(d => {
    const name = d.attrs.Name;
    const cp = kid(d, 'ConnectionProperties');
    let provider = raw(cp, 'DataProvider') || '';
    if (!cp && kid(d, 'DataSourceReference')) {
      provider = 'SQL';
      notes.push(`Data source "${name}" is the shared data source "${raw(d, 'DataSourceReference')}", whose connection is not in the file; it is treated as SQL Server.`);
    }
    if (/^(OLEDB-MD|ESSBASE|SAPBW|SQLAS|HYPERION)/i.test(provider)) provider = `${provider} (MDX)`; // a cube query, not SQL
    return { Name: name, ConnectionProperties: { DataProvider: provider, ConnectString: raw(cp, 'ConnectString') ?? '' } };
  });
  /** @type {Map<string, any[]>} rows of the data sets typed into the report */
  const entered = new Map();
  const providers = new Map(DataSources.map(d => [d.Name, String(d.ConnectionProperties.DataProvider).toUpperCase()]));
  const DataSets = list(root, 'DataSets', 'DataSet').map(d => {
    const q = kid(d, 'Query');
    const shared = path(d, 'SharedDataSet', 'SharedDataSetReference');
    if (shared) notes.push(`Data set "${d.attrs.Name}" is the shared data set "${shared.text}", which is not in the file; set its source and query.`);
    const types = new Map();
    const Fields = list(d, 'Fields', 'Field').map(f => {
      const tn = f.children.find(c => c.name === 'TypeName' && c.ns !== NS)?.text;
      const type = tn ? TYPE_OF(tn) : null;
      const df = raw(f, 'DataField');
      if (df != null && type) types.set(df, type);
      return { Name: f.attrs.Name, DataField: df != null && type ? `${df}[${type}]` : df, Value: df == null ? val(f, 'Value') : undefined };
    });
    let source = raw(q, 'DataSourceName') ?? '';
    if (providers.get(source) === 'ENTERDATA') {
      // data typed into Report Builder ("Enter Data"): rows as XML in the query; they become rows embedded in the report
      const name = DataSources.some(x => x.Name === `${source}_${d.attrs.Name}`) ? `${source}_${d.attrs.Name}_2` : `${source}_${d.attrs.Name}`;
      const rows = enteredRows(raw(q, 'CommandText') ?? '', types, d.attrs.Name);
      entered.set(d.attrs.Name, rows);
      DataSources.push({ Name: name, ConnectionProperties: { DataProvider: 'JSON', ConnectString: `jsondata=${JSON.stringify(rows)}` } });
      source = name;
    }
    const xmlQ = providers.get(source) === 'XML' ? ssrsXmlQuery(raw(q, 'CommandText') ?? '', Fields, d.attrs.Name, DataSources.find(x => x.Name === source)) : null;
    return {
      Name: d.attrs.Name,
      Fields,
      Query: { DataSourceName: source, CommandText: xmlQ ? '' : providers.get(raw(q, 'DataSourceName') ?? '') === 'ENTERDATA' ? '' : raw(q, 'CommandText') ?? '', CommandType: raw(q, 'CommandType'),
        ...(xmlQ ? { Xml: xmlQ } : {}),
        QueryParameters: list(q, 'QueryParameters', 'QueryParameter').map(p => ({ Name: String(p.attrs.Name || '').replace(/[^@\w]/g, ''), Value: val(p, 'Value') })) },
      Filters: filters(d),
    };
  });
  for (const d of DataSources.filter(x => String(x.ConnectionProperties.DataProvider).toUpperCase() === 'ENTERDATA')) DataSources.splice(DataSources.indexOf(d), 1);
  /**
   * The SSRS XML data provider's query: an ElementPath ("Customers {}/Customer {Name, @ID(Integer)}/Orders/Order"), alone
   * or in <Query> with <ElementPath>, <XmlData> (the XML itself) or <Method>/<SoapAction> (a SOAP call). The rows are the
   * last element; fields listed on an element above it read from there (../Name). Prefixes are dropped: an unprefixed
   * name matches any namespace, as IgnoreNamespaces. Sets the fields' DataField to their relative XPath.
   */
  function ssrsXmlQuery(cmd, fields, set, source) {
    const out = {};
    let ep = String(cmd || '').trim();
    if (ep.startsWith('=')) { notes.push(`Data set "${set}": its XML query is an expression; set the XPath to the rows.`); return out; }
    if (ep.startsWith('<')) {
      let doc;
      try { doc = parseXml(ep); } catch (e) { notes.push(`Data set "${set}": its XML query could not be read (${e instanceof Error ? e.message : e}).`); return out; }
      const data = /<XmlData[^>]*>([\s\S]*)<\/XmlData>/.exec(ep)?.[1];
      if (data != null) out.inline = data.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1');
      const method = doc.children.find(c => c.name === 'Method');
      if (method && /^[A-Za-z_][\w.-]*$/.test(method.attrs.Name || '')) {
        const ns = method.attrs.Namespace || '';
        const sub = (e, n) => e?.children.find(c => c.name === n); // the query's own elements (no RDL namespace)
        const params = ((sub(method, 'Parameters') || sub(doc, 'Parameters'))?.children || []).filter(c => c.name === 'Parameter' && /^[A-Za-z_][\w.-]*$/.test(c.attrs.Name || ''));
        const body = params.map(p => `<${p.attrs.Name}>{Parameters.${p.attrs.Name}}</${p.attrs.Name}>`).join('');
        out.soap = { action: sub(doc, 'SoapAction')?.text.trim() || (ns ? `${ns.replace(/\/$/, '')}/${method.attrs.Name}` : method.attrs.Name),
          envelope: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method.attrs.Name}${ns ? ` xmlns="${ns.replace(/[<>"&]/g, '')}"` : ''}>${body}</${method.attrs.Name}></soap:Body></soap:Envelope>` };
        if (params.length) notes.push(`Data set "${set}": its SOAP parameters are sent from the report parameters of the same name; check the envelope.`);
      }
      ep = (doc.children.find(c => c.name === 'ElementPath')?.text || '').trim();
    }
    if (source && !out.inline) out.url = String(source.ConnectionProperties.ConnectString || '').trim();
    if (!ep) return out; // no path: the likeliest repeating element
    const items = [];
    let depth = 0, cur = '';
    for (const c of ep) { if (c === '{') depth++; if (c === '}') depth--; if (c === '/' && !depth) { items.push(cur); cur = ''; } else cur += c; }
    items.push(cur);
    const byName = new Map();
    const names = items.map((it, i) => {
      const m = /^\s*([^{\s]+)\s*(?:\{([^}]*)\})?\s*$/.exec(it);
      if (!m) return null;
      const up = '../'.repeat(items.length - 1 - i);
      for (const f of (m[2] || '').split(',').map(x => x.trim()).filter(Boolean)) {
        const fm = /^(@?)([\w.-]+)\s*(?:\(\s*\w+\s*\))?$/.exec(f);
        if (fm) byName.set(fm[2], `${up}${fm[1]}${fm[2]}`);
      }
      return m[1].replace(/^[^:]*:/, '');
    });
    if (names.some(n => !n)) { notes.push(`Data set "${set}": its element path "${ep}" could not be read; set the XPath to the rows.`); return out; }
    out.path = '/' + names.join('/');
    for (const f of fields) {
      const df = String(f.DataField ?? '').replace(/\[\w+\]$/, '');
      const pth = byName.get(df) ?? byName.get(df.replace(/^@/, ''));
      if (pth && pth !== df) f.DataField = pth + (/\[(\w+)\]$/.exec(String(f.DataField))?.[0] || '');
    }
    return out;
  }
  /** Rows of an "Enter Data" query (<Query><XmlData><Data><Row><Col>v</Col>…), typed by the fields. */
  function enteredRows(xml, types, set) {
    let doc;
    try { doc = parseXml(xml); } catch (e) { notes.push(`Data set "${set}": its entered data could not be read (${e instanceof Error ? e.message : e}), so it has no rows.`); return []; }
    const data = doc.children.find(c => c.name === 'XmlData')?.children[0];
    return (data?.children || []).map(r => Object.fromEntries(r.children.map(c => {
      const t = types.get(c.name), v = c.text;
      if (t === 'number' && v.trim() !== '' && Number.isFinite(Number(v))) return [c.name, Number(v)];
      if (t === 'boolean' && /^(true|false)$/i.test(v.trim())) return [c.name, /true/i.test(v)];
      return [c.name, v];
    })));
  }
  const hidden = new Set();
  const ReportParameters = list(root, 'ReportParameters', 'ReportParameter').map(p => {
    const dv = kid(p, 'DefaultValue'), vv = kid(p, 'ValidValues');
    const ref = (r) => r && { DataSetName: raw(r, 'DataSetName'), ValueField: raw(r, 'ValueField'), LabelField: raw(r, 'LabelField') };
    if (/^true$/i.test(raw(p, 'Hidden') || '') || /^true$/i.test(raw(p, 'Internal') || '')) hidden.add(String(p.attrs.Name || '').replace(/[^A-Za-z0-9_]/g, '_'));
    const date = /^datetime$/i.test(raw(p, 'DataType') || '');
    /** SSRS writes literal dates in the invariant culture: 10/31/2020 12:00:00 AM → 2020-10-31. */
    const lit = (v) => { const m = date && typeof v === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: |$)/.exec(v) : null; return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v; };
    const dref = ref(kid(dv, 'DataSetReference'));
    const rows = dref && entered.get(dref.DataSetName);
    let values = list(dv, 'Values', 'Value').map(v => (v.attrs.nil === 'true' ? null : lit(fix(v.text))));
    if (rows && dref.ValueField) {
      // a default from a data set typed into the report: its rows are known now
      const all = rows.map(r => r[dref.ValueField]).filter(v => v != null);
      values = /^true$/i.test(raw(p, 'MultiValue') || '') ? all : all.slice(0, 1);
    }
    return {
      Name: p.attrs.Name, DataType: raw(p, 'DataType'), Prompt: val(p, 'Prompt'), MultiValue: raw(p, 'MultiValue'), Nullable: raw(p, 'Nullable'), AllowBlank: raw(p, 'AllowBlank'),
      DefaultValue: dv && { Values: values, DataSetReference: rows ? undefined : dref },
      ValidValues: vv && { ParameterValues: list(vv, 'ParameterValues', 'ParameterValue').map(v => ({ Value: lit(raw(v, 'Value')), Label: raw(v, 'Label') })), DataSetReference: ref(kid(vv, 'DataSetReference')) },
    };
  });
  const EmbeddedImages = list(root, 'EmbeddedImages', 'EmbeddedImage').map(i => ({ Name: i.attrs.Name, MIMEType: raw(i, 'MIMEType'), ImageData: raw(i, 'ImageData') }));
  const code = raw(root, 'Code');
  if (code && code.trim()) notes.push(`The report has custom code (Visual Basic, ${code.trim().split('\n').length} lines). It is not run: expressions that call Code.… are shown as text. The code is kept in "customCode"; rewrite what you need as report functions.`);
  if (year < 2008) notes.push(`This is an RDL ${year} report: its Table, Matrix, List and Chart items use the old layout and are left out. Open and save it in Report Builder or Visual Studio to upgrade it to RDL 2008 or later, then import it again.`);

  const band = (b) => b && { Height: raw(b, 'Height'), PrintOnFirstPage: raw(b, 'PrintOnFirstPage'), PrintOnLastPage: raw(b, 'PrintOnLastPage'), Style: styleOf(b), ReportItems: items(kid(b, 'ReportItems')) };
  const PAGE_KEYS = ['PageWidth', 'PageHeight', 'TopMargin', 'BottomMargin', 'LeftMargin', 'RightMargin', 'Columns', 'ColumnSpacing'];
  const pageOf = (...srcs) => Object.fromEntries(PAGE_KEYS.map(k => [k, srcs.map(s => raw(s, k)).find(v => v != null)]).filter(([, v]) => v != null));
  const section = (s) => {
    const page = kid(s, 'Page');
    const body = kid(s, 'Body');
    const pg = pageOf(page, root);
    // a body wider than the page: SSRS prints the overflow on extra pages; here the page is widened instead
    const need = toPt(raw(s, 'Width')) + toPt(pg.LeftMargin) + toPt(pg.RightMargin);
    if (need > toPt(pg.PageWidth ?? '8.5in') + 1) {
      notes.push(`The report body (${raw(s, 'Width')}) is wider than its page; the page is widened to ${Math.round(need)}pt so nothing is cut off (SSRS prints the overflow on extra pages).`);
      pg.PageWidth = `${need}pt`;
    }
    return { Body: { Height: raw(body, 'Height'), ReportItems: items(kid(body, 'ReportItems')) }, Page: pg,
      PageHeader: band(kid(page, 'PageHeader') || kid(s, 'PageHeader')), PageFooter: band(kid(page, 'PageFooter') || kid(s, 'PageFooter')) };
  };
  const secEls = list(root, 'ReportSections', 'ReportSection');
  const ReportSections = (secEls.length ? secEls : [root]).map(section);
  const lang = raw(root, 'Language');
  return {
    Language: isExpr(lang) ? undefined : lang, DataSources, DataSets, ReportParameters, EmbeddedImages, ReportSections,
    __hidden: hidden, __code: code && code.trim() ? code : undefined,
  };
}
