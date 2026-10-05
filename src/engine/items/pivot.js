// @ts-check
/**
 * Pivot (tablix) build: row and column group trees, the visible rows and columns (totals, collapsed
 * instances), and every cell's value. Pure: no layout, no styles. The matrix item turns the result
 * into table rows. Design: docs/superpowers/specs/2026-10-04-tablix-design.md.
 */
import { evalValue, toText } from '../expr/evaluate.js';

export const PIVOT_LIMITS = { depth: 8, values: 50, columns: 1000, cells: 250000, tree: 64 };

/** Rows → buckets by an expression's value, in first-seen order. */
export function groupRows(rows, expr, ctx, lc, who) {
  const map = new Map();
  const c = { ...ctx };
  for (const r of rows) {
    c.fields = r;
    let key;
    try { key = evalValue(expr, c); } catch (e) { lc.warn(`${who} group: ${e.message}`); key = '#Error'; }
    const text = key instanceof Date ? String(key.getTime()) : String(key);
    let b = map.get(text);
    if (!b) { b = { key, text, rows: [] }; map.set(text, b); }
    b.rows.push(r);
  }
  return [...map.values()];
}

export function cmpKey(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when the matrix uses the array form (rowGroups / columnGroups / values). */
export const isTablix = (item) => Array.isArray(item.rowGroups) || Array.isArray(item.columnGroups) || Array.isArray(item.values);

/**
 * The array form of a matrix. The old single-group keys map onto one row group, one column group and one value.
 * @returns {{ rowGroups: any[], columnGroups: any[], values: any[], legacy: boolean, overflow: string, pageOrder: string }}
 */
export function normalizeMatrix(item) {
  if (isTablix(item)) {
    return {
      rowGroups: (item.rowGroups || []).filter(g => g && typeof g === 'object'),
      columnGroups: (item.columnGroups || []).filter(g => g && typeof g === 'object'),
      values: (Array.isArray(item.values) && item.values.length ? item.values : [{ value: '=Count(Fields)' }]).filter(v => v && typeof v === 'object'),
      legacy: false,
      overflow: item.overflow === 'shrink' ? 'shrink' : 'paginate',
      pageOrder: item.pageOrder === 'across' ? 'across' : 'down',
    };
  }
  return {
    rowGroups: [{ expr: item.rowGroup || "=''", sort: item.rowSort, total: item.columnTotals !== false ? 'after' : 'none', width: item.rowHeaderWidth || 110 }],
    columnGroups: [{ expr: item.columnGroup || "=''", sort: item.columnSort, total: item.rowTotals !== false ? 'after' : 'none' }],
    values: [{ value: item.value || '=Count(Fields)', format: item.valueFormat || null }],
    legacy: true,
    overflow: item.overflow === 'paginate' ? 'paginate' : 'shrink',
    pageOrder: item.pageOrder === 'across' ? 'across' : 'down',
  };
}

/** Sort the buckets of one group level: by key (sort), or by an expression over each bucket (sortBy). */
function sortBuckets(bs, g, ctx, lc, who) {
  const dir = g.sort === 'desc' ? -1 : 1;
  if (g.sortBy) {
    const keys = new Map(bs.map(b => {
      try { return [b, evalValue(g.sortBy, { ...ctx, fields: b.rows[0], aggRows: b.rows, aggIndex: undefined })]; } catch (e) { lc.warn(`${who}: ${e.message}`); return [b, null]; }
    }));
    bs.sort((a, b) => {
      const x = keys.get(a), y = keys.get(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      return cmpKey(x, y) * dir;
    });
  } else if (g.sort === 'asc' || g.sort === 'desc') bs.sort((a, b) => cmpKey(a.key, b.key) * dir);
  return bs;
}

/**
 * One axis: a tree of group instances. Every node: { key, label, rows, level, parent, children, path, toggle, open, lo, hi }.
 * lo/hi: the range of full-depth leaf ordinals under the node.
 */
function buildTree(groups, rows, ctx, lc, who, axis, state) {
  let warnedRec = false;
  /**
   * A recursive group (parent: the parent's key): the instances under n form a tree. n.children keeps the roots; each node
   * gets rec (its child nodes), depth, a path through its ancestors; rows stay its own rows (Sum shows the node's own rows,
   * as RDL) and recRows holds its rows and its descendants' (Sum(x, "Group", "Recursive")). Linear: each node once, depth capped (deeper nodes and cycles are listed at the top level).
   */
  const recurse = (n, g, l) => {
    const nodes = n.children;
    const byText = new Map(nodes.map(x => [x.text, x]));
    const roots = [];
    for (const x of nodes) {
      let pk;
      try { pk = evalValue(g.parent, { ...ctx, fields: x.rows[0], aggRows: x.rows, aggIndex: undefined }); } catch (e) { lc.warn(`${who}: ${e.message}`); pk = null; }
      const pr = pk == null || pk === '' ? null : byText.get(pk instanceof Date ? String(pk.getTime()) : String(pk));
      if (!pr || pr === x) roots.push(x); else (pr.rec ||= []).push(x);
    }
    const seen = new Set(), late = [];
    let deep = false;
    const visit = (x, d, path) => {
      seen.add(x);
      x.depth = d; x.path = `${path}/${x.text}`;
      let all = x.rows;
      const kids = [];
      for (const c of x.rec || []) {
        if (seen.has(c)) continue;
        if (d + 1 >= PIVOT_LIMITS.tree) { deep = true; late.push(c); continue; }
        kids.push(c);
        all = all.concat(visit(c, d + 1, x.path));
      }
      x.rec = kids;
      x.recRows = all;
      // open: a toggle's state, else the first expandLevels levels (or all unless initiallyCollapsed)
      const coll = g.collapsible || g.expandLevels != null;
      if (coll && kids.length) {
        const key = `${who}|${axis}${l}|${x.path}`;
        const dflt = g.expandLevels != null ? d < Number(g.expandLevels) : !g.initiallyCollapsed;
        x.open = state?.toggles?.[key] ?? dflt;
        x.toggle = { key, open: x.open };
      }
      return all;
    };
    for (const r of roots) visit(r, 0, n.path);
    const top = [...roots];
    // nodes cut off by the depth limit or in a cycle: listed at the top level, once
    const rest = [...late, ...nodes.filter(x => !seen.has(x))];
    if (deep) lc.warn(`${who}: the recursive group is more than ${PIVOT_LIMITS.tree} levels deep; deeper rows are listed at the top level`);
    let cyc = 0;
    for (const x of rest) if (!seen.has(x)) { if (!late.includes(x)) cyc++; visit(x, 0, n.path); top.push(x); }
    if (cyc) lc.warn(`${who}: ${cyc} rows of the recursive group have no root (a cycle); they are listed at the top level`);
    n.children = top;
  };
  const root = { key: null, label: '', rows, level: -1, parent: null, children: null, path: '', open: true, lo: 0, hi: 0 };
  let frontier = [root];
  groups.forEach((g, l) => {
    const next = [];
    for (const n of frontier) {
      const bs = sortBuckets(groupRows(n.rows, g.expr || "=''", ctx, lc, who), g, ctx, lc, who);
      n.children = bs.map((b) => {
        const node = { key: b.key, text: b.text, label: '', rows: b.rows, level: l, parent: n, children: null, path: `${n.path}/${b.text}`, open: true, lo: 0, hi: 0, toggle: null };
        if (g.label) {
          let v;
          try { v = evalValue(g.label, { ...ctx, fields: b.rows[0], aggRows: b.rows, aggIndex: undefined }); } catch (e) { lc.warn(`${who}: ${e.message}`); v = '#Error'; }
          node.label = toText(v, g.format || null, ctx);
        } else node.label = toText(b.key, g.format || null, ctx);
        if (g.collapsible && l < groups.length - 1) {
          const key = `${who}|${axis}${l}|${node.path}`;
          node.open = state?.toggles?.[key] ?? !g.initiallyCollapsed;
          node.toggle = { key, open: node.open };
        }
        return node;
      });
      if (g.parent && axis === 'r') {
        if (l === groups.length - 1) recurse(n, g, l);
        else if (!warnedRec) { warnedRec = true; lc.warn(`${who}: only the innermost row group can be recursive; "parent" on an outer group is left out`); }
      }
      next.push(...n.children);
    }
    frontier = next;
  });
  // leaf ordinals (depth-first) and each node's range
  let ord = 0;
  const number = (n) => {
    if (!n.children) { n.lo = n.hi = ord++; return; }
    n.lo = ord;
    for (const c of n.children) number(c);
    n.hi = Math.max(n.lo, ord - 1);
    if (!n.children.length) ord++; // an empty group still takes a slot so ranges stay well formed
  };
  number(root);
  return root;
}

/** The visible entries of an axis in display order: leaf | collapsed | total (with the node whose rows it shows). */
function visible(root, groups) {
  const out = [];
  if (!groups.length) { out.push({ kind: 'leaf', node: root, level: -1, chain: [] }); return out; }
  const chainOf = (n) => { const c = []; for (let p = n; p && p.level >= 0; p = p.parent) c.unshift(p); return c; };
  const walk = (n, l) => {
    const g = groups[l];
    const total = { kind: 'total', node: n, level: l, chain: chainOf(n) };
    if (g.total === 'before') out.push(total);
    // a recursive node, then its open subtree, depth first (a loop: the tree may be 64 levels deep)
    const leaf = (c) => {
      const st = [c];
      while (st.length) { const x = st.pop(); out.push({ kind: 'leaf', node: x, level: l, chain: chainOf(x) }); if (x.open && x.rec) for (let i = x.rec.length - 1; i >= 0; i--) st.push(x.rec[i]); }
    };
    for (const c of n.children || []) {
      if (l === groups.length - 1) leaf(c);
      else if (!c.open) out.push({ kind: 'collapsed', node: c, level: l, chain: chainOf(c) });
      else walk(c, l + 1);
    }
    if (g.total === 'after') out.push(total);
  };
  walk(root, 0);
  return out;
}

/** For each instance node: the index of its first visible entry and how many entries it covers. */
function spans(entries) {
  const first = new Map(), count = new Map();
  entries.forEach((e, i) => {
    for (const n of e.chain) {
      if (!first.has(n)) first.set(n, i);
      count.set(n, (count.get(n) || 0) + 1);
    }
  });
  return { first, count };
}

/**
 * @param {any} item the matrix
 * @param {any[]} rows its rows, already filtered
 * @param {any} ctx evaluation context of the item
 * @param {any} lc layout context (warn, state)
 * @returns {{ R: number, C: number, V: number, spec: ReturnType<typeof normalizeMatrix>, cols: any[], header: any[][], body: any[] }}
 *   cols: one entry per value column (after the R row-header columns): { kind, level, node, v }
 *   header: header rows, each a list of cells { c, text, rowSpan, colSpan, role, toggle?, action?, bookmark?, ctx? }
 *   body: rows { kind, level, node, cells: [{ c, text?, raw?, rowSpan, colSpan, role, toggle?, ctx?, action?, bookmark? }] }
 */
export function buildPivot(item, rows, ctx, lc) {
  const who = item.name || 'Matrix';
  const spec = normalizeMatrix(item);
  let rg = spec.rowGroups, cg = spec.columnGroups;
  if (rg.length > PIVOT_LIMITS.depth || cg.length > PIVOT_LIMITS.depth) {
    lc.warn(`${who}: more than ${PIVOT_LIMITS.depth} levels of row or column groups; the deeper levels are left out`);
    rg = rg.slice(0, PIVOT_LIMITS.depth); cg = cg.slice(0, PIVOT_LIMITS.depth);
  }
  let vals = spec.values;
  if (vals.length > PIVOT_LIMITS.values) { lc.warn(`${who}: more than ${PIVOT_LIMITS.values} values; the rest are left out`); vals = vals.slice(0, PIVOT_LIMITS.values); }
  const R = rg.length, C = cg.length, V = vals.length;
  const rowRoot = buildTree(rg, rows, ctx, lc, who, 'r', lc.state);
  const colRoot = buildTree(cg, rows, ctx, lc, who, 'c', lc.state);

  // the full-depth column leaf of every data row
  const ord = new Map();
  const mark = (n) => { if (!n.children) { for (const r of n.rows) ord.set(r, n.lo); return; } for (const c of n.children) mark(c); };
  mark(colRoot);

  let rowsV = visible(rowRoot, rg);
  let colsV = visible(colRoot, cg);
  if (lc.colLimit > 0) {
    // shrink-to-fit: the first columns that fit, and every total
    let n = 0;
    colsV = colsV.filter(e => e.kind === 'total' || n++ < lc.colLimit);
  }
  if (colsV.length * V > PIVOT_LIMITS.columns) {
    const keep = Math.max(1, Math.floor(PIVOT_LIMITS.columns / V));
    lc.warn(`${who}: ${colsV.length * V} value columns is more than ${PIVOT_LIMITS.columns}; showing the first ${keep * V}`);
    colsV = colsV.slice(0, keep);
  }
  if (rowsV.length * colsV.length * V > PIVOT_LIMITS.cells) {
    const keep = Math.max(1, Math.floor(PIVOT_LIMITS.cells / (colsV.length * V)));
    lc.warn(`${who}: ${rowsV.length * colsV.length * V} cells is more than ${PIVOT_LIMITS.cells}; showing the first ${keep} rows`);
    rowsV = rowsV.slice(0, keep);
  }
  const rs = spans(rowsV), cs = spans(colsV);

  /* ---- values ---- */
  const scopeName = (g, l, axis) => g.name || `${axis === 'r' ? 'Row' : 'Column'}Group${l + 1}`;
  const evalAgg = (expr, cellRows, scopes) => {
    if (!cellRows.length) return null;
    try { return evalValue(expr, { ...ctx, fields: cellRows[0], aggRows: cellRows, aggIndex: undefined, scopes }); } catch (e) { lc.warn(`${who}: ${e.message}`); return null; }
  };
  const baseScopes = { ...(ctx.scopes || {}), [who]: { rows, index: -1 } };
  const scopesFor = (re, ce) => {
    const s = { ...baseScopes };
    re.chain.forEach((n, l) => { s[scopeName(rg[l], l, 'r')] = { rows: n.rows, index: -1, ...(n.recRows ? { recRows: n.recRows } : {}) }; });
    ce.chain.forEach((n, l) => { s[scopeName(cg[l], l, 'c')] = { rows: n.rows, index: -1 }; });
    // a total (or collapsed) row or column shares the value expression of the group cells: the groups it totals name
    // its own rows there, so Sum(x, "Group", "Recursive") in the value gives the total instead of an error
    for (let l = re.chain.length; l < R; l++) s[scopeName(rg[l], l, 'r')] ??= { rows: re.node.rows, index: -1, recRows: re.node.rows };
    for (let l = ce.chain.length; l < C; l++) s[scopeName(cg[l], l, 'c')] ??= { rows: ce.node.rows, index: -1 };
    return s;
  };
  /**
   * Click actions on matrix cells (as on table cells): a group's `action` / `bookmark` on its header cells, `totalAction`
   * on its total label, a value's `action` / `bookmark` on its cells. Evaluated in the cell's scope: a header's rows are
   * its group instance's (so =Fields.region is that region), a value cell's are its row × column intersection.
   * Only cells that have one carry `action`, `bookmark` and the scope `ctx` (no extra work for a matrix without actions).
   */
  const clickOf = (o, akey = 'action') => {
    const c = {};
    if (o?.[akey]) c.action = o[akey];
    if (akey === 'action' && o?.bookmark) c.bookmark = o.bookmark;
    return c.action || c.bookmark ? c : null;
  };
  const headCtx = (n, chain, groups, axis) => {
    const s = { ...baseScopes };
    chain.forEach((m, k) => { s[scopeName(groups[k], k, axis)] = { rows: m.rows, index: -1, ...(m.recRows ? { recRows: m.recRows } : {}) }; });
    return { ...ctx, fields: n.rows[0] || null, aggRows: n.rows, aggIndex: undefined, scopes: s };
  };
  const withClick = (cell, click, n, chain, groups, axis) => (click ? Object.assign(cell, click, { ctx: headCtx(n, chain, groups, axis) }) : cell);
  const isPct = (v) => v.show === 'percentOfTotal' || v.show === 'percentOfRow' || v.show === 'percentOfColumn';
  const denCache = new Map(); // `${v}|kind|node` → value
  const den = (vi, kind, node, scopes) => {
    let m = denCache.get(node);
    if (!m) { m = new Map(); denCache.set(node, m); }
    const k = `${vi}|${kind}`;
    if (!m.has(k)) m.set(k, evalAgg(vals[vi].value || '=Count(Fields)', node.rows, scopes));
    return m.get(k);
  };

  /* ---- columns ---- */
  const cols = [];
  for (const e of colsV) for (let v = 0; v < V; v++) cols.push({ kind: e.kind, level: e.level, node: e.node, v, entry: e });

  /* ---- header rows ---- */
  const valueRow = V > 1 || C === 0;
  const H = C + (valueRow ? 1 : 0);
  const header = Array.from({ length: H }, () => []);
  if (H && R) {
    const labels = rg.map(g => g.header).filter(h => h != null && h !== '');
    if (labels.length && H > 0) {
      if (H > 1) header[0].push({ c: 0, text: item.corner || '', rowSpan: H - 1, colSpan: R, role: 'corner' });
      rg.forEach((g, l) => header[H - 1].push({ c: l, text: g.header ?? (l === 0 && H === 1 ? item.corner || '' : ''), rowSpan: 1, colSpan: 1, role: 'corner' }));
    } else header[0].push({ c: 0, text: item.corner || '', rowSpan: H, colSpan: R, role: 'corner' });
  }
  colsV.forEach((e, j) => {
    const c0 = R + j * V;
    e.chain.forEach((n, l) => {
      if (cs.first.get(n) !== j) return;
      const last = e.kind === 'collapsed' && l === e.level;
      header[l].push(withClick({ c: c0, text: n.label, rowSpan: last ? C - l : 1, colSpan: cs.count.get(n) * V, role: 'group', level: l, toggle: n.toggle || undefined }, clickOf(cg[l]), n, e.chain.slice(0, l + 1), cg, 'c'));
    });
    if (e.kind === 'total') header[e.level].push(withClick({ c: c0, text: cg[e.level].totalLabel ?? 'Total', rowSpan: C - e.level, colSpan: V, role: 'total', level: e.level }, clickOf(cg[e.level], 'totalAction'), e.node, e.chain, cg, 'c'));
    if (valueRow) vals.forEach((v, vi) => header[H - 1].push({ c: c0 + vi, text: v.label ?? v.name ?? (C === 0 ? 'Value' : ''), rowSpan: 1, colSpan: 1, role: 'value' }));
  });

  /* ---- body rows ---- */
  const body = [];
  const bucketCache = new Map(); // row node → Map(ordinal → rows)
  const cellRows = (rn, cn) => {
    if (cn === colRoot) return rn.rows;
    if (cn.lo === cn.hi && !cn.children) {
      let b = bucketCache.get(rn);
      if (!b) {
        b = new Map();
        for (const r of rn.rows) { const o = ord.get(r); let a = b.get(o); if (!a) { a = []; b.set(o, a); } a.push(r); }
        bucketCache.set(rn, b);
      }
      return b.get(cn.lo) || [];
    }
    if (rn === rowRoot) return cn.rows;
    const out = [];
    for (const r of rn.rows) { const o = ord.get(r); if (o >= cn.lo && o <= cn.hi) out.push(r); }
    return out;
  };
  rowsV.forEach((re, i) => {
    const cells = [];
    re.chain.forEach((n, l) => {
      if (rs.first.get(n) !== i) return;
      const last = re.kind === 'collapsed' && l === re.level;
      cells.push(withClick({ c: l, text: n.label, rowSpan: last ? 1 : rs.count.get(n), colSpan: last ? R - l : 1, role: 'rowHeader', level: l, toggle: n.toggle || undefined, ...(n.depth ? { indent: n.depth * (Number(rg[l].indent) || 12) } : {}) }, clickOf(rg[l]), n, re.chain.slice(0, l + 1), rg, 'r'));
    });
    if (re.kind === 'total') cells.push(withClick({ c: re.level, text: rg[re.level].totalLabel ?? 'Total', rowSpan: 1, colSpan: R - re.level, role: 'total', level: re.level }, clickOf(rg[re.level], 'totalAction'), re.node, re.chain, rg, 'r'));
    const rn = re.node;
    cols.forEach((ce, j) => {
      const v = vals[ce.v];
      const cr = cellRows(rn, ce.node);
      const scopes = scopesFor(re, ce.entry);
      let val = evalAgg(v.value || '=Count(Fields)', cr, scopes);
      if (isPct(v) && val != null) {
        const d = v.show === 'percentOfTotal' ? den(ce.v, 't', rowRoot, scopes) : v.show === 'percentOfRow' ? den(ce.v, 'r', rn, scopes) : den(ce.v, 'c', ce.node, scopes);
        val = typeof val === 'number' && typeof d === 'number' && d !== 0 ? val / d : null;
      }
      cells.push({ c: R + j, raw: val, rowSpan: 1, colSpan: 1, role: 'value', v: ce.v, colTotal: ce.kind === 'total', ctx: { ...ctx, fields: cr[0] || null, aggRows: cr, aggIndex: undefined, scopes }, ...clickOf(v) });
    });
    body.push({ kind: re.kind, level: re.level, node: rn, cells });
  });
  return { R, C, V, spec: { ...spec, rowGroups: rg, columnGroups: cg, values: vals }, cols, header, body, valueRow, empty: !rows.length };
}
