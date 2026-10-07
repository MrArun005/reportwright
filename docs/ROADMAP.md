# ReportWright roadmap: from alternative to replacement

4 Oct 2026. This is the plan to make ReportWright the default choice over ActiveReportsJS and its peers (Telerik, DevExpress, Stimulsoft, Bold Reports). It replaces nothing in [`ARCHITECTURE.md`](ARCHITECTURE.md); it says what comes after the four phases.

## The thesis

ActiveReportsJS is a **component you buy and embed**. ReportWright is a **reporting platform developers adopt**: open source, reports-as-code, server-native, interactive by default, AI-native. That is a different category, and nobody owns it in JavaScript today.

Their 20 years is a moat only where customers need all of it. Most buyers make invoices, statements, grouped lists with totals, a few charts, PDF and Excel. ReportWright does that now. The real gap is about 12 months wide and sits in four places: fonts, data setup, migration, and a long tail of layout edge cases that only real reports expose.

Three facts work for us:

1. **Migration breaks the moat.** An importer that converts 90% of an `.rdlx` turns their install base into our pipeline.
2. **Their architecture is their ceiling.** Browser-only, XML, proprietary designer. Server rendering and reports-as-code need a rewrite on their side. We started where they cannot go.
3. **Edge cases are finite.** Every imported report that breaks becomes a golden test. A hundred real reports in, we have hit most of the walls they hit; it takes a year, not twenty.

## Where we stand (4 Oct 2026)

| Area | Status |
|---|---|
| Engine | Text, image, line, shape, table, matrix, list, container, check box, chart (7 types), barcode, sparkline, data bar, bullet, subreport, table of contents. 50,000 rows → 1,112 pages in 1.6 s. PDF matches the page model (0 mismatches on 300 rows). |
| Interactivity | Drill-down, interactive sort, drill-through with breadcrumb and Back (no depth limit), **click-to-filter on chart points, cells and text boxes**, tooltips, live parameters, document map, search. |
| Export | PDF, Excel, HTML (**interactive, works offline**), CSV. All on the server too. |
| Server | Render API, batches, schedules (DST-safe), webhooks, API keys, SSRF guard, optional basic auth. |
| Designer | Toolbox, inspector, data panel, expression editor with autocomplete, **chart gallery drawn from the report's own API data**, smart guides, rulers, align/distribute, themes, named styles, version history, light and dark theme. |
| Tests | 116 Vitest (engine, golden, security, interactivity), e2e suite, engine boundary check. |

### Honest gaps

- Two font families only; no RTL/Indic/CJK shaping in the report body.
- Data setup is "type a JSONPath"; no SQL; no response explorer.
- No `.rdlx`/`.rdl` importer.
- No users, roles or permissions; one shared password.
- Files on one disk; the job queue dies on restart.
- Embed bundle 2.6 MB; interactive HTML 8 MB.
- 7 chart types; no rich text in cells; no PDF/A, forms or signatures.
- Not published on npm; no docs site; no community.

## The scorecard

Ten dimensions. "Now" is today; "10" is what a 10/10 means. Re-score at the end of every month.

| # | Dimension | Now | 10/10 |
|---|---|---|---|
| 1 | Engine fidelity | 7 | Any font, RTL + Indic + CJK, rich text in cells, nested keep-together that never breaks, viewer/PDF/print pixel-identical |
| 2 | Data connectivity | 5 | Response explorer (click JSON → path + fields), SQL on the server with a credential vault, OData editor, CSV/Excel upload, push API, caching |
| 3 | Designer UX | 6 | A gallery for every item, drag data set → auto table, undo everything, right-click menus, templates, time to first report < 10 min with no docs |
| 4 | Interactivity | 8 | Today's set + shareable state in the URL, several reports cross-filtering on one page, live refresh |
| 5 | Export & server | 8 | + PDF/A, fillable forms, Word, PowerPoint, images; first-page streaming; render farm on a Redis queue |
| 6 | Embedding & integration | 6 | Viewer ≈ 400 KB, React/Vue/Angular/Svelte wrappers, Web Component, theming API, 10 UI languages |
| 7 | Developer experience | 6 | `@reportwright/*` on npm, CLI (`pw render`, `pw test`, `pw diff`), snapshot tests in CI, JSON schema + types, VS Code extension, GitHub Action |
| 8 | Enterprise | 3 | SSO (OIDC/SAML), roles, per-report permissions, audit log, Postgres storage, multi-tenant, horizontal scale |
| 9 | Migration | 0 | `.rdlx`/`.rdl` importer that converts 90% and lists the rest; Crystal and Jasper later |
| 10 | Distribution & ecosystem | 1 | MIT on GitHub, docs site with live playground, template gallery, migration guide, Docker image, hosted free tier, community |

Average today: **5.0**.

## The three bets

