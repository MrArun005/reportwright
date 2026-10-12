// @ts-check
/**
 * pw assess <folder>: a migration assessment of a folder of SSRS, JasperReports, BIRT and ActiveReports reports. It runs
 * the batch importer in dry-run mode (src/cli/importBatch.js): nothing is written except the assessment itself, and the
 * answer is one page: how many reports convert as they are, how many need small fixes or manual work, what blocks them,
 * and which data sources must be configured.
 *
 * Status (first that holds):
 *   failed  the file does not parse (or is not a report the importer knows)
 *   manual  an item is dropped, or an expression is not translated
 *   small   an item is approximated, a report note needs a look, or a referenced file is missing
 *   full    none of the above (configuring data sources and fonts is not a fix)
 * Effort: full Low; small Low up to 3 issues, else Medium; manual Medium up to 3 issues, else High; failed High.
 */
import fs from 'node:fs';
import path from 'node:path';
import { importFolder } from './importBatch.js';

/** Limits for an assessment: the importer's own (maxBytes per file) plus a file count and a total size. */
export const ASSESS_LIMITS = Object.freeze({ maxFiles: 500, maxBytes: 8 * 1024 * 1024, maxTotal: 256 * 1024 * 1024 });

/** Blocker categories, first match wins. `config` notes are set-up steps, shown with the data sources, never blockers. */
const CATEGORIES = [
  [
    'Data source configuration',
    /PW_DB_|shared data source|connection string|no XML address|set the XML source/i,
    'config',
  ],
  [
    'Data set with no rows',
    /no rows|rows from Java|gets its rows from|gets its XML from|no data or address|has no rows/i,
  ],
  ['Custom code (scripts, Java, VB)', /custom code|scriptlet|Visual Basic|\bscripts?\b/i],
  ['Cube / MDX source', /\bcube\b|\bMDX\b/i],
  ['Map shapefile', /\bmap\b|shapefile/i],
  ['Crosstab cell items', /crosstab.*\bcell|\bcell\b.*crosstab/i],
  ['Crosstab', /crosstab/i],
  ['Table component', /table component/i],
  ['Unsupported chart type', /\bchart\b.*(not|unsupported|no ReportWright)/i],
  ['Linked reports to import too', /import that report|import the target|import that one|another folder/i, 'linked'],
  ['Parameter defaults from data sets', /default comes from the data set|Label gives the value/i],
  ['Report body wider than its page', /is wider than its page/i],
  ['Sorting and collapsing differs', /sorted by|starts collapsed|depends on an expression/i],
  [
    'Visual details differ (charts, icons, borders)',
    /gauge|palette|border|bars are scaled|icon sets|first category|is drawn|always shown|formatted differently|embedded image|same data as|toggles|ranges, ticks/i,
  ],
  ['Fonts not bundled', /font .* not bundled/i],
  ['Relative image addresses', /image address .* relative|image .* is relative/i],
  ['Totals across pages or columns', /restart on each|page totals|column totals|PAGE_COUNT|COLUMN_COUNT/i],
  ['Column layout differs', /column|new column/i],
  ['Subreports', /subreport|returnValue|sub-report/i],
  ['Text markup and rotation', /rotated|markup|\brtf\b|\bhtml\b/i],
  ['Expressions with no equivalent', /has no ReportWright equivalent|not translated|shown as text/i],
  [
    'Parameters passed by code',
    /passed by Java code|holds a (Image|Collection|JasperReport|JRDataSource)|is hidden in/i,
  ],
  ['Missing styles or templates', /not in the file|style template/i],
  ['SQL needs review', /SQL|query/i],
  ['Not converted', /not converted|is left out|was left out/i],
];

/** @param {string} message @returns {{ category: string, config: boolean, linked: boolean }} */
export function categorize(message) {
  for (const [category, re, kind] of CATEGORIES)
    if (re.test(message)) return { category, config: kind === 'config', linked: kind === 'linked' };
  return { category: 'Other', config: false, linked: false };
}

const count = (n) => (n === 1 ? '1 issue' : `${n} issues`);

/**
 * One report's status, effort and top issues (from the importer's record for it).
 * @param {any} rec an importFolder file record
 */
