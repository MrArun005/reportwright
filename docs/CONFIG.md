# Configuration

Every setting Pagewright reads, from `src/server/config.js` (the table there is the source; `tests/engine/r2-config.test.js` keeps this page, the table and the code in step). At boot `checkConfig()` reports unknown `PW_` names (typos), values of the wrong kind and values that weaken security; in production its errors stop the start.

**Mode.** `PW_MODE=dev|prod`. Unset: development only under `next dev` (`NODE_ENV=development`) or tests; any other `NODE_ENV` (unset under a custom server, `staging`, a typo) is production, so an unknown mode never opens the server. Every development-only behaviour (keyless API, open server, base URL from the request, fetch hosts by expression) follows this one switch.

| Setting | Kind | Default | What it does |
|---|---|---|---|
| `PW_MODE` | dev / prod | (from NODE_ENV) | dev or prod. Unset: dev only under next dev or tests; anything else is prod. |
| `PW_AUTH` | users / proxy | (none) | users: accounts and roles; proxy: a signing-in reverse proxy in front. Unset in prod: static files and /api/v1 only. |
| `PW_SESSION_SECRET` | secret | (required with users) | Signs session cookies (32+ characters). |
| `PW_BASIC_AUTH` | text | (off) | "user:password" for the whole app (no accounts). |
| `PW_PROXY_SECRET` | secret | (off) | With PW_AUTH=proxy: the header x-pagewright-proxy-secret the proxy adds (16+ characters in prod). |
| `PW_PUBLIC_READONLY` | flag | 0 | 1: without sign-in, anyone may open and render saved reports. |
| `PW_ALLOW_KEYLESS` | flag | 0 | 1: /api/v1 answers reads without a key in prod. |
| `PW_API_KEYS` | list | (none) | API keys for /api/v1, comma-separated: "key" (a service key) or "user@x/key" (acts as that user). |
| `PW_ADMIN_EMAIL` | text | (none) | The first admin, created at boot when there are no users. |
| `PW_ADMIN_PASSWORD` | secret | (none) | Its password. |
| `PW_PASSWORD_LOGIN` | onoff | on | off: password sign-in off while SSO is set up. |
| `PW_DEV_HOSTS` | list | (localhost) | More host names the dev server answers on (DNS rebinding guard). |
| `PW_TRUSTED_PROXIES` | list | (none) | Proxy IPs or CIDRs whose X-Forwarded-For is believed. |
| `PW_TOTP_ISSUER` | text | Pagewright | The issuer name authenticator apps show. |
| `PW_DATA_KEY` | secret | (required for two-factor in prod) | Seals TOTP secrets at rest (32+ characters). Never falls back to PW_SESSION_SECRET in prod. |
| `PW_DATA_KEY_OLD` | list |  | Previous PW_DATA_KEY values (comma-separated) during a rotation: old seals still open. |
| `PW_REQUEST_LOG` | flag | 1 | 0: no JSON line per request on stdout (HTTP metrics are kept either way). |
| `PW_DEV_ALLOW_PROD` | flag | 0 | 1: allow PW_MODE=dev under a production build on a non-local address without sign-in (never do this). |
| `PW_LINK_SECRET` | secret | (PW_SESSION_SECRET) | Signs emailed download links. |
| `PW_OIDC_ISSUER` | url | (off) | OpenID Connect issuer. |
| `PW_OIDC_CLIENT_ID` | text |  | OIDC client id. |
| `PW_OIDC_CLIENT_SECRET` | secret |  | OIDC client secret. |
| `PW_OIDC_SCOPES` | text | openid email profile | OIDC scopes. |
| `PW_OIDC_GROUPS_CLAIM` | text | groups | The claim with group names. |
| `PW_OIDC_NAME` | text | Single sign-on | The sign-in button. |
| `PW_OIDC_LOGOUT` | onoff | on | Sign out at the IdP too. |
| `PW_OIDC_ALLOW_HTTP` | flag | 0 | 1: an http:// issuer (development only). |
| `PW_SAML_ENTRY_POINT` | url | (off) | SAML IdP sign-in URL. |
| `PW_SAML_IDP_CERT` | text |  | IdP signing certificate (PEM). |
| `PW_SAML_IDP_CERT_FILE` | text |  | The same, from a file. |
| `PW_SAML_IDP_ISSUER` | text |  | The IdP entity id. |
| `PW_SAML_ISSUER` | text | (PW_BASE_URL) | This SP entity id. |
| `PW_SAML_SP_CERT` | text |  | SP certificate. |
| `PW_SAML_SP_KEY` | secret |  | SP private key. |
| `PW_SAML_SP_KEY_FILE` | text |  | The same, from a file. |
| `PW_SAML_EMAIL_ATTR` | text | (NameID) | The email attribute. |
| `PW_SAML_GROUPS_ATTR` | text |  | The groups attribute. |
| `PW_SAML_LOGOUT_URL` | url |  | IdP single logout URL. |
| `PW_SAML_NAME` | text | SAML single sign-on | The sign-in button. |
| `PW_SSO_ROLE_MAP` | text |  | group=role pairs. |
| `PW_SSO_DEFAULT_ROLE` | viewer / designer / admin / none | viewer | Role without a mapped group. |
| `PW_SSO_ALLOWED_DOMAINS` | list | (any) | Email domains SSO may sign in. |
| `PW_BASE_URL` | url | (none) | This server's own URL (links, relative data URLs). Needed in prod. |
| `PW_EMBED_ORIGINS` | list | (none) | Sites that may embed the viewer (set at build time too). |
| `PW_FIXED_FETCH_HOSTS` | flag | 1 in prod, 0 in dev | 1: data source hosts must be written out, not made by expressions. |
| `PW_INTERNAL_HOSTS` | list | (none) | Private hosts server-side fetches may reach (designers only). |
| `PW_PROXY_ALLOW` | list | (none) | Public hosts the browser data proxy may fetch. |
| `PW_FETCH_DEADLINE_MS` | ms | 60000 | A server fetch, start to last byte. |
| `PW_STORAGE` | text | file | file, sqlite:/path, postgres://, mysql://, mssql:// or sql:<name>. |
| `PW_STORAGE_POOL_MAX` | int | 5 | Storage connections per server thread. |
| `PW_BLOBS` | url | (PW_STORAGE) | s3://bucket[/prefix]?region=… for blobs. |
| `PW_S3_ACCESS_KEY_ID` | text |  | S3 key id. |
| `PW_S3_SECRET_ACCESS_KEY` | secret |  | S3 secret. |
| `PW_S3_SESSION_TOKEN` | secret |  | S3 session token. |
| `PW_DB_<NAME>` | url |  | A SQL connection named <name> (PW_DB_MAIN, …): sqlite:, postgres://, mysql://, mssql://, oracle://, … |
| `PW_DB_<NAME>_PROCS` | list |  | Stored procedures that connection may call. |
| `PW_DB_POOL_MAX` | int | 5 | Connections per SQL pool per server thread. |
| `PW_SQL_TIMEOUT_MS` | ms | 30000 | A SQL query. |
| `PW_SQL_MAX_ROWS` | int | 100000 | Rows a query may return. |
| `PW_SQL_MAX_MB` | int | 64 | Megabytes a query may return. |
| `PW_SQLITE_PROCESSES` | int | 2 | SQLite query processes per server thread. |
| `PW_SQLITE_MEMORY_MB` | int | 1024 | Memory one SQLite query process may use. |
| `PW_RENDER_WORKERS` | int | (by cores and memory) | Render threads; 0 renders on the request thread. |
| `PW_RENDER_WORKER_HEAP_MB` | int | (by memory, ≤ 2048) | A render thread's heap limit. |
| `PW_RENDER_WORKER_MAX_RENDERS` | int | 500 | Renders before a thread is replaced. |
| `PW_RENDER_WORKER_RECYCLE_MB` | int | 512 | Heap after which a thread is replaced. |
| `PW_RENDER_TIMEOUT_MS` | ms | 60000 | A server render. |
| `PW_RENDER_QUEUE` | int | 1000 | Renders waiting. |
| `PW_RENDER_QUEUE_PER_PRINCIPAL` | int | (16, or 8 × threads) | Renders waiting per caller. |
| `PW_RENDER_MAX_WAIT_MS` | ms | 30000 | Estimated wait past which an interactive render gets 503. |
| `PW_MEMORY_LIMIT_MB` | int | (cgroup or RAM) | Narrows the memory the pool plans for. |
| `PW_CPUS` | int | (cgroup or cores) | Cores the pool plans for. |
| `PW_SIGN_P12` | text | (off) | A PKCS#12 file that signs PDFs (API renders with sign: true). |
| `PW_SIGN_PASSWORD` | secret |  | Its password. |
| `PW_AI_MODEL` | text | (default) | Model for AI drafting. |
| `PW_WORKER` | onoff | on | off: this server runs no queued batches. |
| `PW_SCHEDULER` | onoff | on | off: this server runs no schedules. |
| `PW_SCHEDULER_TICK_MS` | ms | 30000 | Scheduler tick. |
| `PW_SCHEDULER_LEASE_MS` | ms | (3 ticks) | Scheduler leader lease. |
| `PW_BATCH_CONCURRENCY` | int | 2 | Items of one batch at once. |
| `PW_BATCH_MAX_OUTPUT_MB` | int | 1024 | Largest zip or merged PDF a batch builds; past it, no packed output (use a folder output). |
| `PW_JOB_LEASE_MS` | ms | 60000 | A batch lease. |
| `PW_QUEUE_POLL_MS` | ms | 2000 | Queue poll. |
| `PW_JOB_RETENTION_DAYS` | int | 30 | Finished batches kept (0: forever). |
| `PW_PACK_TIMEOUT_MS` | ms | 600000 | Making a batch zip or merged PDF. |
| `PW_WEBHOOK_SECRET` | secret | (unsigned) | Signs batch webhooks. |
| `PW_SMTP_URL` | url | (off) | smtp:// or smtps:// relay. |
| `PW_SMTP_REQUIRE_TLS` | flag | 1 | 0 allows a plain connection to a non-local relay. |
| `PW_MAIL_FROM` | text |  | Sender address. |
| `PW_MAIL_ALLOWED_DOMAINS` | list |  | Recipient domains. |
| `PW_MAIL_MAX_RECIPIENTS` | int | 20 | Recipients per mail. |
| `PW_MAIL_MAX_ATTACHMENT_MB` | int | 10 | Attachment size before a link. |
| `PW_MAIL_LINK_DAYS` | int | 7 | Download links last (≤ 90). |
| `PW_AUDIT_KEY` | secret | (PW_SESSION_SECRET) | Keys the audit hashes and checkpoint signatures (32+). |
| `PW_AUDIT_SIGNING_KEY` | secret |  | An Ed25519 PEM key for checkpoints. |
| `PW_AUDIT_PUBLIC_KEY` | text |  | The public key that checks them. |
| `PW_AUDIT_RETENTION_DAYS` | int | 365 | Audit events kept. |
| `PW_AUDIT_CHECKPOINTS` | onoff | on | off: no signed checkpoints. |
| `PW_AUDIT_CHECKPOINT_MINUTES` | int | 15 | Checkpoint interval. |
| `PW_AUDIT_SIEM` | url | (off) | Forward audit events to this HTTPS endpoint. |
| `PW_AUDIT_SIEM_SECRET` | secret |  | Signs them. |
| `PW_AUDIT_SIEM_CA` | text |  | Its CA (PEM). |
| `PW_AUDIT_SIEM_ALLOW_HTTP` | flag | 0 | 1: an http:// SIEM. |
| `PW_AUDIT_SIEM_QUEUE` | int | 10000 | Events waiting to be sent. |
| `PW_AUDIT_ANON_PER_SOURCE` | int | 20 | Events without a signed-in actor written in full per address per 10 s; identical ones past it are counted into one entry. |
| `PW_AUDIT_ANON_PER_MINUTE` | int | 600 | The same across all addresses (counted per 10 s, a sixth of it). |
| `PW_CLUSTER_PROCESSES` | int | (cores / 4, ≥ 2) | scripts/cluster.mjs processes (a database for storage when > 1). |
| `PW_CLUSTER` | internal |  | Set by cluster.mjs in its processes. |
| `PW_STANDALONE` | internal |  | Build the Docker standalone server. |
| `PW_CGROUP_DIR` | internal |  | Tests: where cgroup files are read. |
| `PW_NEW_PASSWORD` | internal |  | scripts/user.mjs: the new password. |
| `PW_BENCH` | internal |  | scripts/perf-pdf.mjs: the bench checkout. |
| `PW_SITE_BASE` | internal |  | scripts/build-site.mjs. |
| `PW_SITE_ORIGIN` | internal |  | scripts/build-site.mjs. |