**Open core.** Engine, viewer, designer, server and the importer are free under MIT. Enterprise (dimension 8), hosted cloud and support are paid. The open-source slot for a banded report designer in JavaScript is empty: jsreport is templates, Metabase and Superset are BI, Carbone is docx templates.

**Reports-as-code.** Reports are JSON in git already. Add a CLI, snapshot tests, PR diffs that show the rendered page before and after, and a GitHub Action that fails the build when a total changes. Developers adopt tools that fit their workflow.

**AI that builds reports.** The format is JSON and the engine is pure JavaScript, so a model can write a report, render it, inspect the page model, and fix it in a loop on the server. "Describe → preview → insert" in the designer; "describe → full report" on the home page. The chart gallery is step one of this.

## The incremental rule

Every increment is **one week, one shippable thing, one real report that proves it**. No increment ships without a report that exercises it. That is how the edge cases get ground down: not by guessing, but by rebuilding real reports and fixing what breaks.

## The twelve increments

| Week | Increment | Proof report | Scorecard |
|---|---|---|---|
| 1 | Commit and tag `v0.5`. **Any-font support**: drop a TTF/WOFF2 in, use it in a report, subset into the PDF. | Loan statement in a brand font with Hindi body text | 1 → 8 |
| 2 | **Response explorer**: click the API JSON → path, fields, types. | Rebuild the catalogue from blank in < 10 min, no docs | 2 → 7 |
| 3 | **SQL on the server** (Postgres first), connection test. | Sales report straight from a database | 2 → 8 |
| 4 | **Galleries for tables and matrices**; drag a data set → auto table. | Invoice with line items, 5 min from blank | 3 → 8 |
| 5 | **`.rdlx` importer v1**: text, tables, groups, parameters, common expressions; honest skip list. | 3 ActiveReports sample reports imported | 9 → 5 |
| 6 | **Importer v2**: charts, lists, subreports, styles. | 6 sample reports, including the hard ones | 9 → 8 |
| 7 | **Bundle split + npm packages**; Docker image. | Viewer in a fresh Vite app in 3 lines | 6 → 8, 7 → 7 |
| 8 | **Docs site = live playground** (built on the interactive HTML export). Open-source launch. | Show HN; 5 strangers timed to first report | 10 → 6 |
| 9 | **CLI**: `pw render`, `pw test`, `pw diff`; GitHub Action. | CI fails when the statement total changes | 7 → 9 |
| 10 | **Auth (OIDC) + Postgres storage + Redis queue.** | Two replicas; schedules survive a restart | 8 → 7 |
| 11 | **AI builder v1**: describe → JSON → render → check → fix → insert. | "Monthly statement grouped by product with an EMI trend" → working report | 3 → 9 |
| 12 | **Word + PDF/A export; first-page streaming.** Tag `v1.0`. | 50k rows: page 1 in < 1 s | 5 → 9 |

Projected average after week 12: **≈ 8.0**. The remaining points are months 4–12: cloud, dashboards of reports, more importers, marketplace.

## Months 4 to 12

- Hosted cloud: free tier plus usage pricing; white-label; SLA.
- Dashboards: several reports on one page with shared cross-filtering.
- VS Code extension; `pw diff` with visual before/after.
- SSRS `.rdl` and Crystal importers.
- Marketplace for connectors and templates.
- 10 UI languages; framework wrappers; Web Component.

## What we do not build

- A desktop designer. The web designer is the advantage.
- 30 chart types. Ten good ones; embed Vega or ECharts for exotic needs.
- Fillable PDF forms before month 6. Loud ask, small market.
- Our own BI. Pixel-perfect reports only; integrate with BI, do not fight it.

## Gates

| When | Gate |
|---|---|
| Week 8 | 1,000 GitHub stars; 5 real `.rdlx` files migrated; a stranger's time to first report under 10 minutes |
| Month 6 | 10 named production deployments; first paying customer; 50 templates |
| Month 12 | 10k stars; 100k monthly npm downloads; revenue covering one full-time salary |

## The one metric

**Time to first real report, for a stranger, with their own API, with no help: under 10 minutes.** Everything else follows from it. Measure it with five people in week 8, and again every quarter.

## Hard truths

1. This is a 2–3 person, 12-month job. One developer plus an agent gets to `v1.0`; enterprise and cloud need another human, ideally one who sells.
2. "Win the market" means becoming the default open-source choice and a profitable niche business, the path Metabase, Grafana and n8n walked. That is the realistic, and very good, outcome.
3. The importer is the whole adoption story. 60% conversion reads as "broken". It needs 90% with an honest skip list. Budget real time.
4. Platforms are built by people who commit daily. Commit tonight.

## Working rules

- Read [`COORDINATION.md`](COORDINATION.md) before editing; several agents work in this repo.
- Every increment ends with: tests green, the proof report in `reports/`, a line in `STATUS.md`, a commit.
- Collect real `.rdlx` files from week 1. The importer is only as good as its corpus.
- Decide the licence before launch and say it in the README: MIT for the core.
