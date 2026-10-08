// @ts-check
/**
 * The HTML subset of rich text, read by a small forward scanner (no DOM, no innerHTML, no regex over the
 * markup). Report definitions are untrusted: every loop moves forward through the input, nesting is capped,
 * and only the tags, attributes and CSS properties listed here have any effect.
 *
 * Output: blocks (a paragraph, heading, list item or loose text) of runs (text in one inline style).
 * A run's text has its white space collapsed as HTML does; "\n" is a <br>.
 */

/** Work limits: the markup (after interpolation), nesting, runs, blocks, line breaks, attributes per tag, CSS declarations per style. */
import { safeUrl } from '../url.js';

export const RICH_LIMITS = { maxLength: 100000, maxDepth: 32, maxRuns: 20000, maxBlocks: 5000, maxBreaks: 5000, maxAttrs: 64, maxDecls: 100 };

/** @typedef {{ fontFamily?: string, fontSize?: number, fontWeight?: string, fontStyle?: string, color?: string,
 *   background?: string, underline?: boolean, strike?: boolean, script?: 'sup'|'sub', href?: string, align?: string }} RichStyle */
/** @typedef {{ text: string, st: RichStyle }} RichRun */
/** @typedef {{ tag: string, align?: string, level: number, marker?: string, spaceAfter?: boolean, runs: RichRun[] }} RichBlock */

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol']);
const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sup', 'sub', 'a']);
const SKIP = new Set(['script', 'style']);
/** Heading sizes in em and their weight: the browser defaults. */
const HEADING = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
  orange: '#ffa500', yellow: '#ffff00', purple: '#800080', navy: '#000080', maroon: '#800000', teal: '#008080', silver: '#c0c0c0' };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', times: '\u00d7', divide: '\u00f7', deg: '\u00b0', plusmn: '\u00b1', sect: '\u00a7', para: '\u00b6' };

/** A link target rich text may use: the same allow-list as url actions (src/engine/url.js). */
export const safeHref = safeUrl;

/** Only #hex, rgb()/rgba() and a few names; anything else is ignored. */
function color(v) {
  const s = v.trim().toLowerCase();
  if (s.length > 60) return undefined;
  if (NAMED[s]) return NAMED[s];
  if (/^#[0-9a-f]{3,8}$/.test(s) || /^rgba?\([0-9.,\s%]+\)$/.test(s)) return s;
  return undefined;
}

/** Decode character references in a bounded scan. */
function decode(s) {
  if (!s.includes('&')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '&') { out += c; continue; }
    // look for the ';' only in the next 10 characters: a scan to the end for every '&' would be quadratic
    let end = -1;
    for (let k = i + 1; k < s.length && k <= i + 10; k++) if (s[k] === ';') { end = k; break; }
    if (end < 0) { out += c; continue; }
    const name = s.slice(i + 1, end);
    let rep;
    if (name[0] === '#') {
      const n = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) rep = String.fromCodePoint(n);
    } else rep = ENT[name.toLowerCase()];
    if (rep === undefined) { out += c; continue; }
    out += rep;
    i = end;
  }
  return out;
}

/** Sizes stay between 1 and 400pt, however the CSS or nested headings compound. */
const clampSize = (n) => Math.round(Math.min(400, Math.max(1, n)) * 100) / 100;

/** Font size from CSS: pt, px, em, %. @param {string} v @param {number} parent */
function fontSize(v, parent) {
  const s = v.trim().toLowerCase();
  let k = s.length;
  while (k > 0 && !(s[k - 1] >= '0' && s[k - 1] <= '9') && s[k - 1] !== '.') k--;
  const n = Number(s.slice(0, k)), unit = s.slice(k).trim();
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (unit === '' || unit === 'pt') return n;
  if (unit === 'px') return n * 0.75;
  if (unit === 'em' || unit === 'rem') return n * parent;
  if (unit === '%') return (n / 100) * parent;
  return undefined;
}

/** CSS declarations, split at ';' that are not the end of a character reference (&#59; is data). At most maxDecls. */
function cssDecls(css) {
  const out = [];
  let start = 0, amp = -1;
  for (let i = 0; i < css.length && out.length < RICH_LIMITS.maxDecls; i++) {
    const c = css[i];
    if (c === '&') amp = i;
    else if (c === ';') {
      if (amp >= 0 && i - amp <= 10) { amp = -1; continue; }
      out.push(css.slice(start, i)); start = i + 1; amp = -1;
    }
  }
  if (out.length < RICH_LIMITS.maxDecls && start < css.length) out.push(css.slice(start));
  return out;
}

