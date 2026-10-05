// @ts-check
// Every setting the server reads, in one table: its kind, default and meaning (docs/CONFIG.md is made from it and a
// test keeps both in step with the code). checkConfig() validates the environment at boot (instrumentation.js) and
// reports values that weaken security; devMode() is the one switch between development and production behaviour.
//
// devMode(): PW_MODE=dev or PW_MODE=prod when set; otherwise development only when NODE_ENV is "development" (next dev)
// or "test". Any other NODE_ENV (unset under a custom server, "staging", a typo) is production: an unknown mode never
// opens the server.

/** @typedef {'text'|'secret'|'int'|'ms'|'url'|'list'|'flag'|'onoff'|string} Kind enum kinds are "enum:a|b|c" */
/** @type {[string, Kind, string, string][]} name, kind, default, what it does */
export const SETTINGS = [
  // mode and sign-in
  ['PW_MODE', 'enum:dev|prod', '(from NODE_ENV)', 'dev or prod. Unset: dev only under next dev or tests; anything else is prod.'],
  ['PW_AUTH', 'enum:users|proxy', '(none)', 'users: accounts and roles; proxy: a signing-in reverse proxy in front. Unset in prod: static files and /api/v1 only.'],
  ['PW_SESSION_SECRET', 'secret', '(required with users)', 'Signs session cookies (32+ characters).'],
  ['PW_BASIC_AUTH', 'text', '(off)', '"user:password" for the whole app (no accounts).'],
  ['PW_PROXY_SECRET', 'secret', '(off)', 'With PW_AUTH=proxy: the header x-pagewright-proxy-secret the proxy adds (16+ characters in prod).'],
  ['PW_PUBLIC_READONLY', 'flag', '0', '1: without sign-in, anyone may open and render saved reports.'],
  ['PW_ALLOW_KEYLESS', 'flag', '0', '1: /api/v1 answers reads without a key in prod.'],
  ['PW_API_KEYS', 'list', '(none)', 'API keys for /api/v1, comma-separated: "key" (a service key) or "user@x|key" (acts as that user).'],
  ['PW_ADMIN_EMAIL', 'text', '(none)', 'The first admin, created at boot when there are no users.'],
  ['PW_ADMIN_PASSWORD', 'secret', '(none)', 'Its password.'],
  ['PW_PASSWORD_LOGIN', 'onoff', 'on', 'off: password sign-in off while SSO is set up.'],
  ['PW_DEV_HOSTS', 'list', '(localhost)', 'More host names the dev server answers on (DNS rebinding guard).'],
  ['PW_TRUSTED_PROXIES', 'list', '(none)', 'Proxy IPs or CIDRs whose X-Forwarded-For is believed.'],
  ['PW_TOTP_ISSUER', 'text', 'Pagewright', 'The issuer name authenticator apps show.'],
  ['PW_DATA_KEY', 'secret', '(required for two-factor in prod)', 'Seals TOTP secrets at rest (32+ characters). Never falls back to PW_SESSION_SECRET in prod.'],
  ['PW_DATA_KEY_OLD', 'list', '', 'Previous PW_DATA_KEY values (comma-separated) during a rotation: old seals still open.'],
  ['PW_REQUEST_LOG', 'flag', '1', '0: no JSON line per request on stdout (HTTP metrics are kept either way).'],
  ['PW_DEV_ALLOW_PROD', 'flag', '0', '1: allow PW_MODE=dev under a production build on a non-local address without sign-in (never do this).'],
  ['PW_LINK_SECRET', 'secret', '(PW_SESSION_SECRET)', 'Signs emailed download links.'],
  // SSO
  ['PW_OIDC_ISSUER', 'url', '(off)', 'OpenID Connect issuer.'], ['PW_OIDC_CLIENT_ID', 'text', '', 'OIDC client id.'], ['PW_OIDC_CLIENT_SECRET', 'secret', '', 'OIDC client secret.'],
  ['PW_OIDC_SCOPES', 'text', 'openid email profile', 'OIDC scopes.'], ['PW_OIDC_GROUPS_CLAIM', 'text', 'groups', 'The claim with group names.'], ['PW_OIDC_NAME', 'text', 'Single sign-on', 'The sign-in button.'],
  ['PW_OIDC_LOGOUT', 'onoff', 'on', 'Sign out at the IdP too.'], ['PW_OIDC_ALLOW_HTTP', 'flag', '0', '1: an http:// issuer (development only).'],
  ['PW_SAML_ENTRY_POINT', 'url', '(off)', 'SAML IdP sign-in URL.'], ['PW_SAML_IDP_CERT', 'text', '', 'IdP signing certificate (PEM).'], ['PW_SAML_IDP_CERT_FILE', 'text', '', 'The same, from a file.'],
  ['PW_SAML_IDP_ISSUER', 'text', '', 'The IdP entity id.'], ['PW_SAML_ISSUER', 'text', '(PW_BASE_URL)', 'This SP entity id.'], ['PW_SAML_SP_CERT', 'text', '', 'SP certificate.'],
  ['PW_SAML_SP_KEY', 'secret', '', 'SP private key.'], ['PW_SAML_SP_KEY_FILE', 'text', '', 'The same, from a file.'], ['PW_SAML_EMAIL_ATTR', 'text', '(NameID)', 'The email attribute.'],
  ['PW_SAML_GROUPS_ATTR', 'text', '', 'The groups attribute.'], ['PW_SAML_LOGOUT_URL', 'url', '', 'IdP single logout URL.'], ['PW_SAML_NAME', 'text', 'SAML single sign-on', 'The sign-in button.'],
  ['PW_SSO_ROLE_MAP', 'text', '', 'group=role pairs.'], ['PW_SSO_DEFAULT_ROLE', 'enum:viewer|designer|admin|none', 'viewer', 'Role without a mapped group.'], ['PW_SSO_ALLOWED_DOMAINS', 'list', '(any)', 'Email domains SSO may sign in.'],
  // server reach
  ['PW_BASE_URL', 'url', '(none)', "This server's own URL (links, relative data URLs). Needed in prod."],
  ['PW_EMBED_ORIGINS', 'list', '(none)', 'Sites that may embed the viewer (set at build time too).'],
  ['PW_FIXED_FETCH_HOSTS', 'flag', '1 in prod, 0 in dev', '1: data source hosts must be written out, not made by expressions.'],
  ['PW_INTERNAL_HOSTS', 'list', '(none)', 'Private hosts server-side fetches may reach (designers only).'],
  ['PW_PROXY_ALLOW', 'list', '(none)', 'Public hosts the browser data proxy may fetch.'],
  ['PW_FETCH_DEADLINE_MS', 'ms', '60000', 'A server fetch, start to last byte.'],
  // storage
  ['PW_STORAGE', 'text', 'file', 'file, sqlite:/path, postgres://, mysql://, mssql:// or sql:<name>.'],
  ['PW_STORAGE_POOL_MAX', 'int', '5', 'Storage connections per server thread.'],
  ['PW_BLOBS', 'url', '(PW_STORAGE)', 's3://bucket[/prefix]?region=… for blobs.'],
  ['PW_S3_ACCESS_KEY_ID', 'text', '', 'S3 key id.'], ['PW_S3_SECRET_ACCESS_KEY', 'secret', '', 'S3 secret.'], ['PW_S3_SESSION_TOKEN', 'secret', '', 'S3 session token.'],
  // SQL data sources
  ['PW_DB_<NAME>', 'url', '', 'A SQL connection named <name> (PW_DB_MAIN, …): sqlite:, postgres://, mysql://, mssql://, oracle://, …'],
  ['PW_DB_<NAME>_PROCS', 'list', '', 'Stored procedures that connection may call.'],
  ['PW_DB_POOL_MAX', 'int', '5', 'Connections per SQL pool per server thread.'],
  ['PW_SQL_TIMEOUT_MS', 'ms', '30000', 'A SQL query.'], ['PW_SQL_MAX_ROWS', 'int', '100000', 'Rows a query may return.'], ['PW_SQL_MAX_MB', 'int', '64', 'Megabytes a query may return.'],
  ['PW_SQLITE_PROCESSES', 'int', '2', 'SQLite query processes per server thread.'], ['PW_SQLITE_MEMORY_MB', 'int', '1024', 'Memory one SQLite query process may use.'],
  // rendering
  ['PW_RENDER_WORKERS', 'int', '(by cores and memory)', 'Render threads; 0 renders on the request thread.'],
  ['PW_RENDER_WORKER_HEAP_MB', 'int', '(by memory, ≤ 2048)', "A render thread's heap limit."],
  ['PW_RENDER_WORKER_MAX_RENDERS', 'int', '500', 'Renders before a thread is replaced.'], ['PW_RENDER_WORKER_RECYCLE_MB', 'int', '512', 'Heap after which a thread is replaced.'],
  ['PW_RENDER_TIMEOUT_MS', 'ms', '60000', 'A server render.'], ['PW_RENDER_QUEUE', 'int', '1000', 'Renders waiting.'], ['PW_RENDER_QUEUE_PER_PRINCIPAL', 'int', '(16, or 8 × threads)', 'Renders waiting per caller.'],
  ['PW_RENDER_MAX_WAIT_MS', 'ms', '30000', 'Estimated wait past which an interactive render gets 503.'],
  ['PW_MEMORY_LIMIT_MB', 'int', '(cgroup or RAM)', 'Narrows the memory the pool plans for.'], ['PW_CPUS', 'int', '(cgroup or cores)', 'Cores the pool plans for.'],
  ['PW_SIGN_P12', 'text', '(off)', 'A PKCS#12 file that signs PDFs (API renders with sign: true).'], ['PW_SIGN_PASSWORD', 'secret', '', 'Its password.'],
  ['PW_AI_MODEL', 'text', '(default)', 'Model for AI drafting.'],
  // batches, schedules, mail
  ['PW_WORKER', 'onoff', 'on', 'off: this server runs no queued batches.'], ['PW_SCHEDULER', 'onoff', 'on', 'off: this server runs no schedules.'],
  ['PW_SCHEDULER_TICK_MS', 'ms', '30000', 'Scheduler tick.'], ['PW_SCHEDULER_LEASE_MS', 'ms', '(3 ticks)', 'Scheduler leader lease.'],
  ['PW_BATCH_CONCURRENCY', 'int', '2', 'Items of one batch at once.'], ['PW_BATCH_MAX_OUTPUT_MB', 'int', '1024', 'Largest zip or merged PDF a batch builds; past it, no packed output (use a folder output).'], ['PW_JOB_LEASE_MS', 'ms', '60000', 'A batch lease.'], ['PW_QUEUE_POLL_MS', 'ms', '2000', 'Queue poll.'],
  ['PW_JOB_RETENTION_DAYS', 'int', '30', 'Finished batches kept (0: forever).'], ['PW_PACK_TIMEOUT_MS', 'ms', '600000', 'Making a batch zip or merged PDF.'],
  ['PW_WEBHOOK_SECRET', 'secret', '(unsigned)', 'Signs batch webhooks.'],
  ['PW_SMTP_URL', 'url', '(off)', 'smtp:// or smtps:// relay.'], ['PW_SMTP_REQUIRE_TLS', 'flag', '1', '0 allows a plain connection to a non-local relay.'], ['PW_MAIL_FROM', 'text', '', 'Sender address.'],
  ['PW_MAIL_ALLOWED_DOMAINS', 'list', '', 'Recipient domains.'], ['PW_MAIL_MAX_RECIPIENTS', 'int', '20', 'Recipients per mail.'], ['PW_MAIL_MAX_ATTACHMENT_MB', 'int', '10', 'Attachment size before a link.'],
  ['PW_MAIL_LINK_DAYS', 'int', '7', 'Download links last (≤ 90).'],
  // audit
  ['PW_AUDIT_KEY', 'secret', '(PW_SESSION_SECRET)', 'Keys the audit hashes and checkpoint signatures (32+).'], ['PW_AUDIT_SIGNING_KEY', 'secret', '', 'An Ed25519 PEM key for checkpoints.'],
  ['PW_AUDIT_PUBLIC_KEY', 'text', '', 'The public key that checks them.'], ['PW_AUDIT_RETENTION_DAYS', 'int', '365', 'Audit events kept.'],
  ['PW_AUDIT_CHECKPOINTS', 'onoff', 'on', 'off: no signed checkpoints.'], ['PW_AUDIT_CHECKPOINT_MINUTES', 'int', '15', 'Checkpoint interval.'],
  ['PW_AUDIT_SIEM', 'url', '(off)', 'Forward audit events to this HTTPS endpoint.'], ['PW_AUDIT_SIEM_SECRET', 'secret', '', 'Signs them.'], ['PW_AUDIT_SIEM_CA', 'text', '', 'Its CA (PEM).'],
  ['PW_AUDIT_SIEM_ALLOW_HTTP', 'flag', '0', '1: an http:// SIEM.'], ['PW_AUDIT_SIEM_QUEUE', 'int', '10000', 'Events waiting to be sent.'],
  ['PW_AUDIT_ANON_PER_SOURCE', 'int', '20', 'Events without a signed-in actor written in full per address per 10 s; identical ones past it are counted into one entry.'],
  ['PW_AUDIT_ANON_PER_MINUTE', 'int', '600', 'The same across all addresses (counted per 10 s, a sixth of it).'],
  // cluster and build
  ['PW_CLUSTER_PROCESSES', 'int', '(cores / 4, ≥ 2)', 'scripts/cluster.mjs processes (a database for storage when > 1).'],
  ['PW_CLUSTER', 'internal', '', 'Set by cluster.mjs in its processes.'], ['PW_STANDALONE', 'internal', '', 'Build the Docker standalone server.'],
  ['PW_CGROUP_DIR', 'internal', '', 'Tests: where cgroup files are read.'], ['PW_NEW_PASSWORD', 'internal', '', 'scripts/user.mjs: the new password.'],
  ['PW_BENCH', 'internal', '', 'scripts/perf-pdf.mjs: the bench checkout.'], ['PW_SITE_BASE', 'internal', '', 'scripts/build-site.mjs.'], ['PW_SITE_ORIGIN', 'internal', '', 'scripts/build-site.mjs.'],
];

