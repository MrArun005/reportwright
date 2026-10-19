// @ts-check

/** How deep items may nest (containers and lists inside each other): far beyond any real report, short of the stack. */
export const MAX_NESTING = 256;

/**
 * What a definition must be before anything walks it: sections an object, each band an object whose "items" is a list
 * of objects, items nested at most MAX_NESTING deep. Walked without recursion, so a hostile file cannot overflow the
 * stack. An imported or pasted file that fails this is refused with the first message; validate() reports them all.
 * @param {any} def
 * @returns {string[]} what is wrong, empty when the shape is right
 */
export function shapeErrors(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return ['The report definition is not an object'];
  const s = def.sections;
  if (s == null) return [];
  if (typeof s !== 'object' || Array.isArray(s)) return ['"sections" must be an object, such as { "body": { "items": [] } }'];
  /** @type {[string, any][]} */
  const bands = [];
  for (const k of ['pageHeader', 'pageFooter']) if (s[k] != null) bands.push([k, s[k]]);
  const out = [];
  if (Array.isArray(s.body)) {
    s.body.forEach((b, i) => {
      // worded as validate() words them (Body section 2 is not an object)
      if (!b || typeof b !== 'object' || Array.isArray(b)) { out.push(`Body section ${i + 1} is not an object`); return; }
      bands.push([`Body section ${i + 1}`, b]);
      for (const k of ['pageHeader', 'pageFooter']) {
        if (b[k] == null) continue;
        if (typeof b[k] !== 'object' || Array.isArray(b[k])) out.push(`Body section ${i + 1}: "${k}" must be an object`);
        else bands.push([`Body section ${i + 1} ${k}`, b[k]]);
      }
    });
  } else if (s.body != null) bands.push(['body', s.body]);
  if (s.content != null) { if (!Array.isArray(s.content)) return ['"sections.content" must be a list of placeholders']; s.content.forEach((c, i) => bands.push([`content ${i + 1}`, c])); }
  for (const [at, band] of bands) {
    if (!band || typeof band !== 'object' || Array.isArray(band)) out.push(`${at}: a band must be an object with "items"`);
    else out.push(...itemListErrors(band.items, at));
  }
  return out.slice(0, 20);
}

/**
 * The same for a list of items (a band's, or a paste's). @param {any} items @param {string} at where they are
 * @returns {string[]}
 */
export function itemListErrors(items, at) {
  if (items == null) return [];
  const out = [];
  /** @type {[any, string, number][]} */
  const todo = [[items, at, 0]];
  while (todo.length && out.length < 20) {
    const [list, where, depth] = /** @type {[any, string, number]} */ (todo.pop());
    if (!Array.isArray(list)) { out.push(`${where}: "items" must be a list`); continue; }
    if (depth > MAX_NESTING) { out.push(`${where}: items are nested more than ${MAX_NESTING} deep`); continue; }
    list.forEach((it, i) => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) { out.push(`${where}: item ${i + 1} is not an object`); return; }
      if (it.items != null) todo.push([it.items, typeof it.name === 'string' && it.name ? it.name.slice(0, 60) : where, depth + 1]); // named by the nearest named item
    });
  }
  return out;
}
