// Add a user: node scripts/user.mjs add <email> <viewer|designer|admin>
// Run it in the app folder with the same PW_STORAGE as the server (files in ./data by default).
// The password comes from PW_NEW_PASSWORD, or the script asks for it (what you type is not shown).
import { createUser, ROLES } from '../src/server/users.js';

const [cmd, email, role] = process.argv.slice(2);
if (cmd !== 'add' || !email || !ROLES.includes(role)) {
  console.error(`Usage: node scripts/user.mjs add <email> <${ROLES.join('|')}>\nThe password comes from PW_NEW_PASSWORD, or the script asks for it.`);
  process.exit(2);
}

/** Read a line from the terminal without echoing it; from a pipe, just read the first line. */
function askHidden(question) {
  return new Promise((resolve) => {
    const tty = process.stdin.isTTY;
    if (tty) { process.stdout.write(question); process.stdin.setRawMode(true); }
    process.stdin.setEncoding('utf8');
    let text = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (c === '\r' || c === '\n') {
          process.stdin.off('data', onData);
          if (tty) { process.stdin.setRawMode(false); process.stdout.write('\n'); }
          process.stdin.pause();
          return resolve(text);
        }
        text = c === '\u007f' || c === '\b' ? text.slice(0, -1) : text + c;
      }
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

const password = process.env.PW_NEW_PASSWORD || await askHidden(`Password for ${email} (at least 10 characters): `);
try {
  const u = await createUser({ email, role, password });
  console.log(`Added ${u.email} as ${u.role}.`);
  process.exit(0); // a database pool would keep the process alive
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
