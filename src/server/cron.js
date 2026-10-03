// Five-field cron: minute hour day-of-month month day-of-week, evaluated in a time zone.
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]; // weekday 7 = Sunday, like 0

function parseField(f, [lo, hi]) {
  const set = new Set();
  for (const part of String(f).split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`Bad cron field "${f}"`);
    let [a, b] = m[1] === '*' ? [lo, hi] : m[1].split('-').map(Number);
    if (b === undefined) b = m[2] ? hi : a;
    const step = Number(m[2] || 1);
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`Cron field "${f}" is out of range ${lo}-${hi}`);
    for (let v = a; v <= b; v += step) set.add(v === 7 && hi === 7 ? 0 : v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has 5 fields: minute hour day month weekday');
  return { fields: parts.map((p, i) => parseField(p, RANGES[i])), domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

/** Wall-clock parts of a date in a time zone. */
export function zoned(date, timeZone = 'UTC') {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

export function matches(cron, date, timeZone) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const z = zoned(date, timeZone);
  const [mi, h, dom, mon, dow] = c.fields;
  if (!mi.has(z.minute) || !h.has(z.hour) || !mon.has(z.month)) return false;
  // standard cron: when both day fields are restricted, either may match
  if (!c.domStar && !c.dowStar) return dom.has(z.day) || dow.has(z.weekday);
  return dom.has(z.day) && dow.has(z.weekday);
}

/** Next run time after `from` (minute resolution), within a year. */
export function nextRun(expr, timeZone = 'UTC', from = new Date()) {
  const c = parseCron(expr);
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 366 * 24 * 60; i++, d.setTime(d.getTime() + 60000)) if (matches(c, d, timeZone)) return new Date(d.getTime());
  return null;
}