export function reportStatus(rec) {
  const s = rec.stats || { mapped: 0, approximated: 0, dropped: 0 };
  const unresolved = (rec.references || []).filter((/** @type {any} */ x) => !x.resolved);
  const notes = (rec.notes || []).filter((/** @type {string} */ n) => !categorize(n).config);
  if (rec.status !== 'imported')
    return {
      status: 'failed',
      effort: 'High',
      issues: [rec.error || 'failed'].filter(Boolean),
      counts: { mapped: 0, approximated: 0, dropped: 0, untranslated: 0, unresolved: unresolved.length },
    };
  const untranslated = (rec.expressions || []).length;
  const status =
    s.dropped || untranslated ? 'manual' : s.approximated || notes.length || unresolved.length ? 'small' : 'full';
  const issues = [];
  for (const it of rec.items || []) for (const n of it.notes || []) if (n.kind === 'dropped') issues.push(n.message);
  for (const e of rec.expressions || []) issues.push(`expression not translated (${e.item}): ${e.expression}`);
  for (const it of rec.items || [])
    for (const n of it.notes || []) if (n.kind === 'approximated') issues.push(n.message);
  for (const x of unresolved) issues.push(`${x.kind} not found: ${x.ref}`);
  for (const n of notes) issues.push(n);
  const many =
    status === 'manual'
      ? s.dropped + untranslated > 3
      : status === 'small'
        ? s.approximated + notes.length + unresolved.length > 3
        : false;
  const effort =
    status === 'full'
      ? 'Low'
      : status === 'failed'
        ? 'High'
        : status === 'manual'
          ? many
            ? 'High'
            : 'Medium'
          : many
            ? 'Medium'
            : 'Low';
  return {
    status,
    effort,
    issues: [...new Set(issues)],
    counts: {
      mapped: s.mapped,
      approximated: s.approximated,
      dropped: s.dropped,
      untranslated,
      unresolved: unresolved.length,
    },
  };
}

/** The verdict in plain words, from the readiness score. */
export function verdictFor(total, readiness) {
  if (!total)
    return 'No reports found. Check the folder and its file types (.rdl, .rdlc, .jrxml, .rptdesign, .rdlx-json).';
  if (readiness >= 90)
    return 'Ready: almost every report converts as it is. Plan a review pass and configure the data sources.';
  if (readiness >= 60)
    return 'Mostly ready: a manageable amount of review and small fixes. Migrate the reports that convert fully first.';
  if (readiness >= 30)
    return 'Significant work: many reports need rebuilding by hand. Migrate the clean ones now and budget time for the rest.';
  return 'Not ready: most reports need manual rebuilding. Rebuilding them in ReportWright may cost less than converting.';
}

export const HOURS_DEFAULT = Object.freeze({ simple: 0.25, medium: 2, complex: 8 });
export const RETIRE_DAYS = 180;
const DAY = 864e5;

/** "simple=0.25,medium=2,complex=8" over the defaults. */
export function parseHours(text) {
  const out = { ...HOURS_DEFAULT };
  for (const part of String(text || '')
    .split(',')
    .filter(Boolean)) {
    const [k, v] = part.split('=').map((x) => x.trim());
    const n = Number(v);
    if (!(k in HOURS_DEFAULT) || !Number.isFinite(n) || n < 0)
      throw new Error(`--hours takes simple=<h>,medium=<h>,complex=<h> (hours, 0 or more), got "${part}"`);
    out[k] = n;
  }
  return out;
}

/** A report's key for a usage row: the last path segment, without its extension, lower-case. */
export const reportKey = (/** @type {string} */ name) =>
  String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/\.(rdlc?|jrxml|rptdesign|rdlx-json)$/i, '')
    .trim()
    .toLowerCase();

/** RFC 4180-ish CSV (quoted cells, doubled quotes, CRLF): the first line is the header. */
export function csvRows(text) {
  const rows = [];
  let row = [],
    cell = '',
    q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), (r[i] ?? '').trim()])));
}

/**
 * A usage export into Map<reportKey, { runs, lastRun }>. Accepts the SSRS ExecutionLog3 export (one row per run: ItemPath,
 * TimeStart, optional Status) or a generic table: a report name (name, report, reportname, reportpath), runs, and a last
 * run date (lastrun, lastrundate, last run date). CSV or a JSON array of such objects.
 */
