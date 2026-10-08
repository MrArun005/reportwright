// Styles for the embed under a strict Content-Security-Policy (style-src 'self', no 'unsafe-inline'): constructable
// stylesheets, which a CSP does not check. A <style> element (with the page's nonce) is only the fallback for browsers
// without them.
const CONSTRUCTABLE = typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;

/** A stylesheet object from css text (no <style> element). @param {string} css */
function sheet(css) {
  const s = new CSSStyleSheet();
  s.replaceSync(css);
  return s;
}

/**
 * The viewer's own styles, on its shadow root (replaces any earlier ones). The shadow root must be empty of the old
 * <style> fallback first, which the caller guarantees by setting innerHTML before this call.
 * @param {ShadowRoot} shadow @param {string} css @param {string} [nonce]
 */
export function setShadowStyles(shadow, css, nonce) {
  if (CONSTRUCTABLE && 'adoptedStyleSheets' in shadow) { shadow.adoptedStyleSheets = [sheet(css)]; return; }
  const st = document.createElement('style');
  if (nonce) st.nonce = nonce;
  st.textContent = css;
  shadow.prepend(st);
}

/**
 * Report and interface @font-face rules, declared on the document once (@font-face is ignored inside a shadow root).
 * @param {string} id @param {string} css @param {string} [nonce]
 */
export function declareDocumentStyles(id, css, nonce) {
  if (CONSTRUCTABLE && 'adoptedStyleSheets' in document) {
    if (document.adoptedStyleSheets.some(s => s.pwId === id)) return;
    const s = sheet(css);
    s.pwId = id;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
    return;
  }
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  if (nonce) st.nonce = nonce;
  st.textContent = css;
  document.head.appendChild(st);
}

/**
 * Markup from pageToSvg with its style attributes renamed to data-pw-style: a strict CSP (style-src without
 * 'unsafe-inline') reports and refuses every style attribute the parser meets, and a data attribute is not checked.
 * applyStyleAttributes() applies them afterwards through CSSOM, which the policy allows. Only tags are touched: the
 * generator escapes text and attribute values.
 * @param {string} html
 */
export function deferStyleAttributes(html) {
  return html.replace(/<[a-zA-Z][^>]*>/g, tag => tag.replace(/ style="([^"]*)"/g, ' data-pw-style="$1"'));
}

/**
 * Applies the styles deferStyleAttributes() set aside, through CSSOM, and removes the data attribute.
 * @param {Element} root
 */
export function applyStyleAttributes(root) {
  for (const el of root.querySelectorAll('[data-pw-style]')) {
    const css = el.getAttribute('data-pw-style') || '';
    /** @type {HTMLElement|SVGElement} */ (el).style.cssText = css;
    el.removeAttribute('data-pw-style');
  }
}
