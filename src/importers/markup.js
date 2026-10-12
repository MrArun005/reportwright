// @ts-check
/**
 * JasperReports text markup (markup="html" | "styled" | "rtf") → the HTML subset ReportWright's rich text reads
 * (src/engine/text/rich.js): b, i, u, sup, sub, br, li and <span style> for font, size and colour.
 *
 * The markup is untrusted (users upload reports): one forward scan per input, nesting and tag count capped, the
 * emitted HTML capped by length, and every cap reported in `cut`. Tags it does not know are dropped (their text
 * is kept) and listed in `unknown`.
 */

/** Work limits on the markup in and the HTML out. */
export const MARKUP_LIMITS = { maxInput: 100_000, maxOutput: 200_000, maxDepth: 32, maxTags: 20_000 };

const esc = (s) => s.replace(/&(?![a-zA-Z]{1,8};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // braces: the rich text importer (rdlx.js) doubles them
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const FONT = /^[\w .-]{1,60}$/;

/** A Jasper size (points) or an HTML <font size> (1–7) → CSS. */
function sizeCss(v, html) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (html && n <= 7 && Number.isInteger(n)) return `font-size:${[0, 7.5, 10, 12, 13.5, 18, 24, 36][n]}pt`;
  return `font-size:${Math.min(n, 400)}pt`;
}

/** The attributes of a tag's text after its name, read in one bounded pass. @param {string} s */
function attrsOf(s) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /([\w:-]{1,40})\s*=\s*(?:"([^"]{0,500})"|'([^']{0,500})'|([^\s"'>]{1,500}))/g;
  let m, n = 0;
  while ((m = re.exec(s)) && n++ < 32) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

/** The CSS a Jasper tag stands for; null when the tag is not known. */
function css(name, a, html) {
  switch (name) {
    case 'b': return 'font-weight:bold';
    case 'i': return 'font-style:italic';
    case 'u': return 'text-decoration:underline';
    case 'sup': case 'sub': return '';
    case 'font': case 'style': {
      const d = [];
      const face = a.face ?? a.fontname;
      if (face && FONT.test(face)) d.push(`font-family:${face}`);
      if (a.size) { const z = sizeCss(a.size, html && name === 'font'); if (z) d.push(z); }
      const c = a.color ?? a.forecolor;
      if (c && COLOR.test(c)) d.push(`color:${c}`);
      if (a.backcolor && COLOR.test(a.backcolor)) d.push(`background-color:${a.backcolor}`);
      if (a.isbold === 'true') d.push('font-weight:bold');
      if (a.isitalic === 'true') d.push('font-style:italic');
      const dec = [a.isunderline === 'true' && 'underline', a.isstrikethrough === 'true' && 'line-through'].filter(Boolean);
      if (dec.length) d.push(`text-decoration:${dec.join(' ')}`);
      return d.join(';');
    }
    default: return null;
  }
}

/**
 * html / styled markup → rich-text HTML.
 * @param {string} src @param {'html'|'styled'} kind
 * @returns {{ html: string, unknown: string[], cut: string }}
 */
export function jasperMarkup(src, kind) {
  let s = String(src ?? '');
  let cut = '';
  const long = s.length > MARKUP_LIMITS.maxInput;
  if (long) s = s.slice(0, MARKUP_LIMITS.maxInput);
  const html = kind === 'html';
  /** @type {string[]} open tags: the HTML tag emitted for each ('' = nothing emitted) */
  const stack = [];
  /** @type {string[]} the Jasper names, to match closes */
  const names = [];
  const unknown = new Set();
  let out = '', tags = 0, i = 0;
  const emit = (t) => { if (out.length + t.length > MARKUP_LIMITS.maxOutput) { if (!cut) cut = `more than ${MARKUP_LIMITS.maxOutput.toLocaleString('en-US')} characters of output`; return false; } out += t; return true; };
  // styled text keeps its line breaks; HTML collapses them
  const text = (t) => emit(html ? esc(t) : t.split(/\r?\n/).map(esc).join('<br>'));
  while (i < s.length && !cut) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { text(s.slice(i)); break; }
    if (lt > i && !text(s.slice(i, lt))) break;
    // a tag is at most 1,000 characters: the search for its end never runs to the end of the input (no quadratic scan)
    const gt = /[a-zA-Z/]/.test(s[lt + 1] || '') ? s.slice(lt, lt + 1000).indexOf('>') : -1;
    const m = gt < 0 ? null : /^<(\/?)([a-zA-Z][\w-]{0,30})(\s[^]*?)?(\/?)$/.exec(s.slice(lt, lt + gt));
    if (!m) { text('<'); i = lt + 1; continue; }
    i = lt + gt + 1;
    if (++tags > MARKUP_LIMITS.maxTags) { cut = `more than ${MARKUP_LIMITS.maxTags.toLocaleString('en-US')} tags`; break; }
    const name = m[2].toLowerCase(), close = !!m[1], self = !!m[4];
    if (name === 'br') { emit('<br>'); continue; }
    if (name === 'li' && !close) { emit('<br>• '); continue; }
    if (name === 'li' || name === 'ul' || name === 'ol' || name === 'p') { if (close && name === 'p') emit('<br>'); continue; }
    if (close) {
      const k = names.lastIndexOf(name);
      if (k < 0) continue;
      while (stack.length > k) { const t = stack.pop(); names.pop(); if (t) emit(`</${t}>`); }
      continue;
    }
    if (self) continue;
    const c = css(name, attrsOf(m[3] || ''), html);
    if (c === null) { if (unknown.size < 20) unknown.add(name); continue; }
    if (stack.length >= MARKUP_LIMITS.maxDepth) { cut = `tags nested more than ${MARKUP_LIMITS.maxDepth} deep`; break; }
    const tag = name === 'sup' || name === 'sub' ? name : c ? 'span' : '';
    if (tag) emit(tag === 'span' ? `<span style="${c}">` : `<${tag}>`);
    stack.push(tag); names.push(name);
  }
  while (stack.length) { const t = stack.pop(); if (t) out += `</${t}>`; }
  return { html: out, unknown: [...unknown], cut: cut || (long ? `more than ${MARKUP_LIMITS.maxInput.toLocaleString('en-US')} characters` : '') };
}

