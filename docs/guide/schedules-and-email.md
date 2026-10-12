# Schedules and email

Run a report on a timetable: every month, every morning, on the first of each quarter. Each run renders the report and keeps the file for download, or emails it. Use it for statements, daily sales packs and month-end reports.

## In the UI

1. Sign in as a designer or an admin. Open **Schedules** (`/schedules`).
2. In the form, fill in:
   - **Report**: the report to run.
   - **When (cron)**: five fields, for example `0 7 1 * *` (07:00 on the 1st of each month). Presets are offered.
   - **Time zone**: an IANA name, for example `Asia/Kolkata`.
   - **Format**: the output format.
   - **Parameters (one name=value per line)**.
   - **Delivery**: **Keep for download**, or **Email**.
   - For email: **To (allowed domains: …)**, an optional **Subject**, and **Attach the file (a link when it is too large)**.
   - **Render from snapshot**: reuse a fresh snapshot instead of re-running the data.
3. Press **Add schedule**.

The table below the form lists each schedule with **Next run**, **Last run** and actions: **Run now**, disable or enable, and delete.

## From the CLI

Not available in the CLI.

## Through the API

Needs an API key. Create a schedule with `POST /api/v1/schedules` (answers `201`):

```bash
curl -sS -X POST http://localhost:3000/api/v1/schedules \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"Monthly statements","template":"loan-statement","cron":"0 7 1 * *","timezone":"Asia/Kolkata","itemsFrom":{"url":"/api/sample/loans","path":"$[*]","map":{"accountId":"$.id"}},"output":{"type":"folder","folder":"monthly"},"fileName":"{Parameters.accountId}","enabled":true}'
```

Other routes:

```bash
curl -sS http://localhost:3000/api/v1/schedules -H "x-api-key: $PW_API_KEY"            # list, each with nextRunAt
curl -sS -X POST http://localhost:3000/api/v1/schedules/<id>/run -H "x-api-key: $PW_API_KEY"   # run now, gives the batch job
curl -sS -X DELETE http://localhost:3000/api/v1/schedules/<id> -H "x-api-key: $PW_API_KEY"
```

`GET`, `PUT` and `DELETE` on `/api/v1/schedules/<id>` read, change and remove one schedule.

The app's own routes (sign-in session, designers) are `GET|POST /api/schedules`, `PATCH|DELETE /api/schedules/<id>` and `POST /api/schedules/<id>/run`.

## Notes

- Cron supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/15`). Names such as `MON` are not supported. Use numbers. Day of week: 0 or 7 is Sunday.
- The scheduler checks every 30 seconds inside the server process. Schedules live in `data/schedules.json` (or the database when `PW_STORAGE` is set).
- Email needs `PW_SMTP_URL` (for example `smtps://user:password@smtp.yourmail.com:465`), `PW_MAIL_FROM` and `PW_MAIL_ALLOWED_DOMAINS`. Without them the Email option is off.
- Attached files over `PW_MAIL_MAX_ATTACHMENT_MB` (10) are sent as a signed link that lasts `PW_MAIL_LINK_DAYS` (7).
- Run only one server with the scheduler on, or set `PW_SCHEDULER=off` on the others.
- A schedule runs as the user or key that made it, with that user's access at that moment. Once the key or user is removed, it stops.
