# Server governance and scale

Accounts (`PW_AUTH=users`), single sign-on, the audit log and the automation API are described in [API.md](API.md).
This page covers what batch 5 added: two-factor sign-in, password reset by email, single logout, the audit log's hash
chain and SIEM shipping, scheduled email, the snapshot cache, shared batch output and cluster mode. Every setting below
is an environment variable unless it says "Settings page" (`/admin/settings`, admins).

## Two-factor sign-in (TOTP)

- Users turn it on at **Account** (`/account`): scan the QR code with an authenticator app (RFC 6238: SHA-1, 6 digits,
  30 s), confirm a code, and keep the 10 recovery codes (shown once; each works once).
- Sign-in asks for the code after the password. Between the two the browser holds `pw_mfa` (5 minutes, its own MAC
  purpose, never a session). A code's time step is good once per user on every server; wrong codes count under the
  sign-in limits below (the second factor has its own counts).
- **Settings page → Require two-factor sign-in** per role: password accounts with that role enrol at their next
  sign-in, and their sessions without the factor end. Single sign-on accounts are not asked (the IdP owns the factors).
- Admins **Reset two-factor** on the Users page for a lost phone (`PATCH /api/users/<email> { resetTwoFactor: true }`);
  the user's sessions end. CLI-free recovery: a recovery code, or an admin.
- Secrets are sealed with AES-256-GCM, key from `PW_DATA_KEY` (32+ characters), else `PW_SESSION_SECRET`. Rotating that
  secret makes enrolled authenticators unreadable: reset the users and they enrol again.
- `PW_TOTP_ISSUER` names the account in the app (default Pagewright).

## Sign-in limits

One function checks every secret someone presents: `checkCredential()` in `src/server/limits.js` (passwords, TOTP,
recovery and emailed enrolment codes, the pending two-factor step, reset tokens, API keys, `PW_BASIC_AUTH`, the proxy
secret, download-link signatures). `tests/engine/r1a-credential.test.js` fails when a verifier is called outside it.
The design is OWASP's device cookie:

1. **Per network** (the client address, believed from `PW_TRUSTED_PROXIES` only; IPv6 by /64): 20 failures in
   10 minutes across all accounts, then 429 with Retry-After for that network. A spray is capped.
2. **Per account** (passwords and second factors): 10 failures in 15 minutes from browsers the account does not know,
   then 429 for such browsers. A distributed brute force is capped.
3. **Device cookies.** A complete sign-in (password and any second factor) sets `pw_device`: HMAC-signed, HttpOnly,
   SameSite=Strict, for `/api/auth`, holding the account, a random device id, the account's session version and 90
   days. A new one on every sign-in. Sign-out everywhere, a password change or disabling the account ends it. A try
   carrying a valid one for the account is not under cap 2; it has its own 10 failures per 15 minutes. An attack
   cannot lock out a browser that signed in before.
4. **A new browser on a capped account** gets in by a password reset email (its own limits, per network) or an admin
   unlock (Users page, `PATCH /api/users/<email> { unlockSignIn: true }`), or waits out the 15 minutes.

A right secret does not count. Counts are storage leases (atomic, shared by every server). Residual: secrets without
an account (API keys, the basic-auth password, the proxy secret, link signatures, reset tokens) have the per-network
cap only, so they must be long and random; behind a proxy `PW_TRUSTED_PROXIES` does not name, every client shares one
network count (the log says so once).

## Password reset by email

