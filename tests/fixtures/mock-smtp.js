// A tiny SMTP server for tests (no TLS, no auth): every message lands in `messages` as { from, to, data }.
import net from 'node:net';

export async function startSmtp(port = 0) {
  const messages = [];
  const waiters = [];
  const server = net.createServer((sock) => {
    let buf = '', data = null, cur = { from: null, to: [] };
    const say = (s) => sock.write(`${s}\r\n`);
    say('220 mock ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') {
            const msg = { ...cur, data: Buffer.from(data.join('\r\n'), 'latin1').toString('utf8') };
            messages.push(msg); data = null; cur = { from: null, to: [] };
            say('250 queued');
            for (const w of waiters.splice(0)) w(msg);
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { sock.write('250-mock\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n'); }
        else if (cmd === 'HELO') say('250 mock');
        else if (cmd === 'MAIL') { cur.from = /<(.*)>/.exec(line)?.[1]; say('250 ok'); }
        else if (cmd === 'RCPT') { cur.to.push(/<(.*)>/.exec(line)?.[1]); say('250 ok'); }
        else if (cmd === 'DATA') { data = []; say('354 go'); }
        else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, messages,
    next: () => new Promise(r => waiters.push(r)),
    close: () => new Promise(r => server.close(r)),
  };
}
