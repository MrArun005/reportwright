# Enterprise track (SSRS replacement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: a failing test first, then the code.

**Goal:** the five things an SSRS shop asks for before it switches: a SQL Server connector, permissions per report and folder, an audit log, single sign-on (OIDC, SAML), and a server render time limit.

**Architecture:**
- **SQL Server (item 1)** — a fourth driver in `src/server/sql.js` for `mssql://user:pass@host:port/db` (the `mssql` package, an optionalDependency like `pg`/`mysql2`). `@name` binds as `@pw_1…` request inputs. The guarantees match the others, with SQL Server's own tools: the server parses the query first with `SET SHOWPLAN_XML ON` and the query must be exactly one statement of type `SELECT` (T-SQL needs no `;` between statements, so a lexical check cannot tell); then it runs inside a transaction that is always rolled back, under `SET ROWCOUNT limits.rows + 1`, with a request timeout of `limits.ms`. `[bracketed]` names are skipped by the binder. The storage backend (`PW_STORAGE=mssql://…`) follows if the upsert and lease statements fit (`MERGE`).
- **Permissions (item 2)** — `src/server/perms.js`. Folders (`folders` storage kind: `{ id, name, parent, inherit, grants }`) and a per-report record (`reportacl` kind: `{ id, folder, inherit, grants }`), both kept apart from the report definition, so saving a definition can never change its permissions. A grant is `{ to: 'user:<email>' | 'group:<name>', level: 'view' | 'edit' | 'manage' }`. Built-in groups: `everyone` (every signed-in user) and `public` (also anonymous embed readers when `PW_EMBED_ORIGINS` is set). Users get `groups` (admin-set or from SSO). The effective level of a report is the highest grant on the report, then up the folder chain while `inherit` holds, then the root ACL (`folders` record `root`, default `everyone: edit`, which keeps today's behaviour). The role is a ceiling: viewer → view at most, designer → manage at most; admins → manage on everything. One function, `reportAccess(principal, id)`, is called by every route that reads or lists a report or its data (UI pages, `/api/reports*`, thumbnails, server renders and exports, `/api/data/sql`, `/api/v1/*`, subreport loading through `loadReport`, the templates list). A report a principal cannot view is "not found" (404), never 403, so ids do not leak.
- **API keys** — `PW_API_KEYS` entries stay service keys (full access, as today). A new form `email|key` makes a key act as that user, with that user's permissions; such a key may render inline definitions only when the user is a designer. Batches and schedules record their owner; a scoped key sees only its own; a schedule re-checks its owner's access every run.
- **Audit log (item 3)** — `src/server/audit.js`: `audit(event, { req, user, ... })` appends `{ at, type, actor, ip, report, format, paramsHash, detail }`. Storage: `appendAudit` / `queryAudit` / `pruneAudit` on every backend (files: one JSON-lines file per day under `data/audit/`; SQL: `pw_audit`). Append-only: no update or delete API; retention `PW_AUDIT_RETENTION_DAYS` (default 365) prunes whole days. Parameters are hashed (SHA-256 of the sorted JSON, first 16 hex), never stored; secrets never. Admin page `/admin/audit` with filters and CSV export (`/api/audit?format=csv`).
- **SSO (item 4)** — `src/server/sso/oidc.js`: discovery from `PW_OIDC_ISSUER`, authorization code + PKCE (S256), `state` and `nonce` in a signed short-lived cookie (`pw_sso`, SameSite=Lax), ID token checked with `jose` (`jwtVerify` against a cached remote JWKS: signature, `iss`, `aud`, `exp`, `nonce`, and `azp` with several audiences). Claims map to role and groups (`PW_OIDC_ROLE_MAP=idp-group=admin,…`, `PW_SSO_DEFAULT_ROLE`); users are created on first sign-in (no password). `src/server/sso/saml.js`: `@node-saml/node-saml` with `wantAssertionsSigned`, audience, recipient (ACS URL) and time checks; `InResponseTo` required, kept in storage (`tokens` kind) so any server can finish a sign-in; every assertion id is used once (`store().once`). The ACS POST comes from the IdP's site, so a Lax cookie is not sent: the ACS stores the result under a one-time handle and redirects to `/api/auth/saml/finish`, a top-level GET that does carry the Lax cookie set when the sign-in began; that binds the response to the browser that started it (no login CSRF). `PW_PASSWORD_LOGIN=off` turns password sign-in off when SSO is on.
- **Render time limit (item 5)** — an evaluation budget: `render(def, { timeoutMs })` puts `{ until, n }` on the evaluation context; `evaluate()` checks the clock every 1,024 calls and, once over, every later call throws, so the render unwinds quickly; `render()` then throws `ReportError('The report ran longer than … s')` (status 504). The server passes `PW_RENDER_TIMEOUT_MS` (default 60,000) to every server render (routes, batches, schedules, thumbnails, subreports share the parent's budget).

**Decisions taken without asking (simplest safe option):**
1. Permissions live apart from the definition (above). A report with no record is in the root folder and inherits.
2. Default root ACL `everyone: edit`: an upgrade changes nothing until an admin tightens it. `manage` (delete, move, change grants) is admins' and the creator's: a new report gets `user:<creator>: manage`.
3. Not found, not forbidden, for reports one cannot view. A user who can view but not edit gets 403 on writes.
4. Service API keys keep full access (documented); `email|key` scoped keys are the per-user option.
5. The server's internal pass (relative data URLs in server renders) can never read a report definition: a report could otherwise name `/api/reports/secret` as a data source.
6. Version refs (`id@version`) need `edit`: old versions may hold settings since removed.
7. With accounts off there is no identity: folders still organise reports, grants are not enforced (the shared `PW_BASIC_AUTH` password is all-or-nothing, as today).
8. SAML and OIDC accounts are matched by email; IdP role/group claims overwrite the account's role and groups at every sign-in (the IdP is the source of truth). OIDC requires `email_verified` unless `PW_OIDC_TRUST_EMAIL=1`.
9. Browser-side exports (the viewer makes them itself) are logged through `POST /api/audit/export`, which records only reports the user may view; it is the client's word and is marked `client: true`.

## File map

| File | Change |
|---|---|
| `src/server/sql.js` | mssql driver, dialect, `[ident]` in the binder, timeout code |
| `src/server/storage/{index,file,sql}.js` | kinds `folders`, `reportacl`, `tokens`; `once`; audit append/query/prune; mssql storage |
| `src/server/perms.js` | new: folders, grants, `reportAccess`, `visibleReports`, principals |
| `src/server/audit.js` | new |
| `src/server/sso/oidc.js`, `src/server/sso/saml.js` | new |
| `src/server/access.js`, `auth.js`, `session.js`, `users.js` | principals, scoped keys, groups, SSO users, Origin exemption for the ACS |
| `src/server/renderer.js`, `jobs.js`, `schedules.js` | `loadReport` checked per principal, owners, render timeout |
| `src/engine/index.js`, `src/engine/expr/evaluate.js` | evaluation budget |
| `app/api/reports/**`, `app/api/data/sql`, `app/api/v1/**`, pages | checks |
| `app/api/folders/**`, `app/api/reports/[id]/access`, `app/api/audit/**`, `app/api/auth/{oidc,saml}/**` | new |
| `app/page.js`, `src/home/*`, `app/admin/audit`, `app/admin/users`, `app/login` | folders, sharing dialog, audit page, groups, SSO buttons |
| `src/i18n/*.js` | new strings in all 9 languages |
| `tests/engine/{mssql-unit,perms,audit,sso,render-timeout}.test.js` | new |
| `tests/e2e/{permissions,sso}.mjs` | new |

## Tasks

- [ ] 1. SQL Server: unit tests for binding (`@pw_n`, `[x@y]`), gated integration test (`PW_TEST_MSSQL`) for binding, one statement, read-only, row cap, timeout; driver; storage backend.
- [ ] 2. Permissions: unit tests for the resolver (inheritance, break inheritance, groups, role ceiling, admin, public/anonymous, internal pass); route tests for every deny path on every backend; UI (folders on home, sharing dialog, hidden controls); e2e `permissions.mjs`. Reviewer pass.
- [ ] 3. Audit: tests for append/query/prune per backend, event coverage, no secrets; admin page; CSV. Reviewer pass.
- [ ] 4. SSO: mock OIDC provider (jose keys) and SAML IdP (xml-crypto + test certs) in tests: good path, bad signature, wrong iss/aud, expired, nonce/state mismatch, replay, signature wrapping, unsigned assertion; e2e `sso.mjs`. Reviewer pass. TOTP if time allows.
- [ ] 5. Render time limit: a crafted quadratic report fails fast with 504; normal reports unaffected.
- [ ] Docs: FEATURES, STATUS, API. Full gate.

## Gate (each commit)

`npx vitest run`, `node bin/pw.mjs test reports`, `node scripts/check-pdf-matches-model.mjs`, `node scripts/check-engine-boundary.mjs`, `npm run build`, `npm run test:e2e` (+ users, permissions, sso suites). Ports 3600–3699.
