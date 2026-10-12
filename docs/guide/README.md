# ReportWright feature guide

One page per feature. Each page shows three ways to do it: in the UI, from the CLI (`pw`), and through the API. Where a way does not exist, the page says so.

Base URL in the API examples: `http://localhost:3000`. Keys are sent in the `x-api-key` header. Session routes (UI-only routes) need a sign-in cookie and an `Origin` header that names your server.

## Start here (5 minutes)

1. **Install and see a report (1 min).** Run `npm create reportwright@latest my-app -- --template node --yes`, then `npm i && npm start`. You get a PDF from the sample report. See [create-reportwright](create-reportwright.md).
2. **Render a report from the command line (1 min).** Run `npx pw render <report.pw.json> -d <source>=data.json -f pdf -o out.pdf`. See [render-a-report](render-a-report.md) and [export-formats](export-formats.md).
3. **Add a parameter (1 min).** Pass `-p accountId=LN-2025-001982` to `pw render`, or set `parameters` in an API call. See [parameters](parameters.md).
4. **Call the API (1 min).** Set `PW_API_KEYS` on the server, then call `POST /api/v1/render` with `x-api-key`. See [api-keys-and-limits](api-keys-and-limits.md).
5. **Make it safe for people (1 min).** Set a sign-in before production (`PW_AUTH=users` with `PW_SESSION_SECRET`, or single sign-on). See [sign-in-sso-and-2fa](sign-in-sso-and-2fa.md) and [self-hosting](self-hosting.md).

## Index

✓ = available, ✗ = not available. For the CLI, ✓ means a `pw` command (or a command noted on the page).

| Feature | UI | CLI | API | Page |
|---|:-:|:-:|:-:|---|
| Render a report (PDF) | ✓ | ✓ | ✓ | [render-a-report](render-a-report.md) |
| Export formats (Excel, Word, PowerPoint, HTML, CSV, JSON) | ✓ | ✓ | ✓ | [export-formats](export-formats.md) |
| PDF/A and accessible PDF (PDF/UA) | ✓ | ✓ | ✓ | [pdf-a-and-accessible-pdf](pdf-a-and-accessible-pdf.md) |
| PDF passwords and permissions | ✗ | ✓ | ✓ | [passwords-and-permissions](passwords-and-permissions.md) |
| Digital signatures | ✗ | ✗ | ✓ | [digital-signatures](digital-signatures.md) |
| Parameters | ✓ | ✓ | ✓ | [parameters](parameters.md) |
| Data sources (JSON, REST, GraphQL, CSV, XML, SOAP, OData, SQL, pushed data) | ✓ | ✓ | ✓ | [data-sources](data-sources.md) |
| Grouping and drill-down | ✓ | ✓ (`pw test` state) | ✗ | [grouping-and-drill-down](grouping-and-drill-down.md) |
| Interactive sort and filters | ✓ | ✗ | ✗ | [interactive-sort-and-filters](interactive-sort-and-filters.md) |
| Charts and sparklines | ✓ | ✓ | ✓ | [charts-and-sparklines](charts-and-sparklines.md) |
| Barcodes and QR codes | ✓ | ✓ | ✓ | [barcodes-and-qr](barcodes-and-qr.md) |
| Subreports and drill-through | ✓ | ✓ | ✓ | [subreports-and-drill-through](subreports-and-drill-through.md) |
| Master reports, themes and report parts | ✓ | ✓ | ✗ | [master-reports-themes-and-parts](master-reports-themes-and-parts.md) |
| Large reports and streaming | ✓ | ✓ | ✓ | [large-reports-streaming](large-reports-streaming.md) |
| Batches | ✗ | ✗ | ✓ | [batches](batches.md) |
| Schedules and email | ✓ | ✗ | ✓ | [schedules-and-email](schedules-and-email.md) |
| Import SSRS, JasperReports, BIRT, ActiveReports | ✓ | ✓ | ✓ | [import-ssrs-jasper-birt-activereports](import-ssrs-jasper-birt-activereports.md) |
| HTML export settings | ✓ | ✓ | ✓ (`static` only) | [html-export-settings](html-export-settings.md) |
| Users, roles and report permissions | ✓ | ✗ (`scripts/user.mjs`) | ✓ | [users-roles-and-permissions](users-roles-and-permissions.md) |
| Sign-in, single sign-on and two-factor | ✓ | ✗ | ✓ | [sign-in-sso-and-2fa](sign-in-sso-and-2fa.md) |
| API keys and limits | ✗ | ✗ | ✓ | [api-keys-and-limits](api-keys-and-limits.md) |
| Audit log | ✓ | ✓ (`pw audit`, server only) | ✓ | [audit-log](audit-log.md) |
| Embedding the viewer and designer | ✗ | ✗ | ✗ | [embedding-the-viewer](embedding-the-viewer.md) |
| Self-hosting | ✗ | ✗ | ✗ | [self-hosting](self-hosting.md) |
| Health and monitoring | ✗ | ✗ | ✓ | [health-and-monitoring](health-and-monitoring.md) |
| Start a new app (`npm create reportwright`) | ✗ | ✓ (npm) | ✗ | [create-reportwright](create-reportwright.md) |
| Validation and warnings | ✓ | ✓ | ✓ | [validation-and-warnings](validation-and-warnings.md) |
| Expressions and functions | ✓ | ✗ | ✗ | [expressions-and-functions](expressions-and-functions.md) |
| Draft a report with AI | ✓ | ✗ | ✓ (session) | [ai-report-drafting](ai-report-drafting.md) |

## Related

- [docs/API.md](../API.md): every route, request and response.
- [docs/CONFIG.md](../CONFIG.md): every environment variable.
- [docs/FEATURES.md](../FEATURES.md): the feature list and what is not built yet.
- [packages/cli/README.md](../../packages/cli/README.md): the `pw` command.
