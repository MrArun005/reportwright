# Operations

Backups and the restore drill, uptime and error alerts, a staging deploy, and cold starts on Vercel.

## Backup and restore

`scripts/backup.mjs` copies the whole storage (reports and their versions, users, grants, folders, schedules, jobs,
fonts, settings, blobs, the audit log with its hash chain) into one SQLite file, and back. It works the same for every
backend (`PW_STORAGE`: the files in the app folder, `sqlite:`, `postgres://`, `mysql://`, `mssql://`); it is the copy
behind `pw migrate-storage`.

```bash
# backup (the server may keep running; for a consistent copy of a busy server, stop it or use pg_dump below)
PW_STORAGE="$DATABASE_URL" node scripts/backup.mjs backup backups/pw-2026-10-06.db
# restore into an empty storage, with the server stopped
PW_STORAGE="$DATABASE_URL" node scripts/backup.mjs restore backups/pw-2026-10-06.db
```

A restore refuses a storage that already holds reports or users; `--force` restores over it (records with the same id
are replaced, audit events already there are kept once). A backup never overwrites a file.

Postgres alone, at the database level (also the blobs and the audit log, all in tables). Keep the password off the
command line (anyone can read a process's arguments with `ps`): put it in `~/.pgpass` (mode 0600) or `PGPASSWORD`,
and pass only host, user and database:

```bash
# ~/.pgpass: host:5432:dbname:user:password
pg_dump --format=custom --no-owner -h host -U user -d dbname > pw.dump
pg_restore --clean --if-exists --no-owner -h host -U user -d dbname pw.dump
```

The backup script prints the storage with `user:password@` masked, and masks the password in any error it reports;
`PW_STORAGE` is read from the environment, never from its arguments.

On Neon, point-in-time restore (History) is the first line; these files are the copy you keep elsewhere. With
`PW_BLOBS=s3://…`, the blobs live in the bucket: version the bucket (or copy it) beside the database backup.

Schedule it with cron (or a GitHub Actions schedule) and keep 7 daily and 4 weekly files:

```cron
15 2 * * * cd /srv/pagewright && PW_STORAGE=… node scripts/backup.mjs backup backups/pw-$(date +\%F).db && find backups -name 'pw-*.db' -mtime +30 -delete
```

### Restore drill (once a quarter, and after storage changes)

1. Take a backup of production: `node scripts/backup.mjs backup drill.db`.
2. Restore it into a scratch storage: `PW_STORAGE=sqlite:/tmp/drill-restore.db node scripts/backup.mjs restore drill.db`
   (or a Neon branch: see Staging).
3. Start a server on it (`PW_STORAGE=sqlite:/tmp/drill-restore.db PORT=3456 sh scripts/restart.sh`), sign in, open a
   few reports and their history, run one, and run `pw audit verify` against it (the chain must check).
4. Write down the date, the backup size and how long the restore took.

The test `tests/engine/b3-backup.test.js` does the drill on SQLite on every run: backup, wipe, restore, verify
(reports, versions, users, settings, the audit log).

## Uptime and error alerts

`/api/v1/readyz` (no key) answers 200 when the storage answers and a render worker is ready. `/api/v1/health` and
`/api/v1/metrics` (a service key, or an admin's key) give the details; `pagewright_http_requests_total` counts answers
by status class.

**Free hosted monitor** (UptimeRobot free: 50 monitors at 5-minute intervals; Better Stack free: 10 monitors at
3 minutes, with a status page): an HTTP(S) monitor on `https://<host>/api/v1/readyz`, expecting 200, alerting by
email (or Slack / Telegram). Add a keyword monitor for `"ok":true` if you want the body checked.

**GitHub Actions** (`.github/workflows/uptime.yml`, every 30 minutes): runs `scripts/uptime-check.mjs`, which checks
readyz (two tries, 10 s each) and, with a key, that 5xx answers stay under 5 % (`PW_MAX_5XX`; once there are 20 or more
answers). On a failure it opens an issue labelled `uptime` (or comments on the open one), which emails the watchers.
Set it up:

```bash
gh variable set PW_MONITOR_URL --body https://pagewright-app.vercel.app
gh secret set PW_MONITOR_KEY            # a service key from PW_API_KEYS
```

Scheduled workflows run only on the default branch, and GitHub pauses them after 60 days without commits. The error
rate is per server process since it started (on Vercel, one instance's view): for a rate over time across instances,
scrape `/api/v1/metrics` into Prometheus or Grafana Cloud (free tier) and alert on
`sum(rate(pagewright_http_requests_total{status="5xx"}[10m])) / sum(rate(pagewright_http_requests_total[10m])) > 0.05`.
On Vercel, Log Drains or the Observability tab also show 5xx counts per route.

Locally: `BASE=https://pagewright-app.vercel.app PW_MONITOR_KEY=… node scripts/uptime-check.mjs`.

## Staging deploy (Vercel preview, its own Neon branch)

Production is `vercel deploy --prod` from the `vercel` branch of the deploy copy (`~/pw-vercel`). Staging is a preview
deploy of the same project with its own database, so a test never writes to production data.

One-time setup:

```bash
# a Neon branch: a copy-on-write copy of production's data at this moment (free plan: 10 branches)
npx neonctl branches create --project-id <project> --name staging
npx neonctl connection-string staging --project-id <project> --pooled   # -> postgres://…
# preview deploys get that database and their own secrets (never production's)
vercel env add DATABASE_URL preview        # paste the staging connection string
vercel env add PW_SESSION_SECRET preview   # a new 40+ character secret
vercel env add PW_DATA_KEY preview         # a new key (two-factor secrets on staging are sealed with it)
vercel env add PW_API_KEYS preview         # staging keys
```

Each deploy:

```bash
cd ~/pw-vercel
git fetch ~/Documents/pw-stress main && git cherry-pick <new commits>
vercel deploy                              # preview: prints https://pagewright-app-<hash>-….vercel.app
BASE=<preview url> node scripts/uptime-check.mjs
# smoke: sign in, open a report, export a PDF; then promote the same build:
vercel promote <preview url>               # or vercel deploy --prod
```

Reset staging to today's production data: `npx neonctl branches reset staging --parent`. Preview URLs sit behind
Vercel's deployment protection (signed in to the team) unless it is turned off for previews.

## Cold starts (Vercel)

A new serverless instance runs `instrumentation.js` before its first answer and logs one line,
`[pagewright] boot: storage …ms, accounts …ms, ready …ms`. What it does: open the storage (one read when the database
is at the latest schema: `src/server/storage/sql.js`), check the two-factor data key and the permission defaults side
by side (two reads, no lock once migrated: `migratePermissions` in `src/server/perms.js`), start the scheduler. It does
not start render threads on Vercel (the first render starts them). The Neon compute itself suspends after 5 minutes
idle on the free plan and takes about a second to wake. Vercel Hobby crons run once a day, so they cannot keep an
instance warm; an external monitor every 5 minutes (above) keeps one instance and the database awake as a side effect.