Needs mail (below) and `PW_BASE_URL` (the link's address; in production never taken from a request). **Forgot your
password?** on the sign-in page asks for an email; the answer is the same whether or not an account exists and comes
before any lookup. The link holds a one-time token (only its SHA-256 is stored), works for 30 minutes, and a newer one
replaces it. Using it sets the password and ends every session; two-factor sign-in still applies. Limits: 3 requests an
hour per email from one network, 20 per email in all and 20 per network; a reset token counts under the sign-in limits
(per network). A reset is the way in for a new browser on an account the limits have capped. Without mail, the sign-in page says to
ask an admin, who sets a new password on the Users page.

## Mail (SMTP)

| Setting | |
|---|---|
| `PW_SMTP_URL` | `smtp://user:pass@host:587` (STARTTLS, required except to localhost; `PW_SMTP_REQUIRE_TLS=0` allows plain) or `smtps://…:465` |
| `PW_MAIL_FROM` | `reports@example.com` or `Pagewright <reports@example.com>` |
| `PW_MAIL_ALLOWED_DOMAINS` | `example.com,example.co.uk`, or `*`. Scheduled mail goes only to these domains (exact, no subdomains); unset: scheduled mail is refused |
| `PW_MAIL_MAX_RECIPIENTS` | per schedule or batch (default 20) |
| `PW_MAIL_MAX_ATTACHMENT_MB` | larger output is sent as a link (default 10) |
| `PW_MAIL_LINK_DAYS` | how long a download link works (default 7, at most 90) |
| `PW_LINK_SECRET` | signs download links (32+ characters; default `PW_SESSION_SECRET`) |

Addresses are checked against a strict pattern (no CR, LF, commas, quotes or angle brackets); subjects lose control
characters; nodemailer may read no file or URL. **SPF, DKIM and DMARC are the mail administrator's job**: publish SPF
for the relay, sign at the relay (Pagewright does not DKIM-sign), and send from a domain whose DMARC policy the relay
satisfies, or the mail lands in spam.

## Scheduled reports by email

On the **Schedules** page (designers and admins: `/schedules`) or with `email` in `/api/v1/batches` and
`/api/v1/schedules`: `{ to: [...], subject?, body?, attach?: true }`. One output file is attached (one item: the file;
several: the zip or merged PDF); larger than the limit, or `attach: false`, the mail carries a signed link
(`/api/v1/batches/<id>/download?exp=&sig=`) that downloads that batch's output, no key needed, until it expires.
Treat a link like the attachment it replaces. The outcome is on the batch (`mail`) and in the audit log
(`mail.sent` / `mail.failed`). A schedule made on the page belongs to the signed-in user and runs as the user is now (a
disabled or demoted user's schedules stop).

## Single logout

- SAML: set `PW_SAML_LOGOUT_URL` (the IdP's SLO endpoint) and `PW_SAML_SP_KEY` (or `_FILE`, PEM) with `PW_SAML_SP_CERT`
  (published in `/api/auth/saml/metadata` with the `SingleLogoutService` address `/api/auth/saml/slo`). Signing out of a
  SAML session ends it here and sends a signed LogoutRequest (HTTP-Redirect, RSA-SHA256); the IdP's LogoutResponse must
  answer this browser's request. IdP-initiated LogoutRequests (HTTP-Redirect or HTTP-POST) must be signed by the IdP
  certificate, from `PW_SAML_IDP_ISSUER`, for our SLO address, recent, and are used once; they end every session of the
  account bound to that NameID. With the SP key set, AuthnRequests are signed too.
- OIDC: signing out of an OIDC session goes to the provider's `end_session_endpoint` with `id_token_hint`, `client_id`
  and `post_logout_redirect_uri=<PW_BASE_URL>/login` (register it at the provider). `PW_OIDC_LOGOUT=off` keeps sign-out
  local.

## Audit log: hash chain (beta) and SIEM shipping

The audit log itself (append-only events, retention `PW_AUDIT_RETENTION_DAYS`, filters, CSV) is unchanged. On top:

- **Hash chain (integrity, beta).** Each server process writes its own stream; each event carries its number, the hash
  of the one before and its own SHA-256. Every `PW_AUDIT_CHECKPOINT_MINUTES` (15) each process writes an Ed25519-signed
  checkpoint naming every stream's head. Retention writes a signed `audit.prune` record before it removes anything.
  **Check it** on the audit page or with `pw audit verify [--from] [--to] [--json] [--public-key file.pem]` (exit 1
  unless the verdict is `ok`). Verdicts: `ok` (proven up to the last signed checkpoint; newer events are counted as
  pending), `unverified` (nothing wrong, nothing proven: no key, no signed checkpoint, an empty window, a stale anchor),
  `tampered` (with where), `error`.
- Signing key: `PW_AUDIT_SIGNING_KEY` (a PEM Ed25519 private key; best, so that only the server can sign), else derived
  from `PW_AUDIT_KEY` or `PW_SESSION_SECRET` (32+ characters); with none, checkpoints are unsigned and nothing verifies.
  Keep the public key (audit page) elsewhere and verify with `--public-key`. After changing the key run
  `pw audit rekey --old-secret … | --old-key old.pem`, which hands the old key over in a record signed by both.
- Security events (sign-ins, accounts, permissions, settings, schedules, mail, exports, deletes) that cannot be written
  make their request fail (503) instead of going on unlogged.
- **SIEM:** `PW_AUDIT_SIEM=syslog+tls://host:6514` (RFC 5424, octet-counted, TLS; `PW_AUDIT_SIEM_CA` to trust a private
  CA) or `https://…` (a JSON array per POST, `X-Pagewright-Signature: sha256=<HMAC of the body with PW_AUDIT_SIEM_SECRET>`).
  Retried with backoff from 1 s to 5 minutes; at least once (a retried batch may repeat). The Settings page shows the
  queue.
- Exports made in the viewer are recorded with `serverView`: the server's own `report.view` record behind them.

Known limits are in [API.md](API.md#known-limits).

## Report snapshot cache

**Settings page → Report snapshot cache:** a TTL in seconds (0, the default, is off) and a size bound in MB. A rendering
is reused only for the same stored definition, parameters, format and options, the same principal with the same access,
and no report saved or deleted since. Pushed data, signed and password-protected PDFs are never cached. The render API
and server links answer `x-pagewright-snapshot: hit|miss|off`; schedules may **Render from snapshot**. Clear it on the
Settings page.

## Shared batch output

Batch items and output (zip, merged PDF) are stored where every server can read them: `data/blobs/` with file storage,
the `pw_blobs` table (1 MB parts) with a database, or S3 / S3-compatible storage with
`PW_BLOBS=s3://bucket[/prefix]?region=…[&endpoint=https://minio:9000]` and `PW_S3_ACCESS_KEY_ID`,
`PW_S3_SECRET_ACCESS_KEY` (optional `PW_S3_SESSION_TOKEN`). Any server resumes another's batch and serves its download.
The `folder` output type still writes to a local folder by design.

## Cluster mode

```
npm run build
node scripts/cluster.mjs -p 3000        # PW_CLUSTER_PROCESSES (default: a quarter of the cores, at least 2)
```

One Next.js request thread per process instead of one in all; render threads per process default to the cores left
after the request threads, shared out (`PW_RENDER_WORKERS` overrides). The processes share the port (the kernel spreads
connections), the storage, queue, scheduler lease, locks, sessions and the audit log. A dead process is replaced. With
file storage the processes must run on one machine; across machines use a database (`PW_STORAGE`). Load results are in
[SERVER-LOAD.md](SERVER-LOAD.md).
