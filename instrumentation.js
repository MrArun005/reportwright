// Starts the report scheduler and the batch worker when the Node server boots, and checks the account settings.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // the storage answers before anything else is set up. A process of scripts/cluster.mjs whose storage cannot open
    // (a locked or missing database) exits, so the primary starts another, instead of answering 500 to every request
    try { await (await import('./src/server/storage/index.js')).store().get('settings', 'server'); }
    catch (e) {
      console.error(`[pagewright] storage could not be opened: ${e?.message || e}`);
      if (process.env.PW_CLUSTER === '1') process.exit(1);
      throw e;
    }
    // every request carries its socket address (x-pw-peer), so limits never believe a made-up X-Forwarded-For
    (await import('./src/server/limits.js')).trackPeers();
    if (process.env.PW_AUTH && !['users', 'proxy'].includes(process.env.PW_AUTH)) throw new Error('PW_AUTH must be "users" or "proxy" (or not set at all).');
    // every setting checked once (src/server/config.js): dangerous values are reported, errors stop a production start
    const { reportConfig, devMode } = await import('./src/server/config.js');
    reportConfig();
    const { openTrusted, accountsOn, publicReadonly, basicOn, NO_AUTH_HELP } = await import('./src/server/session.js');
    if (process.env.PW_BASIC_AUTH && !basicOn()) console.warn('[pagewright] PW_BASIC_AUTH must be "user:password" (both parts set): it is ignored, so nobody signs in.');
    // PW_AUTH=proxy in production without a secret would trust anyone who reaches the port around the proxy: refuse to start
    if (process.env.PW_AUTH === 'proxy' && !devMode() && (process.env.PW_PROXY_SECRET || '').length < 16) throw new Error('PW_AUTH=proxy needs PW_PROXY_SECRET (16+ random characters) in production, sent by the signing-in reverse proxy as x-pagewright-proxy-secret. Every request is refused until it is set.');
    // a short PW_AUDIT_KEY would leave the audit checkpoints unsigned: production refuses to start, development warns
    const { auditKeyProblem } = await import('./src/server/audit.js');
    if (auditKeyProblem()) { if (!devMode()) throw new Error(auditKeyProblem()); console.error(`[pagewright] WARNING: ${auditKeyProblem()} (development: checkpoints are signed with PW_SESSION_SECRET if that is long enough, else unsigned).`); }
    if (!devMode() && !process.env.PW_BASE_URL) console.warn('[pagewright] PW_BASE_URL is not set: reports with relative data URLs (/api/...) fail in server renders. Set it to this server\'s public URL.');
    // production with nobody signing in fails closed (proxy.js): say so loudly at start, not only in each 401
    if (!accountsOn() && !openTrusted()) console.warn(`[pagewright] ${publicReadonly() ? 'PW_PUBLIC_READONLY=1: anyone can open and render the saved reports; nothing can be changed.' : 'Every page and API (but /api/v1 with keys) answers 401.'} ${NO_AUTH_HELP}`);
    if (process.env.PW_AUTH === 'users') {
      const { sessionSecret } = await import('./src/server/session.js');
      sessionSecret(); // throws in production without PW_SESSION_SECRET: Next logs it and answers 500 to everything
      if (process.env.PW_BASIC_AUTH) console.warn('[pagewright] PW_AUTH=users is on, so PW_BASIC_AUTH is ignored: people sign in with their own accounts.');
    }
    // two-factor secrets sealed with a key that is no longer configured: refuse a production start (src/server/totp.js)
    if (process.env.PW_AUTH === 'users') {
      const problem = await (await import('./src/server/totp.js')).checkDataKey();
      if (problem) { if (!devMode()) throw new Error(problem); console.error(`[pagewright] WARNING: ${problem}`); }
    }
    // permissions: the one-time move to the secure defaults, before any request is served (src/server/perms.js)
    if (process.env.PW_AUTH === 'users') await (await import('./src/server/perms.js')).migratePermissions();
    const { startScheduler } = await import('./src/server/schedules.js');
    startScheduler();
    // run queued batches here too (also ones another server left when it stopped); PW_WORKER=off for a web-only server
    if (process.env.PW_WORKER !== 'off') (await import('./src/server/jobs.js')).startWorker();
    // start the render workers now (src/server/pool.js), so the first renders do not wait for them to load
    (await import('./src/server/pool.js')).warmPool();
  }
}
