// @ts-check
// Design-time checks of field references: Fields.amont where the data set has "amount" is flagged as you type, in the
// Inspector and the expression editor, before a render shows #Error. Pure functions (no React).

/** The expression parts of a value with their offsets: all of "=…", or each {…} of a text template. */
export function exprParts(value) {
  const s = String(value ?? '');
  if (s.startsWith('=')) return [{ text: s.slice(1), at: 1 }];
  const out = [];
  const re = /\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) out.push({ text: m[1], at: m.index + 1 });
  return out;
}
/** String literals blanked out (same length), so a field name inside quotes is not a reference. */
const blankStrings = (t) => t.replace(/"(?:[^"]|"")*"?|'(?:[^'\\]|\\.)*'?/g, (q) => q[0] + ' '.repeat(Math.max(0, q.length - 2)) + (q.length > 1 ? q.slice(-1) : ''));
const quoted = (t) => [...t.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const closest = (name, list) => {
  let best = null, bd = Infinity;
  for (const c of list) { const x = distance(name.toLowerCase(), c.toLowerCase()); if (x < bd) { bd = x; best = c; } }
  return bd <= Math.max(1, Math.min(3, Math.floor(name.length / 3))) ? best : null;
};

/** Every field name a data set offers, nested object fields as dotted names (customer.name). */
export function fieldNames(ds) {
  const out = [];
  for (const f of ds?.fields || []) {
    if (!f?.name) continue;
    out.push(f.name);
    for (const c of f.fields || []) out.push(`${f.name}.${c.name}`);
  }
  return out;
}

/**
 * Unknown field references in a value (an expression or a text template).
 * @param {string} value
 * @param {{ name: string, fields?: any[] }[]} dataSets the report's data sets
 * @param {string | null | undefined} dataSet the data set the value reads (its item's or table's)
 * @returns {{ from: number, to: number, name: string, suggest: string | null }[]} offsets into value
 */
export function fieldIssues(value, dataSets, dataSet) {
  const sets = dataSets || [];
  const own = sets.find(d => d.name === dataSet) || sets[0];
  if (!own || !(own.fields || []).length) return []; // fields not detected yet: nothing to check against
  const out = [];
  for (const part of exprParts(value)) {
    // an aggregate or Lookup into another data set ("Sales") reads that set's fields too
    const named = new Set(quoted(part.text));
    const scope = sets.filter(d => d === own || named.has(d.name));
    if (scope.some(d => !(d.fields || []).length)) continue;
    const known = scope.flatMap(fieldNames);
    const lower = new Set(known.map(k => k.toLowerCase()));
    const objects = new Set(scope.flatMap(d => (d.fields || []).filter(f => f.type === 'object' || f.fields?.length).map(f => f.name.toLowerCase())));
    const t = blankStrings(part.text);
    for (const m of t.matchAll(/\bFields\s*\.\s*([A-Za-z_]\w*)((?:\s*\.\s*[A-Za-z_]\w*)*)/g)) {
      const head = m[1];
      const rest = m[2].replace(/\s/g, '').split('.').filter(Boolean).filter(x => x !== 'Value');
      const from = part.at + m.index + m[0].length - m[1].length - m[2].length;
      if (!lower.has(head.toLowerCase())) { out.push({ from, to: from + head.length, name: head, suggest: closest(head, known.filter(k => !k.includes('.'))) }); continue; }
      // a nested object's member: customer.name must be one of its detected fields (when they are known)
      if (rest.length && objects.has(head.toLowerCase())) {
        const dotted = `${head}.${rest.join('.')}`;
        const kids = known.filter(k => k.toLowerCase().startsWith(`${head.toLowerCase()}.`));
        if (kids.length && !kids.some(k => dotted.toLowerCase() === k.toLowerCase() || k.toLowerCase().startsWith(`${dotted.toLowerCase()}.`))) {
          out.push({ from, to: part.at + m.index + m[0].length, name: dotted, suggest: closest(dotted, kids) });
        }
      }
    }
  }
  return out;
}

/**
 * Nested objects in sample rows as object fields with dotted children (up to 3 levels): customer → customer.name,
 * customer.address.city. Fields.customer.name then reads the value (an object field keeps the object).
 * @returns {{ name: string, type: 'object', fields: { name: string, type: string }[] }[]}
 */
export function nestedFields(rows) {
  const type = (v) => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? 'date' : 'string');
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
  const top = new Map();
  const walk = (o, prefix, acc, depth) => {
    for (const [k, v] of Object.entries(o)) {
      const name = prefix ? `${prefix}.${k}` : k;
      if (isObj(v)) { if (depth < 3) walk(v, name, acc, depth + 1); continue; }
      if (Array.isArray(v)) continue; // a list of rows is a nested data set, not a field
      if (!acc.has(name) || acc.get(name) === 'null') acc.set(name, v == null ? 'null' : type(v));
    }
  };
  for (const r of (rows || []).slice(0, 50)) {
    if (!isObj(r)) continue;
    for (const [k, v] of Object.entries(r)) {
      if (!isObj(v)) continue;
      if (!top.has(k)) top.set(k, new Map());
      walk(v, '', top.get(k), 1);
    }
  }
  return [...top].filter(([, m]) => m.size).map(([name, m]) => ({ name, type: 'object', fields: [...m].map(([n, t]) => ({ name: n, type: t === 'null' ? 'string' : t })) }));
}
