// @ts-check
// Option names: render(), exportPdf() and exportPdfStream() take one bag of options, and a misspelled key used to be
// ignored without a word ({ encrpyt } streamed an unencrypted file). checkOptions says so.

/** every option the three functions (and what they pass on) read */
export const KNOWN_OPTIONS = new Set(`parameters fontStore fonts loadFont fetch baseUrl sources now reportId sql sqlRows loadReport timeoutMs deadline
onSources exportData dataOnly unsafeFetch allowHosts fetchTimeoutMs maxFetchBytes firstPages target state timeZone bodyWidth depth budget chain
bodyOnly reportCache reuseBudget fnCount imageBudget pageWindow stats title author creationDate subset pdfa prepare save encrypt tagged drillBase
onWarning fetchImage window parallel maxRows id presorted signal spill sorter format maxJsonRowBytes maxJsonWholeBytes largeReportRows`.split(/\s+/));
/** a typo of one of these would silently drop security, so it throws */
const SECURITY = new Set(['encrypt', 'prepare']);

/** @param {string} a @param {string} b */
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The warnings for the keys of opts that are not options, each with the nearest option (Levenshtein 2 at most) as
 * "Did you mean". A key close to a security option (encrypt, prepare) throws instead: carrying on would write a file
 * without the password or signature the caller asked for.
 * @param {any} opts @param {Set<string>} [known]
 * @returns {string[]}
 */
export function checkOptions(opts, known = KNOWN_OPTIONS) {
  const out = [];
  if (!opts || typeof opts !== 'object') return out;
  for (const k of Object.keys(opts)) {
    if (known.has(k) || opts[k] === undefined) continue;
    let best = '', d = 3;
    for (const o of known) { const x = lev(k.toLowerCase(), o.toLowerCase()); if (x < d) { d = x; best = o; } }
    const msg = `Unknown option "${k}" was ignored.${best ? ` Did you mean "${best}"?` : ''}`;
    if (SECURITY.has(best)) throw Object.assign(new TypeError(msg), { status: 400 });
    out.push(msg);
  }
  return out;
}
