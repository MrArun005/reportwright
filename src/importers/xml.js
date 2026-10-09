// @ts-check
/**
 * A small XML reader for untrusted files (SSRS .rdl). Pure JavaScript, no DOM, so it runs anywhere.
 *
 * Safe by construction:
 *   - no DTDs: <!DOCTYPE and <!ENTITY are refused, so there is no entity expansion (XXE, billion laughs);
 *     only the five XML entities and character references are read;
 *   - caps on size, nesting depth, element count and attributes per element;
 *   - linear time: it scans with indexOf and character tests, no regular expression runs over the input.
 *
 * Elements come back as { name, ns, attrs, children, text }: name is the local name (prefix removed),
 * ns the namespace URI, text the element's own character data (CDATA included).
 */

export class XmlError extends Error {}

/** @typedef {{ name: string, ns: string, attrs: Record<string, string>, children: XmlElement[], text: string, pos?: number }} XmlElement pos: where its start tag begins in the input (a character offset) */

export const XML_LIMITS = { maxChars: 16 * 1024 * 1024, maxDepth: 128, maxElements: 250_000, maxAttributes: 64 };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const isSpace = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const isNameChar = (c) => !(isSpace(c) || c === '>' || c === '/' || c === '=' || c === '<' || c === '"' || c === "'" || c === '');

/** Text with &…; references read. Only the five XML entities and &#…; are known (there is no DTD). */
function decode(s, at) {
  if (!s.includes('&')) return s;
  let out = '', i = 0;
  for (;;) {
    const amp = s.indexOf('&', i);
    if (amp < 0) return out + s.slice(i);
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp);
    if (semi < 0 || semi - amp > 12) throw new XmlError(`A "&" that does not start a reference, near character ${at + amp}`);
    const ref = s.slice(amp + 1, semi);
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const digits = ref.slice(hex ? 2 : 1);
      const n = parseInt(digits, hex ? 16 : 10);
      if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits) || !(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) throw new XmlError(`The character reference &${ref}; is not valid`);
      out += String.fromCodePoint(n);
    } else if (Object.hasOwn(ENTITIES, ref)) out += ENTITIES[ref];
    else throw new XmlError(`The entity &${ref}; is not defined (DTD entities are not read)`);
    i = semi + 1;
  }
}

/**
 * Parse an XML document into its root element.
 * @param {string} src
 * @param {Partial<typeof XML_LIMITS>} [limits]
 * @returns {XmlElement}
 */
