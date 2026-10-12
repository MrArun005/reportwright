# Migration assessment

Before you move a folder of SSRS, JasperReports, BIRT or ActiveReports reports, run `pw assess`. It converts nothing and
writes nothing but `assessment.html` and `assessment.json`. It answers: how many reports can be retired, how many
migrate automatically, how many need work, what blocks them, and roughly how long the work takes.

```sh
pw assess legacy-reports -o assessment --usage runs.csv
open assessment/assessment.html
```

In the designer, **Assess first** (next to **Import file**) uploads the files, shows the same summary, and imports nothing.

## Reading the page

1. **The lead line**: "X reports can be retired, Y migrate automatically, Z need work."
2. **Status** per report: *convert fully*, *small fixes* (an approximated item, a note, or a missing style or image),
   *manual work* (a dropped item or an expression ReportWright cannot translate), or *failed* (the file does not parse).
   Readiness is the share that converts fully or needs small fixes.
3. **Top blockers**: notes grouped by what they are (custom code, fonts, column layout, missing styles, ...), with the
   number of reports each affects and the exact note text. Sorted by reports affected, so the first row is the work to
   plan for.
4. **Untranslated expressions** by the function they call. Custom expression work shows here before anyone opens a report.
5. **Data sources**: the types used, and the connections that must be set on the server as `PW_DB_<NAME>=<connection URL>`.
   The connection string is never read from the report file.

## Tiers and hours

| Tier | Meaning | Hours per report (default) |
|---|---|---|
| Retire | No run in `--retire-days` (default 180). Only with `--usage`. | 0 |
| Simple | Converts as it is, a check is enough | 0.25 |
| Medium | A few fixes (small status, or manual work with up to 3 issues) | 2 |
| Complex | Rebuild by hand (manual work with more than 3 issues, or failed) | 8 |

The hours are planning numbers, not measurements. Override them with `--hours simple=0.25,medium=2,complex=8`.

## Usage data (to find what to retire)

Without usage data nothing is retired: the tool cannot know a report is unused. Export a usage table:

- **SSRS**: the execution log, one row per run. Run this on the report server database:

  ```sql
  SELECT ItemPath, TimeStart, UserName, Format, Status
  FROM ExecutionLog3
  WHERE ItemType = 'Report' AND TimeStart >= DATEADD(day, -365, GETDATE())
  ORDER BY ItemPath;
  ```

  Save it as CSV. Rows join to reports by file name without the extension, so `/Sales/Order Detail` matches `Order Detail.rdl`.
- **Anything else**: a table with a report name (`name`, `report` or `reportpath`), `runs` and `lastrun`
  (or `last run date`). JSON arrays of the same objects work too.

A report with no row in the usage table counts as zero runs, so check the count of reports that match before you retire
anything (the page lists them in the Retire tier).

## Limits

The assessment reads at most 500 files, 8 MB each, 256 MB in all. Files past a limit are listed as refused. The
designer endpoint (`POST /api/reports/assess`) takes the same limits, plus a 50 MB upload, and removes its temporary
folder when it answers. Nothing is saved to the server.

## What a readiness score does not say

- Readiness counts a report as ready if it converts with small fixes. Check the Complex and Medium rows before you
  promise a date.
- Fonts that are not bundled (for example DejaVu) are replaced by a bundled font: the page lists them as small fixes.
- Hours do not include testing against the data, sign-off, or the work to set up data sources and users.
