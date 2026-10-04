# Phase 3: Expressions, data and parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close audit rows #6–#13 of `2026-10-04-arjs-parity-roadmap.md` (Phase 3): aggregates, ~60 functions, Previous / GroupIndex / LookupSet, custom functions, TopN-style filters, CSV options, nested data sets, and parameter flags.

**Architecture:**
- Everything new in the expression language lives in `src/engine/expr/evaluate.js` (`AGG`, `FUNCTIONS`, `call()`), in the same style as the existing functions: eager functions get evaluated arguments, lazy ones (`Choose`, `Previous`, `LookupSet`, aggregates) get AST nodes.
- **Custom functions** are report-level `functions: [{name, params, body}]`, bodies in the Pagewright expression language (decision taken: no JavaScript). The parser learns one new node, a method call `Code.Name(args)`. Parameters bind as local names (a new `ctx.locals`). A per-render function table (`functionTable(def)`) carries the compiled bodies and the call budget; it rides on the evaluation context, which every context copies.
- **Data**: filters become a sequence of steps, so set-level operators (TopN …) can look at all rows; row operators keep their current behaviour. CSV parsing takes options. Data-set rows keep a hidden link (a `WeakMap`) to their parent: the ancestor object of a `[*]` spread, or the parent data set's row for a `relation` data set. `Parent.*` falls back to that link when no list supplies a parent row.
- **Nested data sets**: a data set with `relation: {parent, path}` is built from each parent row's raw object. Its rows array is registered in a `WeakMap` with a `byParent` index; regions (table, list, chart, matrix) ask `related(rows, ctx)` and get only the current parent row's children when a list bound to the parent is around them (`ctx.current[parent]`).
- **Parameters**: `hidden`, `nullable`, `allowBlank` in `resolveParameters`; the viewer hides hidden parameters, gets a Null check box and a Select-all control.

**Tech Stack:** plain JS + JSDoc (`// @ts-check`), Vitest, React (designer/viewer).

---

## Status

(filled in at the end of the phase)

## Design decisions

1. **ActiveReportsJS / RDL semantics, with the engine's null rules.** Functions return `null` for a `null` input where the existing functions do (`Abs(null)` is `null`); numeric results that are not finite (`Log(0)`, `Sqrt(-1)` style) are `null`, like `1 / 0` today. Conversions that cannot convert (`ToInt32("abc")`) throw an expression error, so the cell shows `#Error` and the report gets a warning, as .NET's `Convert` would throw.
2. **Aggregates.**
   - `StDev`/`Var` are sample statistics (n − 1), `StDevP`/`VarP` population (n); nulls and blanks are skipped; fewer than 2 values gives `null` for the sample forms, no values gives `null` for all four. Two-pass (mean first) for accuracy.
   - `Median`: the middle value of the sorted numbers, the mean of the two middle ones for an even count.
   - `Mode`: the most frequent non-null value; on a tie, the value that appeared first.
   - `DistinctSum(distinctExpr, valueExpr[, scope])`: ActiveReports' argument order (`=DistinctSum(Fields!OrderID.Value, Fields!OrderFreight.Value)`): sums `valueExpr` over the first row of each distinct `distinctExpr`.
   - `AggregateIf(condition, "Sum", expr[, scope])`: runs the named aggregate over the rows where the condition holds.
   - Array values inside an aggregate are flattened, so `Sum(LookupSet(…))` adds every match.
