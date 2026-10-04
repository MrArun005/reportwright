// Starts the report scheduler and the batch worker when the Node server boots, and checks the account settings.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.PW_AUTH && !['users', 'proxy'].includes(process.env.PW_AUTH)) throw new Error('PW_AUTH must be "users" or "proxy" (or not set at all).');
    const { openTrusted, accountsOn, publicReadonly, NO_AUTH_HELP } = await import('./src/server/session.js');
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
  }
}
