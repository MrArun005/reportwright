# Import SSRS, JasperReports, BIRT and ActiveReports files

Bring existing reports into ReportWright. Import SSRS `.rdl` or `.rdlc`, JasperReports `.jrxml`, BIRT `.rptdesign`, or ActiveReportsJS `.rdlx-json`. Each import lists every item it could not keep exactly, so you can see what to fix.

## In the UI

1. Open the home page (`/`).
2. Click **Import a report file**. The hint says: "Open an ActiveReportsJS (.rdlx-json), SSRS (.rdl, .rdlc), JasperReports (.jrxml) or BIRT (.rptdesign) file".
3. Pick the file. The report opens in the designer as a new report.
4. Read the notes that the import lists. Fix the items it approximated or dropped.

## From the CLI

One file:

```bash
pw import report.jrxml -o report.pw.json
pw import "Sales Report.rdl" -o sales-report.pw.json
```

- `-o out.pw.json`: the output file. Default: the input name with `.pw.json`.
- `-o -`: write to stdout.

A folder (all supported files, including subfolders):

```bash
pw import legacy-reports -o imported --recursive
```

- `-o <outDir>`: required for a folder. The folder layout is kept.
- `--recursive`: go into subfolders.
- `--force`: overwrite an output that was edited after the last import. Without it, that output is kept.
- `--verify`: render each imported report with its embedded data, or with `<id>.data.json` beside it, and check the output.
- `--report path`: where to write the migration report (`import-report.json` and `.html`).
- `--max-files N` (default 2000) and `--max-bytes N` (default 16 MB).

Exit codes for a folder: `0` all imported, `2` some failed, `1` none imported.

## Through the API

Needs the app's sign-in (a designer session), not an API key. Every write needs an `Origin` header that names your server.

Import an SSRS or JasperReports or BIRT file (send the XML as the body):

```bash
curl -sS -X POST "http://localhost:3000/api/reports/import?name=Sales%20Report" \
  -b cookies.txt -H "Origin: http://localhost:3000" \
  -H "content-type: application/xml" \
  --data-binary @sales-report.rdl
```

Import an ActiveReportsJS file (send the JSON as the body):

```bash
curl -sS -X POST "http://localhost:3000/api/reports/import?name=Regional%20sales" \
  -b cookies.txt -H "Origin: http://localhost:3000" \
  -H "content-type: application/json" \
  --data-binary @regional-sales.rdlx-json
```

Response: `201` with `{ id, warnings, stats }`. A file that is not a report answers `400` with `{ error }`. The file is at most 5 MB.

## Notes

- `stats` counts each item as mapped, approximated (a note says what changed) or dropped.
- Connection strings are not imported. Set `PW_DB_<NAME>` on the server (see [data-sources](data-sources.md)).
- Subreports and drill-through targets point at the report id that the target's file name gives. Import the target file too.
- Custom code is never run. Simple SSRS VB functions (one `Return` expression) become report functions; any other code is kept as text, with a note.
- The SSRS importer reads RDL 2008, 2010 and 2016. Maps become map items (embedded shapes, shapefiles from the imported folder, SQL spatial layers). Custom report items and RDL 2005 Table/Matrix/List are not converted.
- Jasper and BIRT crosstabs become matrices.
- JasperReports 3 to 6 and the 7.x format both import.
- The importer reads untrusted files safely: no DTDs, no entity expansion, size and depth caps.
- Folder imports never overwrite an output you edited, unless you pass `--force`.