const NAMES = new Set(SETTINGS.map(s => s[0]));

/**
 * The one parser for numeric settings (int and ms kinds): unset or empty gives def; a value that is not a number or is
 * below min also gives def (checkConfig warns about it at boot). Every module reads its numbers through this.
 * @param {string} name @param {number} def @param {{ min?: number }} [o] @returns {number}
 */
export function num(name, def, { min = 0 } = {}) {
  const v = process.env[name];
  if (v == null || v.trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
}
/** A 0/1 flag or on/off setting: true for 1/on, false for 0/off, def when unset or anything else. @param {string} name @param {boolean} def */
export function bool(name, def) {
  const v = (process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'on' ? true : v === '0' || v === 'off' ? false : def;
}
/** A comma-separated list setting, trimmed, empty parts dropped. @param {string} name @returns {string[]} */
export const list = (name) => (process.env[name] || '').split(',').map(x => x.trim()).filter(Boolean);
const FAMILY = /^PW_DB_[A-Z0-9_]+$/; // PW_DB_<NAME>, PW_DB_<NAME>_PROCS

/** Development behaviour (see the top of this file). */
export function devMode() {
  const m = process.env.PW_MODE;
  if (m === 'dev') return true;
  if (m === 'prod') return false;
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * The environment checked: { errors, warnings } (strings). Errors stop a production start (instrumentation.js);
 * warnings are values that weaken security, unknown PW_ names (a typo silently does nothing) and values of the wrong
 * kind (they fall back to the default).
 * @param {Record<string, string|undefined>} [env]
 */
export function checkConfig(env = process.env) {
  const errors = [], warnings = [], fatal = new Set();
  const prod = env === process.env ? !devMode() : !(env.PW_MODE === 'dev' || (!env.PW_MODE && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')));
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('PW_') || v === undefined) continue;
    if (!NAMES.has(k) && !FAMILY.test(k)) { warnings.push(`${k} is not a Pagewright setting (a typo?); it does nothing.`); continue; }
    const kind = SETTINGS.find(s => s[0] === k)?.[1] || 'url';
    if (kind.startsWith('enum:') && v !== '' && !kind.slice(5).split('|').includes(v)) (k === 'PW_MODE' || k === 'PW_AUTH' ? errors : warnings).push(`${k}="${v.slice(0, 40)}" is not one of ${kind.slice(5).replaceAll('|', ', ')}.`);
    if ((kind === 'int' || kind === 'ms') && v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) warnings.push(`${k}="${v.slice(0, 40)}" is not a number; the default is used.`);
    if (kind === 'flag' && v !== '' && v !== '0' && v !== '1') warnings.push(`${k}="${v.slice(0, 40)}": use 0 or 1.`);
    if (kind === 'onoff' && v !== '' && v !== 'on' && v !== 'off') warnings.push(`${k}="${v.slice(0, 40)}": use on or off.`);
  }
  const short = (k, n) => env[k] && env[k].length < n;
  // PW_MODE=dev under a production build (next start, the image) opens the server to whoever reaches it: refused on a
  // non-local address without any sign-in, loud everywhere else (REVIEW-SECURITY-2 L3)
  if (env.PW_MODE === 'dev' && env.NODE_ENV === 'production') {
    const host = String(env.HOSTNAME || env.HOST || '0.0.0.0');
    const local = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/.test(host);
    const msg = `PW_MODE=dev on a production build: development behaviour (an open server, keyless API, fetch hosts by expression) on ${host}.`;
    if (!local && !env.PW_AUTH && !env.PW_BASIC_AUTH && env.PW_DEV_ALLOW_PROD !== '1') { errors.push(`${msg} Set PW_MODE=prod, bind to localhost (HOSTNAME=127.0.0.1), or set up sign-in.`); fatal.add(errors[errors.length - 1]); }
    else warnings.push(`${msg} Use PW_MODE=prod for anything but a local test.`);
  }
  if (prod) {
    if (!env.PW_AUTH && !env.PW_BASIC_AUTH && env.PW_PUBLIC_READONLY !== '1') warnings.push('No sign-in is set up (PW_AUTH, PW_BASIC_AUTH): only static files and /api/v1 answer.');
    if (env.PW_PUBLIC_READONLY === '1') warnings.push('PW_PUBLIC_READONLY=1: anyone who reaches the server may open and render the saved reports.');
    if (env.PW_ALLOW_KEYLESS === '1') warnings.push('PW_ALLOW_KEYLESS=1: /api/v1 answers without a key.');
    if (env.PW_FIXED_FETCH_HOSTS === '0') warnings.push('PW_FIXED_FETCH_HOSTS=0: report parameters and expressions may choose the hosts the server fetches.');
    if (!env.PW_BASE_URL) warnings.push('PW_BASE_URL is not set: relative data URLs and links in mail cannot be made.');
    if (env.PW_SMTP_REQUIRE_TLS === '0') warnings.push('PW_SMTP_REQUIRE_TLS=0: mail may go to the relay in clear text.');
    if (env.PW_OIDC_ALLOW_HTTP === '1' || env.PW_AUDIT_SIEM_ALLOW_HTTP === '1') warnings.push('An http:// identity provider or SIEM is allowed (PW_OIDC_ALLOW_HTTP / PW_AUDIT_SIEM_ALLOW_HTTP).');
    if (/(^|,)\s*(0\.0\.0\.0\/0|::\/0)\s*(,|$)/.test(env.PW_TRUSTED_PROXIES || '')) warnings.push('PW_TRUSTED_PROXIES trusts every address: any client can choose the address the limits and the audit log see.');
    if (env.PW_AUTH === 'users' && short('PW_SESSION_SECRET', 32)) errors.push('PW_SESSION_SECRET is shorter than 32 characters.');
    if (short('PW_AUDIT_KEY', 32)) errors.push('PW_AUDIT_KEY is shorter than 32 characters.');
    if (env.PW_AUTH === 'proxy' && short('PW_PROXY_SECRET', 16)) errors.push('PW_PROXY_SECRET is shorter than 16 characters.');
    if (env.PW_AUTH === 'users' && !env.PW_DATA_KEY) warnings.push('PW_DATA_KEY is not set: two-factor enrolment is refused until it is (it seals the authenticator secrets; never the session secret in production).');
    if (!env.PW_WEBHOOK_SECRET) warnings.push('PW_WEBHOOK_SECRET is not set: batch webhooks are sent unsigned.');
  }
  if (short('PW_LINK_SECRET', 32)) warnings.push('PW_LINK_SECRET is shorter than 32 characters and is not used.');
  if (short('PW_DATA_KEY', 32)) errors.push('PW_DATA_KEY is shorter than 32 characters: two-factor secrets cannot be sealed or read.');
  return { errors, warnings, fatal: [...fatal] };
}

/** At boot: log the report; in production, errors stop the start. */
export function reportConfig() {
  const { errors, warnings, fatal } = checkConfig();
  for (const w of warnings) console.warn(`[pagewright] config: ${w}`);
  for (const e of errors) console.error(`[pagewright] config: ${e}`);
  // errors stop a production start; a fatal one (an open dev-mode server on a public address) stops any start
  if ((errors.length && !devMode()) || fatal.length) throw new Error(`Pagewright will not start: ${(devMode() ? fatal : errors).join(' ')}`);
  return { errors, warnings };
}

/** The Excel formulas option from a query string or a JSON body: on unless 0, false or off. @param {any} v */
export const formulasOn = (v) => !(v === false || v === 0 || /^(0|false|off|no)$/i.test(String(v ?? '').trim()));