export function parseXml(src, limits = {}) {
  const L = { ...XML_LIMITS, ...limits };
  if (typeof src !== 'string') throw new XmlError('The file is not text');
  if (src.length > L.maxChars) throw new XmlError(`The file is too large (more than ${L.maxChars} characters)`);
  const bom = src.charCodeAt(0) === 0xfeff ? 1 : 0; // positions stay offsets in the input as given
  if (bom) src = src.slice(1);
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {Record<string, string>[]} prefix → namespace URI, per open element */
  const nsStack = [Object.assign(Object.create(null), { xml: 'http://www.w3.org/XML/1998/namespace' })];
  /** @type {XmlElement | null} */
  let root = null;
  let count = 0, i = 0;
  const n = src.length;
  const fail = (msg, at = i) => { throw new XmlError(`${msg} (character ${at})`); };
  const addText = (t, at) => {
    if (!t) return;
    const top = stack[stack.length - 1];
    if (top) top.text += t;
    else for (let k = 0; k < t.length; k++) if (!isSpace(t[k])) fail('Text outside the root element', at + k);
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(decode(src.slice(i), i), i); break; }
    if (lt > i) addText(decode(src.slice(i, lt), i), i);
    i = lt;
    const c1 = src[i + 1];
    if (c1 === '?') { // <?xml …?> and processing instructions
      const e = src.indexOf('?>', i + 2);
      if (e < 0) fail('A "<?" without its "?>"');
      i = e + 2; continue;
    }
    if (c1 === '!') {
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        if (e < 0) fail('A comment without its "-->"');
        i = e + 3; continue;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const e = src.indexOf(']]>', i + 9);
        if (e < 0) fail('A CDATA section without its "]]>"');
        if (!stack.length) fail('CDATA outside the root element');
        stack[stack.length - 1].text += src.slice(i + 9, e);
        i = e + 3; continue;
      }
      // <!DOCTYPE, <!ENTITY, <!ELEMENT…: a DTD can define entities, so none is read
      fail('The file has a DOCTYPE or other declaration, which is not allowed (it could define entities)');
    }
    if (c1 === '/') {
      const e = src.indexOf('>', i + 2);
      if (e < 0) fail('A closing tag without its ">"');
      const qname = src.slice(i + 2, e).trim();
      const top = stack.pop();
      nsStack.pop();
      if (!top) fail(`The closing tag </${qname}> has no opening tag`);
      if (qname !== /** @type {any} */ (top).qname) fail(`</${qname}> closes <${/** @type {any} */ (top).qname}>`);
      delete /** @type {any} */ (top).qname;
      i = e + 1; continue;
    }
    // an opening tag
    let j = i + 1;
    while (j < n && isNameChar(src[j])) j++;
    const qname = src.slice(i + 1, j);
    if (!qname) fail('A "<" that does not start a tag');
    if (root && !stack.length) fail('A second root element');
    if (++count > L.maxElements) fail(`The file has more than ${L.maxElements} elements`);
    if (stack.length >= L.maxDepth) fail(`Elements are nested more than ${L.maxDepth} deep`);
    /** @type {Record<string, string>} */
    const raw = Object.create(null); // null prototypes: an attribute called __proto__ is just a name
    let attrs = 0, selfClose = false;
    for (;;) {
      while (j < n && isSpace(src[j])) j++;
      if (j >= n) fail(`The tag <${qname}> is not closed`);
      if (src[j] === '>') { j++; break; }
      if (src[j] === '/') { if (src[j + 1] !== '>') fail(`A "/" inside the tag <${qname}>`, j); selfClose = true; j += 2; break; }
      const a0 = j;
      while (j < n && isNameChar(src[j])) j++;
      const an = src.slice(a0, j);
      if (!an) fail(`An unexpected character in the tag <${qname}>`, j);
      while (j < n && isSpace(src[j])) j++;
      if (src[j] !== '=') fail(`The attribute ${an} has no value`, j);
      j++;
      while (j < n && isSpace(src[j])) j++;
      const qc = src[j];
      if (qc !== '"' && qc !== "'") fail(`The value of ${an} is not quoted`, j);
      const end = src.indexOf(qc, j + 1);
      if (end < 0) fail(`The value of ${an} has no closing quote`, j);
      const v = src.slice(j + 1, end);
      if (v.includes('<')) fail(`A "<" in the value of ${an}`, j);
      if (++attrs > L.maxAttributes) fail(`The tag <${qname}> has more than ${L.maxAttributes} attributes`);
      if (Object.hasOwn(raw, an)) fail(`The attribute ${an} appears twice in <${qname}>`, a0);
      raw[an] = decode(v, j + 1);
      j = end + 1;
    }
    /** @type {Record<string, string>} */
    const scope = Object.create(nsStack[nsStack.length - 1]);
    /** @type {Record<string, string>} */
    const attrsOut = Object.create(null);
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'xmlns') scope[''] = v;
      else if (k.startsWith('xmlns:')) scope[k.slice(6)] = v;
      else { const c = k.indexOf(':'); attrsOut[c < 0 ? k : k.slice(c + 1)] = v; }
    }
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? '' : qname.slice(0, colon);
    const ns = scope[prefix] ?? (prefix ? fail(`The prefix "${prefix}" is not declared`) : '');
    /** @type {any} */
    const el = { name: colon < 0 ? qname : qname.slice(colon + 1), ns, attrs: attrsOut, children: [], text: '', pos: i + bom };
    if (stack.length) stack[stack.length - 1].children.push(el); else root = el;
    if (!selfClose) { el.qname = qname; stack.push(el); nsStack.push(scope); }
    i = j;
  }
  if (stack.length) throw new XmlError(`The file ends inside <${/** @type {any} */ (stack[stack.length - 1]).qname}>: it is cut off or not well formed`);
  if (!root) throw new XmlError('The file has no root element');
  return root;
}
