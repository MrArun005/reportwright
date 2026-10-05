// Starts the report scheduler and the batch worker when the Node server boots, and checks the account settings.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // every request carries its socket address (x-pw-peer), so limits never believe a made-up X-Forwarded-For
    (await import('./src/server/limits.js')).trackPeers();
    if (process.env.PW_AUTH && !['users', 'proxy'].includes(process.env.PW_AUTH)) throw new Error('PW_AUTH must be "users" or "proxy" (or not set at all).');
    const { openTrusted, accountsOn, publicReadonly, basicOn, NO_AUTH_HELP } = await import('./src/server/session.js');
    if (process.env.PW_BASIC_AUTH && !basicOn()) console.warn('[pagewright] PW_BASIC_AUTH must be "user:password" (both parts set): it is ignored, so nobody signs in.');
    // PW_AUTH=proxy in production without a secret would trust anyone who reaches the port around the proxy: refuse to start
    if (process.env.PW_AUTH === 'proxy' && process.env.NODE_ENV === 'production' && (process.env.PW_PROXY_SECRET || '').length < 16) throw new Error('PW_AUTH=proxy needs PW_PROXY_SECRET (16+ random characters) in production, sent by the signing-in reverse proxy as x-pagewright-proxy-secret. Every request is refused until it is set.');
    if (process.env.NODE_ENV === 'production' && !process.env.PW_BASE_URL) console.warn('[pagewright] PW_BASE_URL is not set: reports with relative data URLs (/api/...) fail in server renders. Set it to this server\'s public URL.');
    // production with nobody signing in fails closed (proxy.js): say so loudly at start, not only in each 401
    if (!accountsOn() && !openTrusted()) console.warn(`[pagewright] ${publicReadonly() ? 'PW_PUBLIC_READONLY=1: anyone can open and render the saved reports; nothing can be changed.' : 'Every page and API (but /api/v1 with keys) answers 401.'} ${NO_AUTH_HELP}`);
    if (process.env.PW_AUTH === 'users') {
      const { sessionSecret } = await import('./src/server/session.js');
      sessionSecret(); // throws in production without PW_SESSION_SECRET: Next logs it and answers 500 to everything
      if (process.env.PW_BASIC_AUTH) console.warn('[pagewright] PW_AUTH=users is on, so PW_BASIC_AUTH is ignored: people sign in with their own accounts.');
    }
    const { startScheduler } = await import('./src/server/schedules.js');
    startScheduler();
    // run queued batches here too (also ones another server left when it stopped); PW_WORKER=off for a web-only server
    if (process.env.PW_WORKER !== 'off') (await import('./src/server/jobs.js')).startWorker();
    // start the render workers now (src/server/pool.js), so the first renders do not wait for them to load
    (await import('./src/server/pool.js')).warmPool();
  }
}