export function parseUsage(text, fileName = '') {
  const rows = /\.json$/i.test(fileName) || text.trimStart().startsWith('[') ? JSON.parse(text) : csvRows(text);
  if (!Array.isArray(rows)) throw new Error('the usage file must be a CSV table or a JSON array');
  /** @type {Map<string, { runs: number, lastRun: Date | null }>} */ const map = new Map();
  for (const raw of rows) {
    const r = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const name = r.itempath ?? r.reportpath ?? r.reportname ?? r.report ?? r.name;
    if (!name) continue;
    const key = reportKey(String(name));
    const cur = map.get(key) || { runs: 0, lastRun: null };
    const runs = r.runs !== undefined && r.runs !== '' ? Number(r.runs) : 1;
    cur.runs += Number.isFinite(runs) ? runs : 0;
    const when = r.timestart ?? r.lastrun ?? r.lastrundate ?? r['last run date'];
    const d = when ? new Date(when) : null;
    if (d && !isNaN(d) && (!cur.lastRun || d > cur.lastRun)) cur.lastRun = d;
    map.set(key, cur);
  }
  return map;
}

/** Tier: Retire (usage given, no run within retireDays), else by effort: Low Simple, Medium Medium, High or failed Complex. */
export function tierOf(status, effort, usage, retireDays, now) {
  if (usage && (!usage.runs || (usage.lastRun && now - usage.lastRun.getTime() > retireDays * DAY))) return 'Retire';
  if (status === 'failed') return 'Complex';
  return effort === 'Low' ? 'Simple' : effort === 'Medium' ? 'Medium' : 'Complex';
}

/**
 * The assessment from an importFolder result (pure: no file system).
 * @param {any} result the importFolder report (dryRun)
 * @param {{ input?: string, limits?: object, usage?: Map<string, { runs: number, lastRun: Date | null }> | null, retireDays?: number, now?: number, hours?: Record<string, number> }} [opts]
 */