/**
 * RTF (the subset Jasper's RTF markup uses: \b \i \ul \strike \super \sub \par \line \tab, \'hh and \uN characters)
 * → rich-text HTML. Destination groups (font and colour tables, {\* …}) are skipped. One forward pass.
 * @param {string} src @returns {{ html: string, unknown: string[], cut: string }}
 */
export function rtfMarkup(src) {
  let s = String(src ?? '');
  let cut = '';
  const long = s.length > MARKUP_LIMITS.maxInput;
  if (long) s = s.slice(0, MARKUP_LIMITS.maxInput);
  const SKIPPED = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', '*']);
  const KNOWN = new Set(['rtf', 'ansi', 'ansicpg', 'deff', 'pard', 'plain', 'f', 'fs', 'cf', 'cb', 'lang', 'uc', 'nosupersub', 'deflang', 'viewkind', 'ql', 'qr', 'qc', 'qj', 'li', 'ri', 'fi', 'sa', 'sb', 'sl', 'slmult']);
  const unknown = new Set();
  let st = { b: false, i: false, u: false, s: false, sc: '' };
  /** @type {any[]} */
  const groups = [];
  let skipDepth = 0, depth = 0, out = '', run = '', runSt = '', uc = 1, skipChars = 0;
  const key = (x) => `${x.b}${x.i}${x.u}${x.s}${x.sc}`;
  const flush = () => {
    if (!run) return;
    let h = esc(run).replace(/\n/g, '<br>');
    const d = [st.b && 'font-weight:bold', st.i && 'font-style:italic', (st.u || st.s) && `text-decoration:${[st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ')}`].filter(Boolean).join(';');
    if (d) h = `<span style="${d}">${h}</span>`;
    if (st.sc) h = `<${st.sc}>${h}</${st.sc}>`;
    if (out.length + h.length > MARKUP_LIMITS.maxOutput) { if (!cut) cut = `more than ${MARKUP_LIMITS.maxOutput.toLocaleString('en-US')} characters of output`; run = ''; return; }
    out += h; run = '';
  };
  const ch = (c) => { if (skipDepth) return; if (skipChars > 0) { skipChars--; return; } if (key(st) !== runSt) { flush(); runSt = key(st); } run += c; };
  const setSt = (f) => { flush(); st = { ...st, ...f }; runSt = key(st); };
  let i = 0;
  while (i < s.length && !cut) {
    const c = s[i];
    if (c === '{') {
      if (++depth > MARKUP_LIMITS.maxDepth) { cut = `groups nested more than ${MARKUP_LIMITS.maxDepth} deep`; break; }
      groups.push({ st, skip: skipDepth > 0 });
      if (skipDepth) skipDepth++;
      i++;
      // a destination group: {\fonttbl …} or {\* …}
      const m = /^\\(\*|[a-z]{1,32})/.exec(s.slice(i, i + 34));
      if (!skipDepth && m && SKIPPED.has(m[1])) skipDepth = 1;
      continue;
    }
    if (c === '}') { depth--; const g = groups.pop(); if (g) { flush(); st = g.st; runSt = key(st); } if (skipDepth) skipDepth--; i++; continue; }
    if (c === '\\') {
      const nx = s[i + 1] ?? '';
      if (nx === '\\' || nx === '{' || nx === '}') { ch(nx); i += 2; continue; }
      if (nx === "'") { const h = parseInt(s.slice(i + 2, i + 4), 16); if (Number.isFinite(h)) ch(String.fromCharCode(h)); i += 4; continue; }
      if (nx === '~') { ch(' '); i += 2; continue; }
      const m = /^([a-z]{1,32})(-?\d{1,10})? ?/.exec(s.slice(i + 1, i + 46));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      if (skipDepth) continue;
      const w = m[1], on = m[2] !== '0';
      switch (w) {
        case 'b': setSt({ b: on }); break;
        case 'i': setSt({ i: on }); break;
        case 'ul': setSt({ u: on }); break;
        case 'ulnone': setSt({ u: false }); break;
        case 'strike': setSt({ s: on }); break;
        case 'super': setSt({ sc: 'sup' }); break;
        case 'sub': setSt({ sc: 'sub' }); break;
        case 'nosupersub': setSt({ sc: '' }); break;
        case 'plain': setSt({ b: false, i: false, u: false, s: false, sc: '' }); break;
        case 'par': case 'line': ch('\n'); break;
        case 'tab': ch('\t'); break;
        case 'uc': uc = Math.max(0, Math.min(4, Number(m[2]) || 0)); break;
        case 'u': { let n = Number(m[2]); if (n < 0) n += 65536; if (n > 0 && n < 0xd800) ch(String.fromCharCode(n)); skipChars = uc; break; }
        default: if (!KNOWN.has(w) && unknown.size < 20) unknown.add(`\\${w}`);
      }
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    ch(c); i++;
  }
  flush();
  return { html: out.replace(/^(<br>)+|(<br>)+$/g, ''), unknown: [...unknown], cut: cut || (long ? `more than ${MARKUP_LIMITS.maxInput.toLocaleString('en-US')} characters` : '') };
}
