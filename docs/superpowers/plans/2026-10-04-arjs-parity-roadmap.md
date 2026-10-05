# ActiveReportsJS parity roadmap

**Source:** the line-by-line audit of 4 Oct 2026 (artifact https://claude.ai/artifact/8QYhcbAg8gushBAwurTpwz). It compared Pagewright `main` (d3a4b7d) with ActiveReportsJS 6.2:

| Status | Count |
|---|---|
| Parity | 32 |
| Partial | 20 |
| Behind | 30 |
| Only Pagewright has it | 14 |
| Ahead | 4 |

This roadmap closes the 30 "behind" and 20 "partial" rows.

## Progress

| Phase | State | Notes |
|---|---|---|
| 0. Stabilise and ship | **not started** | Added in review, see below. Do it next. |
| 1. Text and styling | **done, 4 Oct 2026** | 35 new tests, all gates green. The plan file lists 12 corrections to the plan, including a wrong rotation sign in the importer. |
| 2. Rich text and vertical text | **done, 4 Oct 2026**, merged to `main` | See the plan's Status: 4 security fixes from review, gate green. |
| 4. Tables, pivot tables, pagination | **done, 4 Oct 2026**, merged to `main` | Spec `specs/2026-10-04-tablix-design.md`; rows 14–20 shipped; see the plan's Status for gate results and gaps. |
| 5. Charts | **done, 4 Oct 2026**, merged to `main` | All 8 rows (#21–#28). See `2026-10-04-p5-charts.md` Status: decisions taken, importer gaps, gate results. |
| 3, 6, 7 | done, merged to `main` | |
| 8. Reuse and authoring | **done, 4 Oct 2026**, on `main` | All 8 rows (#42–#49). See `2026-10-04-p8-reuse.md` Status. |
| 9 | deferred | |

**Shape:** 9 phases. Each phase:
- is its own branch,
- has its own detailed test-first plan (`2026-10-04-pN-*.md`), written just before the phase starts so it matches the code at that point,
- ends at a gate: all unit tests, the `pw test` snapshots, the e2e suites and a visual check,
- then merges to `main`.

Phase 1's detailed plan is written and done: `2026-10-04-p1-text-styling.md` (its "Status" section lists what changed while building it).

**Coordination:** another session was fixing engine bugs from the stress test in `~/Documents/pagewright-bc` (those bugs are now Phase 0). Before starting a phase, rebase on `main` and read `docs/COORDINATION.md`. Phases 1, 2 and 4 touch `src/engine/items/index.js` and `src/engine/items/paint.js`, which that work also touches.

**Order.** The phase numbers stay as they are (the plan files are named after them), but they are **not** built in number order. The first draft ordered by "what customers hit first" from a feature audit; the review found that put cheap polish first and adoption blockers last. Build in this order:

| Step | Phase | Why here | Estimate (one developer + agent) |
|---|---|---|---|
| 1 | **0. Stabilise and ship** | Nobody can adopt a repo that is not public. The stress-test bugs (blank page before a forced break, TOC out of place) are the first things a new user sees, and they touch the same files as Phases 1, 2 and 4. | 3–5 days |
| 2 | 1. Text and styling | Done. | (done) |
| 3 | 3. Expressions, data, parameters | Cheap, table-driven, and Phase 4 needs `Previous`, `GroupIndex`, `Level`. | 1–1.5 weeks |
| 4 | **7a. Framework wrappers + TypeScript types (row 36 only)** | Moved up from Phase 7. A React or Angular developer evaluating us looks for `npm i @pagewrightjs/react` and types in the first five minutes; without them the evaluation ends. | 1 week |
| 5 | 4. Tables, pivot tables, pagination | The biggest gap (pivot tables). Needs its spec first. | 3–4 weeks |
| 6 | 5. Charts | The second biggest gap. | 2 weeks |
| 7 | 2. Rich text and vertical text | Builds on Phase 1's runs; fewer customers depend on it than on pivots and charts. | 1.5 weeks |
| 8 | 6. Viewer | Print, mobile, toolbar API, languages. | 1.5–2 weeks |
| 9 | 7b. The rest of Phase 7 | Designer API, PDF passwords, barcodes, images, TOC numbering. | 1.5 weeks |
| 10 | 8. Reuse and authoring | Master reports, part libraries, layers. | 3 weeks |
| — | 9. Desktop / VS Code | Deferred. | — |

**Total: about 4–5 months** for one developer working with an agent, if each phase hits its estimate (they will not all). Re-estimate after Phase 3 using the real time Phase 1 took.

**Let real files reorder the middle.** The importer has only **3 real `.rdlx-json` fixtures** (`tests/fixtures/rdlx/`). A feature audit says what ActiveReports *can* do; real files say what customers *use*. Collect at least 20 real reports (MESCIUS forums and samples, GitHub search for `.rdlx-json`, prospects), run them through the importer, and count the warnings by kind. If, say, "rich text is lost" tops the count, Phase 2 moves ahead of Phase 5. Re-run the count at every phase gate.

**A parallel track, not a phase: distribution.** Every phase ships features nobody sees until the repo is public and documented. From Phase 3 on, one day a week: README for strangers, CONTRIBUTING, SECURITY, the docs site with the live playground (see `docs/ROADMAP.md`, week 8), and publishing `@pagewrightjs/*` to npm once the licence and name are decided.

Sizes:
- **S** = under 1 day
- **M** = 1 to 3 days
- **L** = 3 to 7 days
- **XL** = over a week

---

## Phase 0: Stabilise and ship (S–M), added in review

| # | Item | Delivers |
|---|---|---|
| 0.1 | Stress-test engine bugs (`docs/STRESS-TEST.md` in `pagewright-bc`) | Fix the blank page before a forced page break; the table of contents drawn out of place; `Parent.*` lost after a `[*]` spread; an empty image `src` drawing a box; no warning for an item that runs off the page; `CStr(object)`; `Format()` above 2^53. Decide the syntax-error policy (`#Error` in the viewer, fail in the designer). |
| 0.2 | HTML export spacing in mixed Devanagari + Latin lines | Found in Phase 1: the SVG exporter centres each shaped run using the browser's advance widths, so spaces move (`गुरुवार05 मार्च  2026`). Draw shaped runs from the engine's positions: anchor at the run start and set `textLength` to the engine width. |
| 0.3 | Merge the open branches | `pagewright-bc` (stress test, calculated-field `Lookup()` fix), `plan/arjs-parity`, `feat/p1-text-styling`. One `main`, tests green. |
| 0.4 | Ship | Decide the licence (MIT is in the repo) and check the name; add the `license` field to `package.json`; push to GitHub; tag `v0.6`. |

**Gate:** the stress-test report renders with no blank page and the TOC in place; all suites green on the merged `main`; the repo is public.

## Phase 1: Text and styling (S–M): done 4 Oct 2026

Plan: `2026-10-04-p1-text-styling.md`.

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 1 | Underline, strike-through, justify, background images | behind | `textDecoration` (underline, line-through); `textAlign: justify`; `backgroundImage` + `backgroundFit` on any box. Every exporter picks these up, because the engine emits lines and images. |
| 2 | Shrink-to-fit, rotation, condensed text | behind | `shrinkToFit` (font steps down until the text fits) and `rotate` (any angle) on text boxes. Condensed text is folded into shrink-to-fit. |
| 3 | Locale-aware formatting | partial | Month and day names follow the report locale (`MMMM`, `dddd`, `MonthName`). |

**Gate:** each of these renders the same in PDF, SVG/viewer and HTML; Word gets underline, strike-through and justify.

## Phase 2: Rich text and vertical text (L)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 4 | Rich text / HTML with field interpolation | behind | A `richtext` item. It takes an HTML subset (p, span, b/strong, i/em, u, s, sup, sub, br, ul/ol/li, a[href], h1–h6) plus inline CSS (color, font-size, font-weight, font-style, text-decoration, background-color), with `{Fields.x}` interpolation. |
| 5 | Vertical text (tb-rl) | behind | `writingMode: 'tb-rl'` on text boxes, for CJK labels. Uses Phase 1's rotation for Latin text and upright glyph stacking for CJK. |

**Design notes:**
- Layout needs styled runs within a line. The page model's `lines[].runs` already carries per-run fonts for shaped text, so it extends with per-run `color`, `size` and `deco`.
- The HTML is parsed with a small tokenizer, never `innerHTML`. Unknown tags are dropped with a warning. `href` follows the same `http(s):`, `mailto:` and `/` allow-list as `url` actions.
- The importer stops dropping `formattedtext` / `richtext` formatting.

## Phase 3: Expressions, data and parameters (M–L)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 6 | Aggregates | partial | Median, Mode, StDev, StDevP, Var, VarP, DistinctSum, AggregateIf. |
| 7 | Function library | partial | About 60 more functions, using ActiveReportsJS names and semantics:<br>• Text: StartsWith, EndsWith, IndexOf, LastIndexOf, Substring, PadLeft, Split, Chr, TrimStart, TrimEnd.<br>• Math: Sign, Log, Log10, Exp, Truncate, Fix, trigonometry, PI, E.<br>• Dates: DatePart, Weekday, WeekdayName, Quarter, Hour, Minute, Second, AddDays and the other Add* functions, DateValue.<br>• Inspection: IsNumeric, IsDate.<br>• Choice: Choose.<br>• Conversion: ToString and the other To* functions.<br>One table-driven test file covers them all. |
| 8 | Previous, GroupIndex, Level, LookupSet | behind | `Previous(expr[, scope])`, `GroupIndex([scope])`, `LookupSet` (returns an array, used with `Join`). `Level()` ships with Phase 4's recursive groups. |
| 9 | Custom functions | behind | **Decision needed (security):** see "Decisions" below. |
| 10 | Filter operators | partial | TopN, BottomN, TopPercent, BottomPercent, Between. |
| 11 | CSV options | partial | Separator, header row, start row, quote character. |
| 12 | Nested JSON becomes nested data sets | partial | A data set can be `relation: {parent: 'Orders', path: '$.items[*]'}`. Lists and tables bound to it inside a parent region get the parent row's children. |
| 13 | Hidden, allow-null, allow-blank, select-all parameters | partial | `hidden`, `nullable`, `allowBlank`, and a select-all control for multi-value parameters. |

## Phase 4: Tables, pivot tables and pagination (XL)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 14 | Pivot table (tablix) | behind | The matrix becomes a real tablix: nested row and column groups, several value columns, subtotals before or after, % of total / row / column, expand/collapse on row and column groups, and repeated row and column headers. **This is the largest item in the roadmap; it has its own design spec first.** |
| 15 | Recursive hierarchies | behind | `group.parent` expression (id → parent id), `Level()`, indentation by level, and drill-down by level. |
| 16 | Merged cells, several detail rows, regions inside cells | partial | `rowSpan` on cells, several detail rows (the engine already loops rows), and a nested table, list or chart inside a cell with its scope bound to the row. |
| 17 | Banded list and grid list | partial | `list.columns` (rows × columns grid), `printAtBottom` on footers, prevent-orphaned headers. |
| 18 | Wide tables paginate sideways | behind | Horizontal pagination: columns that do not fit continue on the next page set (Z or N order), and row headers repeat. |
| 19 | Page numbers per section | behind | `group.newSection: true` resets `Globals.PageNumber` / `TotalPages` per group instance. This is how one PDF holds many invoices, each numbered "Page 1 of 2". |
| 20 | Multi-section reports | behind | `sections.body` becomes an array of sections, each with its own `page`. Page numbering continues across them. |

## Phase 5: Charts (L)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 21 | Stacked, 100% stacked, range, smooth and stepped lines | partial | `stacked: 'percent'`, `range` series (low/high), `line: 'smooth' \| 'step'`. |
| 22 | Axis control | behind | `axes.y` / `axes.x` with: `min`, `max`, `log`, `title`, `format`, `gridlines`, `labelAngle`, `reversed`; plus a second y axis. |
| 23 | Combo charts | behind | Each series gets its own `type` (column, line or area) and `axis` (primary or secondary). |
| 24 | Bubble, radar, polar, financial, gauge, funnel | behind | Bubble and radar first, then candlestick/OHLC and gauge. Funnel and polar come last. |
| 25 | Trend lines, moving averages, reference lines and bands | behind | `overlays: [{type: 'trend', kind: 'linear' \| 'exp' \| 'poly', order} \| {type: 'movingAverage', period} \| {type: 'line', value} \| {type: 'band', from, to}]`. |
| 26 | Data labels | partial | `labelTemplate` expression per point, positions (inside, outside, center), and a collision-avoidance pass. |
| 27 | Palettes and animations | behind | 12 named palettes. Animations happen in the viewer only, as an SVG/CSS entrance; exports stay static. |
| 28 | Sparkline, bullet, data bar, icon sets | partial | Sparkline area/win-loss types, sparkline range bands, an `iconSet` visual (traffic lights, arrows), and a `rangeBar`. |

## Phase 6: Viewer (M–L)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 29 | Print, full screen, continuous and galley views | behind | A Print button (renders the PDF in a hidden iframe and calls `print()`); full screen; `viewMode: 'single' \| 'continuous' \| 'galley'`. Galley reuses the pageless renderer. |
| 30 | Mobile layout | behind | A compact toolbar under 640px, swipe between pages, and the side panels become sheets. |
| 31 | Toolbar customisation API | behind | `mountViewer({toolbar: {add, remove, replace}})` plus the matching React prop. Every built-in item gets an id. |
| 32 | UI languages | behind | Designer, home and admin strings move into the same i18n tables as the viewer. Ship en, hi, plus es, fr, de, ja, zh, pt-BR, ar (with an RTL UI). **A native speaker reviews each language before it ships**; a machine-translated UI reads as careless. Ship fewer languages rather than unreviewed ones. |
| 33 | Frozen header rows and columns | behind | In continuous view, the repeated header and the first N columns stay visible while scrolling. |
| 34 | Search options | partial | Match case, whole word, and a results list with page numbers. |
| 35 | Custom parameter panel | behind | Parameter `editor: 'slider' \| 'range' \| 'dateRange' \| 'radio' \| 'list' \| 'toggle'`, with a layout grid in the designer's parameter dialog. |

## Phase 7: Developer platform and output (M–L)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 36 | React / Angular / Vue / Svelte components and TypeScript types (**built early, as step 7a; see Order**) | behind | `@pagewrightjs/react`, `/vue`, `/angular`, `/svelte`: thin wrappers over `mountViewer` and a new `mountDesigner`. `.d.ts` files are generated from the JSDoc with `tsc --declaration --allowJs --emitDeclarationOnly`, plus a hand-written `report.d.ts` for the report JSON schema. |
| 37 | Designer customisation API | behind | `mountDesigner(el, {onSave, onOpen, toolbox: {hide}, panels, readOnly, dataSourceTemplates})`. |
| 38 | PDF passwords and permissions | behind | `pdf: {userPassword, ownerPassword, permissions}`, using AES-128 or AES-256 through an encryption pass (pdf-lib has no built-in encryption). Must not break PDF/A or signing; PDF/A forbids encryption, so validation rejects that combination. |
| 39 | Barcode options | partial | Per-symbology options passed to bwip-js (QR error level, version, DataMatrix size, PDF417 columns) and caption position; the picker grows to 30+ symbologies. |
| 40 | Image sources and sizing | partial | Embedded images (a report-level `images` map), database fields (base64), SVG in PDF (rasterised server-side through resvg-wasm, or drawn as vector paths), and `autoSize` / `clip` sizing. |
| 41 | Table of contents numbering | partial | `numbering: 'decimal' \| 'roman' \| 'alpha'` per level, and `source: 'bookmarks' \| 'headings'`. |

## Phase 8: Reuse and authoring (L–XL)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 42 | Named styles → stylesheets | partial | `styles.named[x].parent` inheritance, and a shared `.pw-style.json` file referenced by id. |
| 43 | Themes | partial | A theme file (colours Accent1–6, Major/Minor fonts, constants) referenced as `Theme.Colors.Accent1` in expressions. The theme can be chosen by expression at run time. |
| 44 | Master reports | behind | A report may set `master: '<id>'`. The master's header, footer and locked items wrap the content report's body. Changes to the master propagate on render. |
| 45 | Report part libraries | behind | A library report exposes named items and their `partProperties`. The designer toolbox lists the parts; an instance stores a reference plus overrides. |
| 46 | Layers | behind | `layers: [{name, target: 'all' \| 'screen' \| 'print' \| 'export', locked, visible}]` and `item.layer`. |
| 47 | Fixed-page forms with overflow placeholders | partial | An `overflow` item and `table.overflowTo: '<name>'`, chaining a region's continuation to a placeholder on the next fixed page. |
| 48 | Cell-based design mode | behind | A designer grid mode (snap to cells, no overlap); it is stored as ordinary x/y/w/h, so the engine does not change. |
| 49 | Table and pivot wizards | partial | A pivot wizard (drag fields to rows, columns and values, with % display) on top of the Phase 4 tablix, and "instant visuals" (suggested chart, table and pivot from the selected fields). |

## Phase 9: Desktop designer and VS Code extension (deferred)

| # | Audit row | Was | Delivers |
|---|---|---|---|
| 50 | Desktop designer app and VS Code extension | behind | **Recommend deferring.** The web designer runs locally with `npx pagewright` (Docker or Node), so a desktop app adds packaging and signing cost and no capability. If needed later:<br>• Electron wrapper around `/designer`.<br>• VS Code extension: a custom editor for `*.pw.json` that embeds the designer in a webview. |

---

## Decisions needed before the phase that needs them

1. **Custom functions (Phase 3, #9).**
   - ActiveReportsJS runs arbitrary JavaScript. That is fine for them, because they only run in the user's browser. We also render on the server, where report JavaScript would let anyone with designer rights run code on the server.
   - **Recommendation:** custom functions written in the Pagewright expression language, e.g. `functions: [{name: 'Tax', params: ['amt'], body: '=amt * 0.18'}]`. This covers the common cases (reusable formulas) with no code execution.
   - True JavaScript would need an isolate (QuickJS-wasm) with CPU and memory limits.
2. **Pivot table spec (Phase 4, #14):** write and approve a design spec before the plan.
3. **PDF encryption library (Phase 7, #38):**
   - Option A: write AES encryption on pdf-lib's object graph.
   - Option B: add a dependency (`@pdfsmaller/pdf-encrypt-lite`, MIT [verify]) or run `qpdf` server-side.
   - **Recommendation (changed in review): B.** Encryption is security code where a subtle mistake (weak key derivation, a reused IV, a wrong permission bit) is invisible in tests and fatal in use. Use a maintained, reviewed implementation: `qpdf` on the server, plus a vetted library in the browser only if browser-side encryption is needed at all. Option A only with an outside review of the security handler.
4. **Phase 9:** confirm the deferral.

## Phase gate (every phase)

```bash
cd <worktree> && export PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata
npx vitest run                                   # all unit tests pass
node scripts/check-engine-boundary.mjs           # engine stays framework-free
node bin/pw.mjs test reports                     # snapshots unchanged, or reviewed and updated
PW_EMBED_ORIGINS=http://localhost:4000 npm run build
PW_API_KEYS=test-key PW_WEBHOOK_SECRET=testsecret PW_INTERNAL_HOSTS=127.0.0.1 npx next start -p 3200   # separate terminal
for t in smoke phase2 phase3 phase4 phase-bc galleries progressive drilldown; do BASE=http://localhost:3200 node tests/e2e/$t.mjs; done
```

Also, at every gate:

```bash
node scripts/check-pdf-matches-model.mjs         # PDF text sits where the page model says (0 mismatches)
for i in 1 2 3; do node scripts/perf.mjs; done   # 50k rows; compare with main: no more than ~5% slower
```

- Re-run the importer warning count over the real-file corpus (see Order) and note the top five losses in the phase's plan file.
- Anything that reads a text item's `lines` as "one entry per visual line" must use `visualLines()` (`src/exporters/regions.js`): justified text is one run per word.

Then update the audit artifact's rows for the phase (status → parity), merge to `main`, and push.
