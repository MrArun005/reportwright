// Starts the report scheduler when the Node server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./src/server/schedules.js');
    startScheduler();
  }
}
