// @ts-check

/** How deep items may nest (containers and lists inside each other): far beyond any real report, short of the stack. */
export const MAX_NESTING = 256;
const obj = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What a definition must be before anything walks it: sections an object, each band an object whose "items" is a list
 * of objects, items nested at most MAX_NESTING deep. Walked without recursion, so a hostile file cannot overflow the
 * stack. An imported or pasted file that fails this is refused with the first message; validate() reports them all.
 * (Small: it is in the render worker, whose size has a budget.)
 * @param {any} def
 * @returns {string[]} what is wrong, empty when the shape is right
 */
export function shapeErrors(def) {
  if (!obj(def)) return ['The report definition is not an object'];
  const s = def.sections, out = [], bands = [];
  if (s == null) return out;
  if (!obj(s)) return ['"sections" must be an object'];
  const add = (/** @type {string} */ at, /** @type {any} */ b) => (obj(b) ? bands.push([at, b.items]) : out.push(`${at}: a band must be an object with "items"`));
  for (const k of ['pageHeader', 'pageFooter']) if (s[k] != null) add(k, s[k]);
  if (!Array.isArray(s.body)) { if (s.body != null) add('body', s.body); }
  else s.body.forEach((b, i) => {
    const at = `Body section ${i + 1}`; // worded as validate() words them
    if (!obj(b)) return out.push(`${at} is not an object`);
    bands.push([at, b.items]);
    for (const k of ['pageHeader', 'pageFooter']) if (b[k] != null) { if (obj(b[k])) bands.push([`${at} ${k}`, b[k].items]); else out.push(`${at}: "${k}" must be an object`); }
  });
  if (s.content != null) { if (!Array.isArray(s.content)) return ['"sections.content" must be a list']; s.content.forEach((c, i) => add(`content ${i + 1}`, c)); }
  for (const [at, items] of bands) out.push(...itemListErrors(items, at));
  return out.slice(0, 20);
}

/**
 * The same for a list of items (a band's, or a paste's). @param {any} items @param {string} at where they are
 * @returns {string[]}
 */
export function itemListErrors(items, at) {
  const out = [], todo = [[items, at, 0]];
  while (todo.length && out.length < 20) {
    const [list, where, depth] = /** @type {[any, string, number]} */ (todo.pop());
    if (list == null) continue;
    if (!Array.isArray(list)) out.push(`${where}: "items" must be a list`);
    else if (depth > MAX_NESTING) out.push(`${where}: items are nested more than ${MAX_NESTING} deep`);
    // a child list is named by the nearest named item
    else list.forEach((it, i) => (obj(it) ? todo.push([it.items, typeof it.name === 'string' && it.name ? it.name.slice(0, 60) : where, depth + 1]) : out.push(`${where}: item ${i + 1} is not an object`)));
  }
  return out;
}