export function buildAssessment(result, opts = {}) {
  const now = opts.now ?? Date.now();
  const hours = opts.hours ?? HOURS_DEFAULT;
  const retireDays = opts.retireDays ?? RETIRE_DAYS;
  const reports = result.files.map((/** @type {any} */ rec) => {
    const st = reportStatus(rec);
    const usage = opts.usage ? opts.usage.get(reportKey(rec.source)) || { runs: 0, lastRun: null } : null;
    const tier = tierOf(st.status, st.effort, usage, retireDays, now);
    return {
      file: rec.source,
      format: rec.format,
      status: st.status,
      effort: st.effort,
      tier,
      hours: tier === 'Retire' ? 0 : hours[tier.toLowerCase()],
      usage: usage && { runs: usage.runs, lastRun: usage.lastRun ? usage.lastRun.toISOString() : null },
      counts: st.counts,
      top: st.issues.slice(0, 3),
      issues: st.issues,
      sources: rec.sources || [],
      error: rec.error,
    };
  });
  const tally = (/** @type {string} */ s) => reports.filter((r) => r.status === s).length;
  const tiers = (/** @type {string} */ t) => reports.filter((r) => r.tier === t).length;
  const totals = {
    reports: reports.length,
    full: tally('full'),
    small: tally('small'),
    manual: tally('manual'),
    failed: tally('failed'),
  };
  const readiness = totals.reports ? Math.round(((totals.full + totals.small) / totals.reports) * 100) : 0;
  const tierTotals = {
    retire: tiers('Retire'),
    simple: tiers('Simple'),
    medium: tiers('Medium'),
    complex: tiers('Complex'),
  };
  const estimate = {
    hours: Math.round(reports.reduce((h, r) => h + r.hours, 0) * 100) / 100,
    rule: `Hours rule, per report: Simple ${hours.simple} h (converts as it is, a check), Medium ${hours.medium} h (a few fixes), Complex ${hours.complex} h (rebuild by hand), Retire 0 h (no recent runs)`,
  };
  const lead = `${tierTotals.retire} reports can be retired, ${tierTotals.simple} migrate automatically, ${tierTotals.medium + tierTotals.complex} need work`;

  // blockers: notes grouped by category, with the reports they affect (config notes and info notes are not blockers)
  /** @type {Map<string, { category: string, reports: Set<string>, occurrences: number, texts: Map<string, { text: string, reports: Set<string> }> }>} */
  const groups = new Map();
  const add = (/** @type {string} */ file, /** @type {string} */ text, /** @type {string} */ category) => {
    if (!groups.has(category)) groups.set(category, { category, reports: new Set(), occurrences: 0, texts: new Map() });
    const g = /** @type {any} */ (groups.get(category));
    g.reports.add(file);
    g.occurrences++;
    if (!g.texts.has(text)) g.texts.set(text, { text, reports: new Set() });
    g.texts.get(text).reports.add(file);
  };
  for (const rec of result.files) {
    for (const it of rec.items || [])
      for (const n of it.notes || []) {
        const c = categorize(n.message);
        if (c.config || (n.kind === 'info' && !c.linked)) continue;
        add(rec.source, n.message, c.category);
      }
    for (const note of rec.notes || []) {
      const c = categorize(note);
      if (!c.config) add(rec.source, note, c.category);
    }
    for (const x of rec.references || [])
      if (!x.resolved) add(rec.source, `${x.kind} not found: ${x.ref}`, 'Missing styles or templates');
  }
  const blockers = [...groups.values()]
    .map((g) => ({
      category: g.category,
      reports: g.reports.size,
      occurrences: g.occurrences,
      texts: [...g.texts.values()]
        .map((t) => ({ text: t.text, reports: t.reports.size }))
        .sort((a, b) => b.reports - a.reports || (a.text < b.text ? -1 : 1)),
    }))
    .sort((a, b) => b.reports - a.reports || a.category.localeCompare(b.category));

  // untranslated expressions, grouped by the functions they call (an expression with none: "(no function call)")
  /** @type {Map<string, { pattern: string, count: number, reports: Set<string>, example: string }>} */
  const exprs = new Map();
  for (const rec of result.files)
    for (const e of rec.expressions || []) {
      const names = [
        ...new Set([...String(e.expression).matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)].map((m) => m[1])),
      ];
      for (const k of names.length ? names : ['(no function call)']) {
        if (!exprs.has(k))
          exprs.set(k, { pattern: k, count: 0, reports: new Set(), example: String(e.expression).slice(0, 200) });
        const g = /** @type {any} */ (exprs.get(k));
        g.count++;
        g.reports.add(rec.source);
      }
    }
  const expressionsUntranslated = [...exprs.values()]
    .map((g) => ({ pattern: g.pattern, count: g.count, reports: g.reports.size, example: g.example }))
    .sort((a, b) => b.count - a.count || (a.pattern < b.pattern ? -1 : 1));

  // data sources: by type, and the SQL connections each report names (set PW_DB_<NAME> on the server)
  /** @type {Map<string, { type: string, reports: Set<string> }>} */ const byType = new Map();
  /** @type {Map<string, { connection: string, env: string, reports: Set<string> }>} */ const conns = new Map();
  /** @type {Map<string, Set<string>>} */ const shared = new Map();
  for (const rec of result.files) {
    for (const s of rec.sources || []) {
      if (!byType.has(s.type)) byType.set(s.type, { type: s.type, reports: new Set() });
      byType.get(s.type)?.reports.add(rec.source);
      if (s.type === 'sql' && s.connection) {
        const env = `PW_DB_${String(s.connection).toUpperCase()}`;
        if (!conns.has(env)) conns.set(env, { connection: s.connection, env, reports: new Set() });
        conns.get(env)?.reports.add(rec.source);
      }
    }
    for (const x of rec.references || [])
      if (x.kind === 'shared data source') {
        if (!shared.has(x.ref)) shared.set(x.ref, new Set());
        shared.get(x.ref)?.add(rec.source);
      }
  }
  const dataSources = {
    types: [...byType.values()]
      .map((t) => ({ type: t.type, reports: t.reports.size }))
      .sort((a, b) => b.reports - a.reports),
    connections: [...conns.values()]
      .map((c) => ({ connection: c.connection, env: c.env, reports: c.reports.size }))
      .sort((a, b) => b.reports - a.reports),
    sharedDataSources: [...shared.entries()]
      .map(([ref, r]) => ({ ref, reports: r.size }))
      .sort((a, b) => b.reports - a.reports),
  };

  return {
    tool: 'pw assess',
    schema: 2,
    created: new Date(now).toISOString(),
    input: opts.input ?? result.input,
    limits: opts.limits ?? ASSESS_LIMITS,
    summary: {
      ...totals,
      ...tierTotals,
      readiness,
      lead,
      hours: estimate.hours,
      hoursRule: estimate.rule,
      usageGiven: !!opts.usage,
      retireDays,
      verdict: verdictFor(totals.reports, readiness),
    },
    refused: result.refused || [],
    blockers,
    expressionsUntranslated,
    reports,
    dataSources,
  };
}