3. **Max/Min of two values are not added.** `Max(x, "Scope")` is the aggregate with a scope; a two-value form would make `Max(Fields.a, Fields.b)` ambiguous. Use `IIF(a > b, a, b)`.
4. **`Previous`**:
   - In a detail row, `Previous(expr)` is the previous detail row of the table or list, in display order, across group boundaries (the RDL behaviour that makes `Previous(Fields.g) <> Fields.g` detect a group change). `null` on the first row.
   - `Previous(expr, "Group")` in a detail row is the previous row inside that group instance (`null` at the group's first row).
   - In a group header or footer, `Previous(expr)` / `Previous(expr, "Group")` is `expr` over the previous group instance (`Previous(Sum(Fields.x))` is last group's total). In a list row it is the previous list row (or group).
5. **`GroupIndex([scope])`**: the 1-based position of the current group instance among its siblings; in a list with `groupBy`, the row's group number. `Level()` throws "Level() needs a recursive group (Phase 4)".
6. **Custom functions.**
   - `functions: [{name: 'Tax', params: ['amt'], body: '=amt * 0.18'}]`; callable as `Code.Tax(x)` and `Tax(x)`.
   - Names: identifiers, unique ignoring case, not a built-in function, aggregate or special name (`IIF`, `Lookup`, `Code` …). Parameter names: identifiers, unique, not `Fields`/`Parameters`/`Globals`/`Parent`/`Code` or a keyword. At most 200 functions and 32 parameters each. Bodies are syntax-checked by `validate()`.
   - The body sees its parameters as plain names, plus everything an expression at the call site sees (`Fields`, aggregates over the caller's scope, other custom functions). It does not see the caller's locals.
   - Limits: call depth 32 (recursion stops with "too deep"), 1,000,000 custom calls per render (per function table), wrong argument count is an error.
7. **Filters.** Filters are applied in order; row filters (`=`, `<`, `in`, `like`, `Between` …) and set filters (`TopN`, `BottomN`, `TopPercent`, `BottomPercent`) can be mixed, so `[TopN 10, Region = "South"]` and `[Region = "South", TopN 10]` differ, as listed.
   - `TopN`: the filter's expression is the ranking value, `value` is N. Rows whose value is at least the N-th largest value are kept, **ties included** (more than N rows when the N-th value ties, as RDL documents). Null ranking values are dropped. Row order is kept.
   - `TopPercent`: N percent of the non-null rows, rounded up (`ceil(count × N / 100)`), ties included. `BottomN` / `BottomPercent` mirror them.
   - `Between`: `value` ≤ expr ≤ `value2`, both inclusive; `value` may also be a two-item array. Dates and numeric strings compare like the expression `<` operator.
   - N ≤ 0 keeps no rows; N above the count keeps all; N that is not a number is an error.
8. **CSV.** Options on the source: `separator` (one character; `"\t"`, `"tab"`, `";"` …, default `,`), `quote` (one character, default `"`), `headerRow` (default `true`; without it columns are `Column1`, `Column2` …), `startRow` (1-based line where the header or data starts, default 1). One forward scan, O(n): a quote opens a quoted field only at the start of a field; inside, a doubled quote is a literal quote; separators and CR/LF/CRLF inside quotes are data; text after a closing quote is kept. Blank lines are skipped. At most 10,000 columns.
9. **Parent after a spread.** `jsonPath` with a `[*]` spread records, for each result, the object that held the spread array (for `$.books[*].positions[*]`, the book of each position). Calculated fields, filters and detail rows read it as `Parent.*` when no list row supplies `Parent`. A list's row still wins over the link (tables in a list filter by `Parent.id`, which must keep working).
10. **Nested data sets.** `{name: 'Items', relation: {parent: 'Orders', path: '$.items[*]'}, fields: …}` needs no `source`. The parent must be declared above the child. Children of filtered-out parent rows are not built. Inside a list bound to `Orders`, a table/list/chart/matrix bound to `Items` gets the current order's items (for a grouped list, the items of every order in the group). Anywhere else it gets all items, each with `Parent.*` = its order.
11. **Parameters.**
   - `hidden: true`: not in the viewer's panel; still set by URL, API and drill-through. `validate()` warns when a hidden required parameter has no default.
   - `nullable: true`: `null` is a valid value even when required (the viewer shows a "Null" check box; the JSON API passes `null`). A blank given to a nullable, non-`allowBlank` parameter becomes `null`.
   - `allowBlank: true` (strings): `''` is a valid value even when required.
   - Multi-value parameters: an empty selection already means "all" in an `in` filter (`emptyMeansAll`, documented in `docs/API.md`); the viewer adds a "Select all" check box above the choices.
12. **Bounded work.** Text functions that build strings (`PadLeft`, `PadRight`, `Chr`, `StrReverse`, `Space`) refuse results over 1,000,000 characters. No function takes a regular expression; `Split` and `Replace` use plain `split`. Every new loop runs over its input once (or sorts it once).

## Conventions

- Worktree `~/Documents/pw-engine`, branch `feat/p3-expressions`. Node 22: `export PATH=/usr/local/bin:$PATH TZ=Asia/Kolkata`.
- One file: `npx vitest run tests/engine/functions.test.js`. All: `npx vitest run`.
- After engine edits: `node scripts/check-engine-boundary.mjs`.
- Commit after every task (`feat(expr): …`, `feat(data): …`). **No `Co-Authored-By` trailer.**

## File map

| File | Change |
|---|---|
| `src/engine/expr/parser.js` | `Code.Name(args)` → `{type: 'call', name, args, code: true}` |
| `src/engine/expr/evaluate.js` | new aggregates; ~60 functions; `Choose`, `Previous`, `GroupIndex`, `LookupSet`, `Level` stub; locals; `functionTable()`, `checkFunctions()`, `ROW_PARENT`; `FUNCTION_NAMES` |
| `src/engine/data/index.js` | `parseCsv(text, opts)`; spread parents in `jsonPath`; relation data sets + `related()`; set filters + `Between` |
| `src/engine/index.js` | function table on every context; `resolveParameters` flags; parameterOptions pulls in relation parents |
| `src/engine/items/index.js`, `items/chart.js` | regions use `related()`; scopes carry `prevRows`, `number`; contexts carry `region`, `group`, `current` |
| `src/engine/schema/validate.js` | functions, relations, hidden-required warning |
| `src/importers/rdlx.js` | custom-code warning names the new feature |
| `src/designer/Inspector.jsx`, `DataPanel.jsx`, `Canvas.jsx`, `ExpressionEditor.jsx` | Functions editor; parameter flags; function table on preview contexts |
| `src/viewer/ReportViewer.jsx` (+ `i18n.js`) | hidden parameters, Null check box, Select all (only inside `paramInput` and the panel list) |
| `tests/engine/aggregates.test.js`, `functions.test.js`, `custom-functions.test.js`, `data-p3.test.js`, `params-p3.test.js` | new |
| `reports/expressions-showcase.pw.json` + `reports/__tests__/expressions-showcase.*` | showcase + snapshot |
| `docs/API.md` | the new report keys |

---

### Task 1: Aggregates (#6)

**Files:** `src/engine/expr/evaluate.js`, create `tests/engine/aggregates.test.js`.

- [ ] **Step 1: Failing tests**

```js
import { describe, it, expect } from 'vitest';
import { evalValue } from '../../src/engine/expr/evaluate.js';

const rows = [{ a: 2, k: 'x', f: 5 }, { a: 4, k: 'x', f: 5 }, { a: 4, k: 'y', f: 7 }, { a: null, k: 'z', f: 1 }, { a: 5, k: 'y', f: 7 }, { a: 7, k: 'w', f: 2 }, { a: 9, k: 'w', f: 2 }];
const ctx = (o = {}) => ({ fields: rows[0], aggRows: rows, params: {}, globals: {}, dataSets: { R: rows, Empty: [] }, ...o });
const ev = (s, o) => evalValue(s, ctx(o));

describe('aggregates', () => {
  it('median, mode', () => {
    expect(ev('=Median(Fields.a)')).toBe(4.5); // 2 4 4 5 7 9
    expect(ev('=Median(Fields.a, "Empty")')).toBeNull();
    expect(ev('=Mode(Fields.a)')).toBe(4);
    expect(ev('=Mode(Fields.k)')).toBe('x'); // x, y and w tie at 2: the first seen wins
  });
  it('variance and standard deviation, sample and population', () => {
    expect(ev('=VarP(Fields.a)')).toBeCloseTo(5.5833, 4);
    expect(ev('=Var(Fields.a)')).toBeCloseTo(6.7, 4);
    expect(ev('=StDevP(Fields.a)')).toBeCloseTo(Math.sqrt(5.58333), 4);
    expect(ev('=StDev(Fields.a)')).toBeCloseTo(Math.sqrt(6.7), 4);
    expect(ev('=StDev(Fields.a)', { aggRows: [rows[0]] })).toBeNull();
    expect(ev('=StDevP(Fields.a)', { aggRows: [rows[0]] })).toBe(0);
  });
  it('DistinctSum sums the value once per distinct key', () => expect(ev('=DistinctSum(Fields.k, Fields.f)')).toBe(15));
  it('AggregateIf', () => {
    expect(ev('=AggregateIf(Fields.k = "y", "Sum", Fields.a)')).toBe(9);
    expect(ev('=AggregateIf(Fields.a > 4, "Count", Fields.a, "R")', { aggRows: [] })).toBe(3);
    expect(() => ev('=AggregateIf(True, "Nope", Fields.a)')).toThrow(/unknown aggregate/);
  });
  it('all take a scope', () => expect(ev('=Median(Fields.a, "R")', { aggRows: [] })).toBe(4.5));
});
```

- [ ] **Step 2:** `npx vitest run tests/engine/aggregates.test.js` fails (Unknown function).
- [ ] **Step 3: Implement** in `AGG`:

```js
const nums = (vals) => { const out = []; for (const v of vals) if (v != null && v !== '') { const n = num(v); if (Number.isFinite(n)) out.push(n); } return out; };
function variance(vals, sample) {
  const xs = nums(vals);
  if (xs.length < (sample ? 2 : 1)) return null;
  let m = 0; for (const x of xs) m += x; m /= xs.length;
  let s = 0; for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - (sample ? 1 : 0));
}
// AGG gains:
median: (vals) => { const xs = nums(vals).sort((a, b) => a - b); const n = xs.length; return n ? (n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2) : null; },
mode: (vals) => { /* count by key (dates by time), first to the top count wins */ },
var: (v) => variance(v, true), varp: (v) => variance(v, false),
stdev: (v) => { const x = variance(v, true); return x == null ? null : Math.sqrt(x); }, stdevp: …
```

`DistinctSum` and `AggregateIf` are special cases in `call()` (they take two expressions); both added to the `rowLocal` exclusion. Arrays from the mapped values are flattened before the aggregate runs.

- [ ] **Step 4:** tests pass; `npx vitest run` all green. Commit `feat(expr): Median, Mode, StDev, StDevP, Var, VarP, DistinctSum, AggregateIf`.

### Task 2: The function library (#7)

**Files:** `src/engine/expr/evaluate.js`, create `tests/engine/functions.test.js`.

- [ ] **Step 1: One table-driven test file**

```js
import { describe, it, expect } from 'vitest';
import { evalValue, FUNCTION_NAMES } from '../../src/engine/expr/evaluate.js';

const NOW = new Date(2026, 9, 4, 13, 45, 30); // Sun 4 Oct 2026 13:45:30
const ctx = { fields: { n: null, s: 'Pagewright', d: new Date(2026, 1, 28, 9, 5, 7) }, params: {}, globals: { ExecutionTime: NOW }, dataSets: {}, locale: 'en-IN' };
const ev = (s) => evalValue(s, ctx);
const iso = (d) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;

const CASES = [
  // [expression, expected]
  ['=StartsWith("Pagewright", "Page")', true], ['=StartsWith(Fields.n, "a")', false], ['=EndsWith("abc", "bc")', true],
  ['=IndexOf("banana", "an")', 1], ['=IndexOf("banana", "an", 2)', 3], ['=IndexOf("banana", "x")', -1], ['=LastIndexOf("banana", "an")', 3],
  ['=Substring("abcdef", 2)', 'cdef'], ['=Substring("abcdef", 2, 3)', 'cde'], ['=Substring(Fields.n, 1)', ''],
  ['=PadLeft("7", 3, "0")', '007'], ['=PadRight("ab", 4)', 'ab  '], ['=PadLeft("abcd", 2)', 'abcd'],
  ['=Join(Split("a;b;;c", ";"), "|")', 'a|b||c'], ['=Count(Split("a,b", ","))', 2],
  ['=Chr(65)', 'A'], ['=Chr(-1)', null], ['=Asc("A")', 65], ['=Asc("")', null],
  ['=TrimStart("  a ")', 'a '], ['=TrimEnd("  a ")', '  a'], ['=StrReverse("abc")', 'cba'], ['=LCase("AB")', 'ab'], ['=UCase("ab")', 'AB'],
  ['=Sign(-3)', -1], ['=Sign(0)', 0], ['=Sign(Fields.n)', null], ['=Log(E())', 1], ['=Log(8, 2)', 3], ['=Log(0)', null], ['=Log10(1000)', 3], ['=Exp(0)', 1],
  ['=Truncate(-2.7)', -2], ['=Fix(2.7)', 2], ['=Round(Sin(PI() / 2), 6)', 1], ['=Round(Cos(0), 6)', 1], ['=Round(Tan(0), 6)', 0],
  ['=Round(Asin(1), 4)', 1.5708], ['=Round(Acos(1), 4)', 0], ['=Round(Atan(1), 4)', 0.7854], ['=Round(Atan2(1, 1), 4)', 0.7854], ['=Round(PI, 4)', 3.1416],
  ['=DatePart("yyyy", Fields.d)', 2026], ['=DatePart("q", Fields.d)', 1], ['=DatePart("y", Fields.d)', 59], ['=DatePart("w", Fields.d)', 7], ['=DatePart("ww", CDate("2026-01-04"))', 2],
  ['=Weekday(Fields.d)', 7], ['=Weekday(Fields.d, 2)', 6], ['=WeekdayName(1)', 'Sunday'], ['=WeekdayName(2, True)', 'Mon'],
  ['=Quarter(CDate("2026-11-02"))', 4], ['=QuarterName(CDate("2026-11-02"))', 'Q4'], ['=Hour(Fields.d)', 9], ['=Minute(Fields.d)', 5], ['=Second(Fields.d)', 7],
  ['=Day(AddMonths(CDate("2026-01-31"), 1))', 28], ['=Year(AddYears(CDate("2024-02-29"), 1))', 2025], ['=Day(AddYears(CDate("2024-02-29"), 1))', 28],
  ['=Day(AddDays(CDate("2026-01-31"), 1))', 1], ['=Hour(AddHours(Fields.d, 15))', 0], ['=Minute(AddMinutes(Fields.d, 60))', 5], ['=Second(AddSeconds(Fields.d, 3))', 10],
  ['=AddDays(Fields.n, 1)', null], ['=DateValue("garbage")', null], ['=Hour(DateValue("2026-03-01T10:00:00"))', 0],
  ['=Format(TimeSerial(13, 5, 0), "HH:mm")', '13:05'], ['=Format(TimeSerial(25, 0, 0), "HH")', '01'], ['=DateString()', '10-04-2026'],
  ['=IsNumeric("12.5")', true], ['=IsNumeric("")', false], ['=IsNumeric("1e3")', true], ['=IsNumeric("abc")', false], ['=IsNumeric(Fields.n)', false],
  ['=IsDate("2026-03-01")', true], ['=IsDate("1")', false], ['=IsDate("2026-02-30")', false], ['=IsDate(Fields.d)', true], ['=IsArray(Split("a", ","))', true], ['=IsArray("a")', false],
  ['=Choose(2, "a", "b", "c")', 'b'], ['=Choose(4, "a", "b", "c")', null], ['=Choose(1, "a", Fields.nope)', 'a'],
  ['=ToString(5)', '5'], ['=ToString(0.5, "P0")', '50%'], ['=ToInt32("2.5")', 2], ['=ToInt32(3.5)', 4], ['=ToInt32(Fields.n)', null], ['=ToDouble("1,234.5")', 1234.5],
  ['=ToDecimal("0.1") + ToDecimal("0.2") > 0.3', true], ['=ToBoolean("true")', true], ['=ToBoolean(0)', false], ['=Year(ToDateTime("2026-03-01"))', 2026],
];

describe('function library', () => {
  it.each(CASES)('%s', (src, want) => expect(ev(src)).toEqual(want));
  it('conversions that cannot convert are errors', () => {
    for (const s of ['=ToInt32("abc")', '=ToInt32(3000000000)', '=ToDouble("x")', '=ToBoolean("maybe")', '=ToDateTime("nope")']) expect(() => ev(s)).toThrow();
  });
  it('caps generated strings', () => {
    expect(() => ev('=PadLeft("a", 2000000)')).toThrow(/1,000,000/);
    expect(() => ev('=Space(2000000)')).toThrow(/1,000,000/);
  });
  it('lists every new name for the designer', () => {
    for (const n of ['StartsWith', 'Median', 'Choose', 'ToInt32', 'DatePart', 'LookupSet', 'Previous']) expect(FUNCTION_NAMES).toContain(n);
  });
});
```

- [ ] **Step 2:** fails. **Step 3:** implement in `FUNCTIONS` (eager) and `call()` (`Choose` lazy). `PI`/`E` also as bare names. `.NET` details: `AddMonths`/`AddYears` clamp to the month's last day; `ToInt32` rounds half to even and checks the Int32 range; `TimeSerial` is a time on 1 Jan 0001.
- [ ] **Step 4:** all tests green. Commit `feat(expr): 60 more functions with ActiveReportsJS names`.

### Task 3: Previous, GroupIndex, LookupSet (#8)

**Files:** `evaluate.js`, `items/index.js`; tests appended to `tests/engine/aggregates.test.js` (render-level, through `render()` and `texts()`).

```js
it('Previous in detail rows crosses groups; per group with a scope; group headers see the previous group', async () => {
  const data = { rows: [{ g: 'A', v: 1 }, { g: 'A', v: 2 }, { g: 'B', v: 3 }] };
  const table = { type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 300 }],
    groups: [{ name: 'G', expr: '=Fields.g', header: [{ cells: [{ value: '=Fields.g & ":" & GroupIndex() & ":" & Coalesce(Previous(Sum(Fields.v)), "-")' }] }] }],
    detail: [{ cells: [{ value: '=Fields.v & "<" & Coalesce(Previous(Fields.v), "-") & "|" & Coalesce(Previous(Fields.v, "G"), "-")' }] }] };
  const r = await render(report([table], { data }), { fontStore });
  expect(texts(r.pages[0])).toEqual(['A:1:-', '1<-|-', '2<1|1', 'B:2:3', '3<2|-']);
});
it('LookupSet returns every match; Join and Sum read it', …);
it('Level() says it needs Phase 4', …);
```

Implementation: table scopes get `number` (1-based group position) and `prevRows` (the previous bucket's rows); the base table context gets `region: tableScope`, a group context `group: sc`; list contexts get `region`/`group` the same way. Commit `feat(expr): Previous, GroupIndex, LookupSet`.

### Task 4: Custom functions (#9)

**Files:** `parser.js`, `evaluate.js`, `schema/validate.js`, `engine/index.js`, `importers/rdlx.js`, designer (`Inspector.jsx` Functions list, preview contexts); create `tests/engine/custom-functions.test.js`.

```js
const fns = [{ name: 'Tax', params: ['amt'], body: '=amt * 0.18' }, { name: 'Gross', params: ['amt', 'rate'], body: '=amt + Code.Tax(amt) * rate' }];
const ev = (s, f = fns, o = {}) => evalValue(s, { params: {}, globals: {}, dataSets: {}, fields: { x: 100 }, functions: functionTable({ functions: f }), ...o });
it('calls with Code. and without', () => { expect(ev('=Code.Tax(100)')).toBe(18); expect(ev('=Tax(Fields.x)')).toBe(18); expect(ev('=Gross(100, 2)')).toBe(136); });
it('parameters are local names; caller locals do not leak', () => expect(() => ev('=Leak(1)', [{ name: 'Leak', params: ['q'], body: '=Inner()' }, { name: 'Inner', params: [], body: '=q' }])).toThrow(/Unknown name "q"/));
it('stops recursion at depth 32', () => expect(() => ev('=F(1)', [{ name: 'F', params: ['n'], body: '=F(n + 1)' }])).toThrow(/32/));
it('stops at the call budget', () => expect(() => ev('=F(0)', [{ name: 'F', params: ['n'], body: '=IIF(n < 20, F(n + 1) + F(n + 1), 0)' }])).toThrow(/1,000,000/));
it('checks arity', () => expect(() => ev('=Tax(1, 2)')).toThrow(/1 argument/));
it('validate rejects bad names, clashes, duplicates and bad bodies', () => { … checkFunctions(…) … });
it('a render uses them in cells and in calculated fields', …);
```

Commit `feat(expr): report functions in the expression language (Code.Name)`; designer editor its own commit.

### Task 5: Filter operators (#10)

**Files:** `data/index.js`; create `tests/engine/data-p3.test.js`.

```js
const rows = [{ n: 'a', v: 5 }, { n: 'b', v: 9 }, { n: 'c', v: 9 }, { n: 'd', v: 1 }, { n: 'e', v: null }, { n: 'f', v: 7 }];
const f = (filters) => applyFilters(rows, filters, { params: {}, globals: {}, dataSets: {} }).map(r => r.n).join('');
it('TopN keeps ties and row order', () => { expect(f([{ expr: '=Fields.v', op: 'TopN', value: 2 }])).toBe('bc'); expect(f([{ expr: '=Fields.v', op: 'TopN', value: 3 }])).toBe('bcf'); });
it('BottomN', () => expect(f([{ expr: '=Fields.v', op: 'BottomN', value: 2 }])).toBe('ad'));
it('TopPercent / BottomPercent round up', () => { expect(f([{ expr: '=Fields.v', op: 'TopPercent', value: 40 }])).toBe('bc'); expect(f([{ expr: '=Fields.v', op: 'BottomPercent', value: 20 }])).toBe('d'); });
it('Between is inclusive; value2 or an array', () => { expect(f([{ expr: '=Fields.v', op: 'Between', value: 5, value2: 7 }])).toBe('af'); });
it('huge or zero N', () => { expect(f([{ expr: '=Fields.v', op: 'TopN', value: 1e12 }])).toBe('abcdf'); expect(f([{ expr: '=Fields.v', op: 'TopN', value: 0 }])).toBe(''); });
it('filters run in order', …);
```

Commit `feat(data): TopN, BottomN, TopPercent, BottomPercent and Between filters`.

### Task 6: CSV options (#11)

```js
it('separator, quote, header row, start row', () => {
  expect(parseCsv('a;b\n1;"x;y"\n', { separator: ';' })).toEqual([{ a: '1', b: 'x;y' }]);
  expect(parseCsv('a\tb\r\n1\t2', { separator: 'tab' })).toEqual([{ a: '1', b: '2' }]);
  expect(parseCsv("a,b\n'1,2',3", { quote: "'" })).toEqual([{ a: '1,2', b: '3' }]);
  expect(parseCsv('1,2\n3,4', { headerRow: false })).toEqual([{ Column1: '1', Column2: '2' }, { Column1: '3', Column2: '4' }]);
  expect(parseCsv('title\n\nname,v\nx,1', { startRow: 3 })).toEqual([{ name: 'x', v: '1' }]);
});
it('quoted fields: embedded quotes, separators and line breaks', () => expect(parseCsv('a,b\r\n"x ""q""","l1\r\nl2"\r\n')).toEqual([{ a: 'x "q"', b: 'l1\r\nl2' }]));
it('a quote inside a bare field is data', () => expect(parseCsv('a\n5" pipe\n')).toEqual([{ a: '5" pipe' }]));
it('stays linear on hostile input', () => { const t = '"'.repeat(200000) + ',\n'.repeat(100000); const t0 = Date.now(); parseCsv(t); expect(Date.now() - t0).toBeLessThan(1500); });
it('rejects a multi-character separator', () => expect(() => parseCsv('a', { separator: '::' })).toThrow(/one character/));
```

Commit `feat(data): CSV separator, quote, header row and start row`.

### Task 7: Nested data sets and Parent after a spread (#12)

```js
const orders = { orders: [{ id: 1, cust: 'A', items: [{ sku: 'p', q: 2 }, { sku: 'q', q: 1 }] }, { id: 2, cust: 'B', items: [{ sku: 'r', q: 5 }] }] };
// data sets: Orders (path $.orders[*]), Items (relation {parent: 'Orders', path: '$.items[*]'}, calc field cust = Parent.cust)
it('builds children per parent row, with Parent.* to the parent row', …);         // Items rows: p/A, q/A, r/B
it('a table bound to Items inside a list bound to Orders gets that order\'s items', …); // texts: 1, p, q, 2, r
it('at top level, all children', …);
it('Parent.* after a [*] spread reaches the ancestor object', () => {
  // $.portfolio.books[*].positions[*] with calc field book = Parent.book → the book of each position
});
it('validate: relation parent must be declared above', …);
```

Commit `feat(data): nested data sets (relation) and Parent after a [*] spread`.

### Task 8: Parameters (#13)

```js
it('nullable: null is a value; blank becomes null', () => { … resolveParameters({ parameters: [{ name: 'p', type: 'number', required: true, nullable: true }] }, {}) → { p: null } });
it('allowBlank: blank string satisfies required', …);
it('required without either still fails', …);
it('hidden required parameter without default warns in validate', …);
```

Viewer (`paramInput` only + filter hidden in the panel list), designer parameter dialog (three check boxes). Commit per side.

### Task 9: Showcase, docs, gate

- `reports/expressions-showcase.pw.json`: CSV source with `;` separator, nested JSON orders/items, a report function, TopN filter, Between, the new aggregates and functions; `reports/__tests__/expressions-showcase.test.json` + snapshot (`node bin/pw.mjs test reports --update`, then review the snapshot by eye).
- `docs/API.md`: functions, filters, CSV options, `relation`, parameter flags.
- The full gate from the roadmap (port 3210), `node scripts/stress.mjs 20000 pdf`.

## Known limits (planned)

- No two-value `Max`/`Min` (see decision 3). `Level()` waits for Phase 4.
- `Previous` in a table inside a list row starts again in each list row (each row lays out its own table).
- `Var`/`StDev` use floating point; no decimal type (`ToDecimal` is `ToDouble`).
- Custom functions cannot be recursive beyond depth 32 and have no loops; no JavaScript (decision).
- CSV values stay strings until a field type converts them (as before).
