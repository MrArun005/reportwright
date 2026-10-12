# Self-hosting ReportWright

Run ReportWright on your own server: the designer, viewer, exports, users, schedules and the API, in one small container. Use it when your data cannot leave your network, or when you do not want per-seat licences.

## In the UI

After the install (below):

1. Open `https://reports.example.com` (your domain) in a browser.
2. Sign in with `PW_ADMIN_EMAIL` and `PW_ADMIN_PASSWORD`.
3. Open **Users** and add people.

## From the CLI

Not available in the `pw` CLI. Install with Docker Compose:

```bash
git clone --depth 1 https://github.com/MrArun005/reportwright.git
cd reportwright/deploy/compose
cp .env.example .env
nano .env                                  # fill in the values below
docker compose --profile https up -d       # first start builds the app: about 5 minutes
```

In `.env`:

| Value | What to put |
|---|---|
| `PW_ADMIN_EMAIL`, `PW_ADMIN_PASSWORD` | Your sign-in. The first admin is created from these. |
| `PW_SESSION_SECRET`, `PW_DATA_KEY` | Two different random strings: `openssl rand -hex 32`, twice. |
| `PW_DOMAIN` | `reports.example.com` |
| `PW_BASE_URL` | `https://reports.example.com` |

Logs and status:

```bash
docker compose logs -f app
docker compose ps
```

Back up both volumes (`reportwright_reports` and `reportwright_data`) with a `tar` into a file, and copy the file off the server. Upgrade with `git pull`, then `docker compose --profile https up -d --build`. Never add `-v` to `docker compose down` unless you mean to delete the data.

## Through the API

Not available in the API.

## Notes

- Hardware: a Linux VPS with 2 GB of memory and 1–2 CPUs (`deploy/compose/README.md`).
- Caddy gets and renews the HTTPS certificate. Ports 80 and 443 must be open.
- No domain yet: leave `PW_DOMAIN` empty, run `docker compose up -d` (no profile), and open the app through an SSH tunnel: `ssh -L 3000:localhost:3000 you@server`.
- Scheduled email: set `PW_SMTP_URL`, `PW_MAIL_FROM` and `PW_MAIL_ALLOWED_DOMAINS`, then run `docker compose up -d` again.
- Every other setting is an environment variable. Add it under `environment:` in `docker-compose.yml`. See [docs/CONFIG.md](../CONFIG.md).
- In production the server refuses to answer without a sign-in setup. See the table in `README.md` (Run it).
- Plain Docker: `docker build -t reportwright .` then `docker run -p 3000:3000 -e PW_BASIC_AUTH=admin:change-me -v pw-data:/app/data -v pw-reports:/app/reports reportwright`.