/**
 * Assess a folder (nothing is written). @param {string} input
 * @param {{ recursive?: boolean, maxFiles?: number, maxBytes?: number, maxTotal?: number, usage?: Map<string, any> | null, retireDays?: number, now?: number, hours?: Record<string, number> }} [opts]
 */
export async function assessFolder(input, opts = {}) {
  if (!fs.existsSync(input)) throw new Error(`${input} does not exist`);
  const limits = {
    ...ASSESS_LIMITS,
    ...Object.fromEntries(['maxFiles', 'maxBytes', 'maxTotal'].filter((k) => opts[k] != null).map((k) => [k, opts[k]])),
  };
  const result = await importFolder(input, null, {
    dryRun: true,
    recursive: !!opts.recursive,
    maxFiles: limits.maxFiles,
    maxBytes: limits.maxBytes,
    maxTotal: limits.maxTotal,
  });
  return buildAssessment(result, {
    input: path.resolve(input),
    limits,
    usage: opts.usage,
    retireDays: opts.retireDays,
    now: opts.now,
    hours: opts.hours,
  });
}

/** The terminal summary: the lead line first, then the numbers a manager reads. @param {any} a */
export function summaryText(a) {
  const s = a.summary;
  const pct = (/** @type {number} */ n) => (s.reports ? `${Math.round((n / s.reports) * 100)}%` : '0%');
  const lines = [
    `Migration assessment: ${a.input}`,
    `  ${s.lead}.`,
    `  ${s.reports} reports: ${s.full} convert fully (${pct(s.full)}), ${s.small} small fixes, ${s.manual} manual work, ${s.failed} failed. Readiness ${s.readiness}%.`,
    `  Tiers: Retire ${s.retire}, Simple ${s.simple}, Medium ${s.medium}, Complex ${s.complex}.${s.usageGiven ? '' : ' (No usage data: pass --usage to find reports to retire.)'}`,
    `  Estimated effort: ${s.hours} hours. ${a.summary.hoursRule}.`,
    `  ${s.verdict}`,
  ];
  if (a.blockers.length) {
    lines.push('', '  Top blockers (reports affected):');
    for (const b of a.blockers.slice(0, 5)) lines.push(`    ${String(b.reports).padStart(3)}  ${b.category}`);
  }
  if (a.expressionsUntranslated.length) {
    lines.push('', '  Untranslated expressions (by function):');
    for (const e of a.expressionsUntranslated.slice(0, 5))
      lines.push(`    ${String(e.count).padStart(3)}  ${e.pattern}`);
  }
  if (a.dataSources.connections.length) {
    lines.push('', '  Configure on the server:');
    for (const c of a.dataSources.connections) lines.push(`    ${c.env}  (${c.reports} reports)`);
  }
  if (a.refused.length) lines.push('', `  ${a.refused.length} files refused (see assessment.json)`);
  return lines.join('\n');
}

