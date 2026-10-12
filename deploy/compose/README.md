# Self-host ReportWright for free

One small server, one command. You get the report designer, viewer, server-side PDF/Excel/Word exports, users and
roles, schedules and the automation API: what JasperReports Server, SSRS or Crystal Server would do, without licences.

## What you need

- A Linux VPS with **2 GB of memory**, 1–2 CPUs and 20 GB of disk ($5–10 a month at Hetzner, DigitalOcean, Vultr, Linode…).
- Docker with the compose plugin: `curl -fsSL https://get.docker.com | sh`
- For HTTPS: a domain name (or sub-domain, such as `reports.example.com`) whose DNS **A record** points at the server's IP.

## Install (5 commands)

```bash
git clone --depth 1 --branch v1.0.0 https://github.com/MrArun005/reportwright.git   # a release tag; main is the development line
cd reportwright/deploy/compose
cp .env.example .env
nano .env        # fill in the values below
docker compose --profile https up -d     # first start builds the app: about 5 minutes
```

In `.env` set:

| Value | What to put |
|---|---|
| `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` | Your sign-in. The first admin is created from these on first start. |
| `PW_SESSION_SECRET`, `PW_DATA_KEY` | Two different random strings: run `openssl rand -hex 32` twice and paste. |
| `PW_DOMAIN` | `reports.example.com` |
| `PW_BASE_URL` | `https://reports.example.com` |

If anything required is missing, `docker compose` stops and names it.

Open `https://reports.example.com`, sign in with the admin email and password, and add users under **Admin → Users**.
Caddy gets and renews the HTTPS certificate on its own (ports 80 and 443 must be open).

**No domain yet?** Leave `PW_DOMAIN` empty, run `docker compose up -d` (no `--profile https`), and reach it through an
SSH tunnel from your own computer: `ssh -L 3000:localhost:3000 you@server`, then open `http://localhost:3000`.
The app only listens on the server itself; it is never exposed without HTTPS.

## Scheduled emails (optional)

Set `PW_SMTP_URL` (for example `smtps://user:password@smtp.yourmail.com:465`), `PW_MAIL_FROM` and
`PW_MAIL_ALLOWED_DOMAINS` (the domains you may send to), then `docker compose up -d` again.

## Back up and restore

Everything lives in two Docker volumes: `reportwright_reports` (your reports and versions) and `reportwright_data`
(users, schedules, jobs, outputs). Back up both to one file:

```bash
docker run --rm -v reportwright_reports:/r -v reportwright_data:/d -v "$PWD":/b alpine \
  tar czf /b/reportwright-backup-$(date +%F).tgz -C / r d
```

Restore (stops the app, replaces what is there):

```bash
docker compose stop app
docker run --rm -v reportwright_reports:/r -v reportwright_data:/d -v "$PWD":/b alpine \
  sh -c 'rm -rf /r/* /r/.[!.]* /d/* /d/.[!.]* 2>/dev/null; tar xzf /b/reportwright-backup-YYYY-MM-DD.tgz -C /'
docker compose start app
```

Copy the backup file off the server (for example `scp`), or it is not a backup.

## Upgrade

```bash
cd reportwright && git fetch --depth 1 origin tag v1.0.1 && git checkout v1.0.1   # the release you move to
cd deploy/compose && docker compose --profile https up -d --build
```

Back up first. Your volumes are kept; `docker compose down -v` would delete them, so never add `-v` unless you mean it.

## Notes

- Memory is capped for a 2 GB box: the app at 1.5 GB with two render threads. On a bigger server raise
  `PW_RENDER_WORKERS` in `.env` and the `memory` limit in `docker-compose.yml`.
- Every other setting is an environment variable: see [docs/CONFIG.md](../../docs/CONFIG.md). Add it under
  `environment:` in `docker-compose.yml`.
- Logs: `docker compose logs -f app`. Status: `docker compose ps` (healthy = storage and render threads ready).
