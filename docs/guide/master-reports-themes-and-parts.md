# Master reports, themes and report parts

Reuse layout across reports. A **master** gives many reports the same page header, footer and styles. A **theme** sets colours and fonts. A **report part** is a reusable block (for example, a signature block) that you insert into several reports.

## In the UI

Master report:

1. Open the report in the designer (`/designer/<id>`).
2. Open the report's **Reuse** settings (the designer's **Reuse** label).
3. Pick the master. The master's header, footer, styles and data wrap the report. Your body goes in the master's content placeholder.

Theme:

1. Set the theme's colours (Accent1–6, Dark and Light 1–2, Hyperlink) and fonts (major and minor). A report can also use a theme report. The exact control is not covered in this guide.
2. Refer to them in expressions: `=Theme.Colors.Accent1`, `=Theme.Fonts.MajorFont.Family`.

Report part:

1. In the Inspector of an item, mark it as a report part. Give it typed properties. Its expressions read them as `=PartProperties.Name`.
2. In another report, open the report parts panel, add the library, and insert the part **linked** (it follows the library) or as an **independent copy**.

Layers: named layers with a target: everywhere, screen only, print only, export only or designer only.

## From the CLI

Masters, parts, stylesheets and themes are other `.pw.json` files in the same folder, named by their id. `pw render` loads them automatically:

```bash
pw render reports/content-report.pw.json -f pdf -o content-report.pdf
```

Keep `reports/master-letter.pw.json` (for example) in the same folder as `content-report.pw.json`.

## Through the API

There is no route to manage masters, parts or themes. A saved report that uses them renders through `POST /api/v1/render` like any report. Use the render curl in [render-a-report](render-a-report.md).

## Notes

- Changes to a master show on the next run.
- Masters can have masters, up to 4 levels deep. A master that includes itself is skipped with a warning.
- Limits per render: 50 reused reports, 20,000 items each, 20,000 items in all for parts.
- A master can have several named placeholders. Only the first body section fills the first placeholder. Others fill by name (`sections.content`). See the gap list in `docs/FEATURES.md`.
- Themes use `Theme.Colors.Accent1` syntax, not ActiveReports' `!` syntax.