const esc = (/** @type {any} */ s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** The assessment as one standalone page, full width. @param {any} a */
export function assessmentHtml(a) {
  const s = a.summary;
  const blockers = a.blockers.length
    ? `<table><tr><th>Blocker</th><th class="n">Reports</th><th>Exact note</th><th class="n">Reports</th></tr>${a.blockers
        .map((b) =>
          b.texts
            .map(
              (t, i) =>
                `<tr>${i === 0 ? `<td rowspan="${b.texts.length}">${esc(b.category)}</td><td class="n" rowspan="${b.texts.length}">${b.reports}</td>` : ''}<td>${esc(t.text)}</td><td class="n">${t.reports}</td></tr>`,
            )
            .join(''),
        )
        .join('')}</table>`
    : '<p>No blockers: nothing needs a manual change.</p>';
  const rows = a.reports
    .map(
      (/** @type {any} */ r) =>
        `<tr class="${esc(r.status)}"><td>${esc(r.file)}</td><td>${esc(r.format)}</td><td>${esc(r.status)}</td>` +
        `<td class="n">${r.counts.mapped}</td><td class="n">${r.counts.approximated}</td><td class="n">${r.counts.dropped}</td><td>${r.top.map((x) => `<div>${esc(x)}</div>`).join('') || ''}${r.error ? `<div>${esc(r.error)}</div>` : ''}</td><td>${esc(r.effort)}</td><td>${esc(r.tier)}</td><td class="n">${r.hours}</td></tr>`,
    )
    .join('');
  const sources =
    `<h2>Data sources</h2>${a.dataSources.types.length ? `<table><tr><th>Type</th><th class="n">Reports</th></tr>${a.dataSources.types.map((t) => `<tr><td>${esc(t.type)}</td><td class="n">${t.reports}</td></tr>`).join('')}</table>` : '<p>No data sources.</p>'}` +
    (a.dataSources.connections.length
      ? `<h3>Set on the server</h3><table><tr><th>Setting</th><th>Connection</th><th class="n">Reports</th></tr>${a.dataSources.connections.map((c) => `<tr><td><code>${esc(c.env)}=&lt;connection URL&gt;</code></td><td>${esc(c.connection)}</td><td class="n">${c.reports}</td></tr>`).join('')}</table>`
      : '') +
    (a.dataSources.sharedDataSources.length
      ? `<h3>Shared data sources (connection not in the file)</h3><table><tr><th>Reference</th><th class="n">Reports</th></tr>${a.dataSources.sharedDataSources.map((x) => `<tr><td>${esc(x.ref)}</td><td class="n">${x.reports}</td></tr>`).join('')}</table>`
      : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Migration assessment</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1d2025;--mute:#636a74;--line:#dfe2e6;--bad:#b42318;--warn:#9a6700;--ok:#1a7f37;--head:#f4f5f7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#16181c;--fg:#e6e8eb;--mute:#9aa1ab;--line:#30343a;--bad:#ff7b72;--warn:#d29922;--ok:#3fb950;--head:#1f2228}}
:root[data-theme="dark"]{--bg:#16181c;--fg:#e6e8eb;--mute:#9aa1ab;--line:#30343a;--bad:#ff7b72;--warn:#d29922;--ok:#3fb950;--head:#1f2228}
body{margin:0;padding:16px 24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 6px}h3{font-size:14px;margin:14px 0 4px}
p.meta,.mute{color:var(--mute);margin:0 0 12px;overflow-wrap:anywhere}
.verdict{font-size:15px;margin:10px 0 14px}
.cards{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px}.cards div{border:1px solid var(--line);border-radius:6px;padding:6px 12px}.cards b{display:block;font-size:18px}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:var(--head);font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.failed td:first-child,tr.failed td:nth-child(3){color:var(--bad)}tr.manual td:nth-child(3){color:var(--warn)}tr.full td:nth-child(3){color:var(--ok)}
code{font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}
</style></head><body><h1>Migration assessment</h1>
<p class="meta">${esc(a.input)} · ${esc(a.created)} · not converted: nothing was written</p>
<p class="verdict"><b>${esc(s.lead)}.</b> ${esc(s.verdict)}</p>
<div class="cards"><div><b>${s.reports}</b>reports</div><div><b>${s.full}</b>convert fully</div><div><b>${s.small}</b>small fixes</div><div><b>${s.manual}</b>manual work</div><div><b>${s.failed}</b>failed</div><div><b>${s.readiness}%</b>readiness</div><div><b>${s.retire}</b>retire</div><div><b>${s.simple}</b>simple</div><div><b>${s.medium}</b>medium</div><div><b>${s.complex}</b>complex</div><div><b>${s.hours} h</b>estimated effort</div></div>
<p class="mute">${esc(s.hoursRule)}.</p>
<h2>Untranslated expressions</h2>${a.expressionsUntranslated.length ? `<table><tr><th>Function or pattern</th><th class="n">Expressions</th><th class="n">Reports</th><th>Example</th></tr>${a.expressionsUntranslated.map((e) => `<tr><td><code>${esc(e.pattern)}</code></td><td class="n">${e.count}</td><td class="n">${e.reports}</td><td><code>${esc(e.example)}</code></td></tr>`).join('')}</table>` : '<p>Every expression translates.</p>'}
<h2>Top blockers</h2>${blockers}
<h2>Reports</h2><table><tr><th>File</th><th>Format</th><th>Status</th><th class="n">Mapped</th><th class="n">Approximated</th><th class="n">Dropped</th><th>Top issues</th><th>Effort</th><th>Tier</th><th class="n">Hours</th></tr>${rows}</table>
${sources}
${a.refused.length ? `<h2>Refused</h2><ul>${a.refused.map((x) => `<li><code>${esc(x.path)}</code>: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}
<p class="mute">Readiness = (convert fully + small fixes) / reports. Effort rule: see docs/migration-assessment.md.</p>
</body></html>
`;
}
