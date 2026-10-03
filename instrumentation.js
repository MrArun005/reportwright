// Starts the report scheduler when the Node server boots, and checks the account settings.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.PW_AUTH && process.env.PW_AUTH !== 'users') throw new Error('PW_AUTH must be "users" (or not set at all).');
    if (process.env.PW_AUTH === 'users') {
      const { sessionSecret } = await import('./src/server/session.js');
      sessionSecret(); // throws in production without PW_SESSION_SECRET: Next logs it and answers 500 to everything
      if (process.env.PW_BASIC_AUTH) console.warn('[pagewright] PW_AUTH=users is on, so PW_BASIC_AUTH is ignored: people sign in with their own accounts.');
    }
    const { startScheduler } = await import('./src/server/schedules.js');
    startScheduler();
  }
}