/** Inline CSS onto a copy of the parent style. @param {string} css @param {RichStyle} st */
function applyCss(css, st) {
  for (const raw of cssDecls(css)) {
    const decl = decode(raw); // after splitting: an escaped ';' or quote from data stays inside its value
    const c = decl.indexOf(':');
    if (c < 0) continue;
    const prop = decl.slice(0, c).trim().toLowerCase(), val = decl.slice(c + 1).trim();
    if (!val) continue;
    const low = val.toLowerCase();
    switch (prop) {
      case 'color': { const x = color(val); if (x) st.color = x; break; }
      case 'background-color': case 'background': { const x = color(val); if (x) st.background = x; break; }
      case 'font-size': { const x = fontSize(val, st.fontSize || 9); if (x) st.fontSize = clampSize(x); break; }
      case 'font-weight': if (low === 'bold' || low === 'bolder') st.fontWeight = 'bold'; else if (low === 'normal' || low === 'lighter') st.fontWeight = 'normal'; else if (/^[1-9]00$/.test(low)) st.fontWeight = low; break;
      case 'font-style': if (low === 'italic' || low === 'oblique') st.fontStyle = 'italic'; else if (low === 'normal') st.fontStyle = 'normal'; break;
      case 'font-family': { const f = val.split(',')[0].trim().replace(/^['"]|['"]$/g, ''); if (f && f.length < 60) st.fontFamily = f; break; }
      case 'text-decoration': case 'text-decoration-line':
        if (low.includes('none')) { st.underline = false; st.strike = false; }
        if (low.includes('underline')) st.underline = true;
        if (low.includes('line-through')) st.strike = true;
        break;
      case 'text-align': if (['left', 'center', 'right', 'justify'].includes(low)) st.align = low === 'justify' ? 'left' : low; break;
    }
  }
  return st;
}

/**
 * Read one tag starting at `<` (index i). Returns null when the markup ends inside the tag.
 * @returns {{ end: number, name: string, close: boolean, self: boolean, attrs: Record<string, string> } | null}
 */
function readTag(s, i) {
  let j = i + 1;
  const close = s[j] === '/';
  if (close) j++;
  let name = '';
  while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) name += s[j++];
  /** @type {Record<string, string>} */
  const attrs = {};
  let self = false, count = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '>') return { end: j + 1, name: name.toLowerCase(), close, self, attrs };
    if (c === '/' ) { self = true; j++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { j++; continue; }
    self = false;
    let an = '';
    while (j < s.length && !' \t\n\r\f/>='.includes(s[j])) an += s[j++];
    while (j < s.length && ' \t\n\r\f'.includes(s[j])) j++;
    let av = '';
    if (s[j] === '=') {
      j++;
      while (j < s.length && ' \t\n\r\f'.includes(s[j])) j++;
      const q = s[j];
      if (q === '"' || q === "'") {
        const e = s.indexOf(q, j + 1);
        if (e < 0) return null;
        av = s.slice(j + 1, e); j = e + 1;
      } else while (j < s.length && !' \t\n\r\f>'.includes(s[j])) av += s[j++];
    }
    if (an && an.length < 40 && ++count <= RICH_LIMITS.maxAttrs) attrs[an.toLowerCase()] = av;
    if (!an && j < s.length && s[j] !== '>') j++; // a stray character: move on
  }
  return null;
}

/**
 * @param {string} html
 * @param {{ baseSize?: number, warn?: (msg: string) => void }} [opt]
 * @returns {{ blocks: RichBlock[] }}
 */
export function parseRich(html, opt = {}) {
  const warn = opt.warn || (() => {});
  let s = String(html ?? '');
  if (s.length > RICH_LIMITS.maxLength) {
    s = s.slice(0, RICH_LIMITS.maxLength);
    const lt = s.lastIndexOf('<');
    if (lt >= 0 && s.indexOf('>', lt) < 0) s = s.slice(0, lt); // do not leave half a tag as text
    warn(`the markup is longer than ${RICH_LIMITS.maxLength} characters and was cut.`);
  }
  const low = s.toLowerCase();
  /** @type {RichBlock[]} */
  const blocks = [];
  /** @type {{ name: string, st: RichStyle }[]} */
  const stack = [{ name: '', st: { fontSize: opt.baseSize || 9 } }];
  /** @type {{ ordered: boolean, n: number }[]} */
  const lists = [];
  const unknown = new Set();
  let ignored = 0, deepWarned = false, nRuns = 0, nBreaks = 0, full = false;
  const cutAt = (what) => { if (!full) { full = true; warn(`more than ${what}; the rest is cut.`); } };
  /** @type {RichBlock|null} */
  let cur = null;
  let marker = /** @type {string|undefined} */ (undefined);
  let lastSpace = true;
  const top = () => stack[stack.length - 1];
  const blockTag = () => { for (let k = stack.length - 1; k > 0; k--) if (BLOCK.has(stack[k].name) && stack[k].name !== 'ul' && stack[k].name !== 'ol') return stack[k].name; return ''; };
  const flush = () => {
    if (cur) {
      const runs = cur.runs;
      while (runs.length && runs[runs.length - 1].text.endsWith(' ')) {
        const r = runs[runs.length - 1];
        r.text = r.text.slice(0, -1);
        if (!r.text) runs.pop();
      }
      if (runs.length) {
        if (blocks.length >= RICH_LIMITS.maxBlocks) cutAt(`${RICH_LIMITS.maxBlocks} paragraphs`);
        else blocks.push(cur);
      }
    }
    cur = null; lastSpace = true;
  };
  const add = (text, st, force = false) => {
    if (!cur) {
      if (!force && !text.trim()) return;
      cur = { tag: blockTag(), level: lists.length, runs: [] };
      if (top().st.align) cur.align = top().st.align;
      if (marker) { cur.marker = marker; marker = undefined; }
    }
    const last = cur.runs[cur.runs.length - 1];
    if (last && last.st === st) last.text += text;
    else if (++nRuns > RICH_LIMITS.maxRuns) cutAt(`${RICH_LIMITS.maxRuns} styled pieces`);
    else cur.runs.push({ text, st });
  };
  const text = (raw) => {
    let t = '';
    for (const ch of raw) {
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f') { if (!lastSpace) { t += ' '; lastSpace = true; } continue; }
      t += ch; lastSpace = false;
    }
    if (t) add(decode(t), top().st);
  };

  let i = 0;
  while (i < s.length && !full) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { text(s.slice(i)); break; }
    if (lt > i) text(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); if (e < 0) break; i = e + 3; continue; }
    const nx = s[i + 1] || '';
    if (!/[a-zA-Z\/!?]/.test(nx)) { text('<'); i++; continue; }
    if (nx === '!' || nx === '?') { const e = s.indexOf('>', i); if (e < 0) break; i = e + 1; continue; } // doctype, processing instruction
    const tag = readTag(s, i);
    if (!tag) break; // the markup ends inside a tag: nothing after it can be read
    i = tag.end;
    const name = tag.name;
    if (!name) continue;
    if (!tag.close && SKIP.has(name)) {
      const e = low.indexOf(`</${name}`, i);
      if (e < 0) break;
      const g = s.indexOf('>', e);
      if (g < 0) break;
      i = g + 1; continue;
    }
    if (name === 'br') {
      if (tag.close) continue;
      if (++nBreaks > RICH_LIMITS.maxBreaks) { cutAt(`${RICH_LIMITS.maxBreaks} line breaks`); continue; }
      add('\n', top().st, true);
      lastSpace = true;
      continue;
    }
    if (!BLOCK.has(name) && !INLINE.has(name)) { if (unknown.size < 20) unknown.add(name.slice(0, 20)); continue; }
    if (tag.close) {
      if (ignored > 0) { ignored--; continue; }
      let k = stack.length - 1;
      while (k > 0 && stack[k].name !== name) k--;
      if (k === 0) continue; // nothing open by that name
      if (BLOCK.has(name)) {
        const b = cur;
        flush();
        const last = b && blocks[blocks.length - 1] === b ? b : blocks[blocks.length - 1];
        if (last && (name === 'p' || name in HEADING || ((name === 'ul' || name === 'ol') && lists.length === 1))) last.spaceAfter = true;
      }
      for (let n = stack.length - 1; n >= k; n--) if (stack[n].name === 'ul' || stack[n].name === 'ol') lists.pop();
      stack.length = k;
      continue;
    }
    if (tag.self && name !== 'li') continue; // <b/> opens and closes nothing
    if (stack.length > RICH_LIMITS.maxDepth) {
      ignored++;
      if (!deepWarned) { deepWarned = true; warn(`tags nest more than ${RICH_LIMITS.maxDepth} deep; the deeper ones are ignored (their text is kept).`); }
      continue;
    }
    const st = { ...top().st };
    switch (name) {
      case 'b': case 'strong': st.fontWeight = 'bold'; break;
      case 'i': case 'em': st.fontStyle = 'italic'; break;
      case 'u': st.underline = true; break;
      case 's': case 'strike': case 'del': st.strike = true; break;
      case 'sup': st.script = 'sup'; break;
      case 'sub': st.script = 'sub'; break;
      case 'a': {
        const h = decode(tag.attrs.href ?? ''); // checked as emitted: no trimming after the check
        const ok = safeHref(h);
        if (ok) st.href = ok;
        else if (h) warn(`the link "${h.slice(0, 40)}" is not allowed (only http, https, mailto and / links); its text is kept.`);
        break;
      }
      default:
        if (name in HEADING) { st.fontSize = clampSize((st.fontSize || 9) * HEADING[name]); st.fontWeight = 'bold'; }
    }
    if (tag.attrs.style) applyCss(tag.attrs.style, st);
    if (BLOCK.has(name)) {
      flush();
      if (name === 'ul' || name === 'ol') lists.push({ ordered: name === 'ol', n: 0 });
      if (name === 'li') {
        const l = lists[lists.length - 1];
        marker = l ? (l.ordered ? `${++l.n}.` : '•') : '•';
      }
    }
    stack.push({ name, st });
  }
  flush();
  if (unknown.size) warn(`these tags are not supported and were left out (their text is kept): ${[...unknown].slice(0, 10).join(', ')}.`);
  return { blocks };
}
