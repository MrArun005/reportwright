// @ts-check
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
  return { fields: parts.map((p, i) => parseField(p, /** @type {[number, number]} */ (RANGES[i]))), domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

const fmts = new Map();
/** Wall-clock parts of a date in a time zone. */
export function zoned(date, timeZone = 'UTC') {
  let fmt = fmts.get(timeZone);
  if (!fmt) fmts.set(timeZone, fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }));
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { year: Number(p.year), minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

export function matches(cron, date, timeZone) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const z = zoned(date, timeZone);
  const [mi, h] = c.fields;
  return mi.has(z.minute) && h.has(z.hour) && dayMatches(c, z.month, z.day, z.weekday);
}

function dayMatches(c, month, day, weekday) {
  const [, , dom, mon, dow] = c.fields;
  if (!mon.has(month)) return false;
  // standard cron: when both day fields are restricted, either may match
  if (!c.domStar && !c.dowStar) return dom.has(day) || dow.has(weekday);
  return dom.has(day) && dow.has(weekday);
}

/** Offset of a time zone from UTC at an instant, in ms (wall clock minus UTC). */
function offsetAt(t, timeZone) {
  const z = zoned(new Date(t), timeZone);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - Math.floor(t / 60000) * 60000;
}

/**
 * The instant a wall-clock time happens in a time zone. In the hour that repeats when clocks go
 * back, the first one (so a job runs once). In the hour that clocks skip, the same minute just
 * after the jump (so the job still runs that day), like Vixie cron.
 */
function wallToUtc(y, mo, d, h, mi, timeZone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const times = [wall - offsetAt(wall - 864e5, timeZone), wall - offsetAt(wall + 864e5, timeZone)];
  const real = times.filter(t => { const z = zoned(new Date(t), timeZone); return z.day === d && z.hour === h && z.minute === mi; });
  return real.length ? Math.min(...real) : times[0];
}

/** Next run time after `from` (minute resolution). Walks days, not minutes; 8 years covers any 29 February. */
export function nextRun(expr, timeZone = 'UTC', from = new Date()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const [mins, hours] = c.fields.map(f => [...f].sort((a, b) => a - b));
  const after = from.getTime();
  const start = zoned(new Date(after - 864e5), timeZone); // a day early: a skipped-hour run can land after midnight UTC
  for (let i = 0; i < 8 * 366 + 2; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i)); // calendar arithmetic only
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!dayMatches(c, mo, d, day.getUTCDay())) continue;
    for (const h of hours) for (const mi of mins) {
      const t = wallToUtc(y, mo, d, h, mi, timeZone);
      if (t > after) return new Date(t);
    }
  }
  return null;
}
