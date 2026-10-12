// @ts-check
/**
 * Shape decoders for maps: SQL Server geography (binary), WKT text and ESRI shapefiles (.shp + .dbf) → GeoJSON.
 * Used by the SSRS importer (embedded shapes, shapefiles next to the report) and by the map item at render time
 * (a spatial field from a query).
 *
 * The bytes are untrusted. Every decoder is one forward pass, checks each count against the bytes that are left
 * before it allocates, and counts the coordinates it EMITS against `maxPoints` (a figure or part can only be emitted
 * once, so a small file cannot fan out into a large output). Past a cap a decoder returns OVER (or stops and says
 * so); the caller notes it.
 */

/** Returned when a shape would pass the coordinate cap. */
export const OVER = Object.freeze({ over: true });

/** base64, "0x…" hex, a Buffer-like or bytes → Uint8Array; null when it is none of these. @param {any} v */
export function bytesOf(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return Uint8Array.from(v.data.slice(0, 64e6));
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-f]*$/i.test(s) && s.length % 2 === 0) {
    const out = new Uint8Array((s.length - 2) / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 + i * 2, 2), 16);
    return out;
  }
  let bin;
  try { bin = atob(s.replace(/\s+/g, '')); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * SQL Server's geography serialization (MS-SSCLRT, versions 1 and 2) → a GeoJSON geometry with `n` (the points
 * it holds); OVER past `maxPoints` emitted; null when it is not that.
 * @param {any} input base64 (as the map gallery embeds it in VectorData), hex or bytes @param {number} maxPoints
 */
export function sqlGeography(input, maxPoints) {
  const u8 = bytesOf(input);
  if (!u8 || u8.length < 6) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const len = u8.length;
  let o = 4; // SRID
  const ver = dv.getUint8(o++), flags = dv.getUint8(o++);
  if (ver !== 1 && ver !== 2) return null;
  const pts = [];
  const need = (n) => { if (o + n > len) throw new RangeError('short'); };
  try {
    const point = () => { need(16); const lat = dv.getFloat64(o, true), lon = dv.getFloat64(o + 8, true); o += 16; return [lon, lat]; };
    if (flags & 8) return { type: 'Point', coordinates: point(), n: 1 };
    if (flags & 16) return { type: 'LineString', coordinates: [point(), point()], n: 2 };
    need(4); const np = dv.getUint32(o, true); o += 4;
    if (np * 16 > len) return null; // the count cannot exceed what the bytes hold
    if (np > maxPoints) return OVER;
    for (let i = 0; i < np; i++) pts.push(point());
    if (flags & 1) o += 8 * np; // Z
    if (flags & 2) o += 8 * np; // M
    need(4); const nf = dv.getUint32(o, true); o += 4;
    if (nf > np) return null;
    const figs = [];
    for (let i = 0; i < nf; i++) { need(5); figs.push(dv.getInt32(o + 1, true)); o += 5; }
    need(4); const ns = dv.getUint32(o, true); o += 4;
    if (ns > nf + 1e5 || ns * 9 > len) return null;
    const shapes = [];
    for (let i = 0; i < ns; i++) { need(9); shapes.push({ fig: dv.getInt32(o + 4, true), type: dv.getUint8(o + 8) }); o += 9; }
    const ring = (f) => pts.slice(figs[f], f + 1 < figs.length ? figs[f + 1] : pts.length);
    // the figures of shape k run to the next shape's first figure: found in one backward pass (linear)
    const nextFig = new Array(ns);
    for (let k = ns - 1, nx = figs.length; k >= 0; k--) { nextFig[k] = nx; if (shapes[k].fig >= 0) nx = shapes[k].fig; }
    // shapes may name the same figures more than once: what is cut out (emitted) is counted against the cap, not np,
    // and each figure is used by one shape only, so the output can never be larger than the points the file holds
    let emitted = 0;
    const used = new Uint8Array(figs.length);
    const figsOf = (k) => {
      const s0 = shapes[k].fig; if (s0 < 0 || s0 > figs.length) return [];
      const out = [];
      for (let j = s0; j < Math.min(nextFig[k], figs.length); j++) {
        if (used[j]) throw new RangeError('figure reused');
        used[j] = 1;
        const r = ring(j);
        emitted += r.length;
        if (emitted > maxPoints) throw OVER;
        out.push(r);
      }
      return out;
    };
    const polys = [], lines = [];
    for (let k = 0; k < ns; k++) { const sh = shapes[k]; if (sh.type === 3) polys.push(figsOf(k)); else if (sh.type === 2) for (const r of figsOf(k)) lines.push(r); }
    if (polys.length) return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0], n: np } : { type: 'MultiPolygon', coordinates: polys, n: np };
    if (lines.length) return lines.length === 1 ? { type: 'LineString', coordinates: lines[0], n: np } : { type: 'MultiLineString', coordinates: lines, n: np };
    return null;
  } catch (err) { return err === OVER ? OVER : null; }
}

/** WKT text longer than this is not read (4 MB, the importer's shape-data cap). */
export const MAX_WKT = 4e6;
/**
 * Well-known text (POINT, LINESTRING, POLYGON, MULTILINESTRING, MULTIPOLYGON; an optional "SRID=n;" and Z/M values
 * are allowed and dropped) → a GeoJSON geometry with `n`; OVER past `maxPoints`; null when it is not WKT of these.
 * One forward pass, nesting at most 3 deep. As SQL Server's STAsText() writes it: longitude first.
 * @param {string} text @param {number} maxPoints
 */
export function wkt(text, maxPoints) {
  const s = String(text ?? '');
  if (s.length > MAX_WKT) return null;
  const m = /^\s*(?:SRID=\d{1,9};\s*)?(MULTIPOLYGON|MULTILINESTRING|POLYGON|LINESTRING|POINT)\s*(?:ZM|Z|M)?\s*(?=\()/i.exec(s);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const depthOf = { POINT: 1, LINESTRING: 1, POLYGON: 2, MULTILINESTRING: 2, MULTIPOLYGON: 3 }[kind];
  let i = m[0].length, n = 0;
  /** @type {any[]} */
  const root = [];
  const stack = [root];
  /** @type {number[]} */
  let nums = [];
  const endPoint = () => {
    if (!nums.length) return true;
    if (nums.length < 2 || nums.length > 4 || !nums.every(Number.isFinite)) return false;
    if (++n > maxPoints) throw OVER;
    stack[stack.length - 1].push([nums[0], nums[1]]);
    nums = [];
    return true;
  };
  try {
    while (i < s.length) {
      const c = s[i];
      if (c === '(') { if (stack.length > depthOf) return null; const a = []; stack[stack.length - 1].push(a); stack.push(a); i++; continue; }
      if (c === ')') { if (!endPoint() || stack.length < 2) return null; stack.pop(); i++; if (stack.length === 1) break; continue; }
      if (c === ',') { if (!endPoint()) return null; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      const t = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d{1,3})?/.exec(s.slice(i, i + 40));
      if (!t) return null;
      nums.push(Number(t[0])); i += t[0].length;
      if (nums.length > 4) return null;
    }
  } catch (e) { if (e === OVER) return OVER; throw e; }
  if (stack.length !== 1 || /\S/.test(s.slice(i))) return null;
  // every leaf array holds points of the declared depth
  const body = root[0];
  const ok = (a, d) => Array.isArray(a) && a.length > 0 && (d === 0 ? typeof a[0] === 'number' : a.every(x => ok(x, d - 1)));
  if (kind === 'POINT') return body?.length === 1 ? { type: 'Point', coordinates: body[0], n } : null;
  if (!ok(body, depthOf)) return null;
  return { type: { LINESTRING: 'LineString', POLYGON: 'Polygon', MULTILINESTRING: 'MultiLineString', MULTIPOLYGON: 'MultiPolygon' }[kind], coordinates: body, n };
}

/**
 * A spatial value from a data row (render time) → a GeoJSON geometry; OVER past `maxPoints`; null when unreadable.
 * Accepts GeoJSON (an object or its text), WKT (STAsText()), and SQL Server's geography binary (bytes, a Buffer
 * as JSON, "0x…" hex or base64).
 * @param {any} v @param {number} maxPoints
 */
export function spatialValue(v, maxPoints) {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof ArrayBuffer) && v.type !== 'Buffer') return v; // GeoJSON already
  if (typeof v === 'string') {
    const s = v.trimStart();
    if (s.startsWith('{')) { if (s.length > MAX_WKT) return null; try { return JSON.parse(s); } catch { return null; } }
    if (/^(SRID=|MULTI|POLYGON|LINESTRING|POINT)/i.test(s)) { const g = wkt(s, maxPoints); return g === OVER || !g ? g : strip(g); }
    if (s.length > MAX_WKT * 2) return null;
  }
  const g = sqlGeography(v, maxPoints);
  return g === OVER || !g ? g : strip(g);
}
const strip = (g) => { const { n, ...rest } = g; return rest; };

/* ---------------------------------------------------------------- shapefiles */

/** Caps on a shapefile pair, on top of the caller's running totals. */
export const SHAPEFILE_LIMITS = { maxBytes: 16 * 1024 * 1024, maxFields: 128, maxPropChars: 2e6 };

/**
 * An ESRI shapefile (.shp, and its .dbf for the attributes) → GeoJSON features. Polygons (rings: clockwise outer,
 * counter-clockwise holes) and polylines, with or without Z/M. Point and multipoint records are counted in
 * `points` and left out (a map places points from a data set). The header is checked (file code 9994, version
 * 1000, big-endian lengths); each record's length is checked against the bytes left, its parts against its points,
 * and its parts must rise, so no point is emitted twice. The emitted coordinates and shapes are capped by
 * maxPoints / maxShapes, the attribute text by SHAPEFILE_LIMITS.maxPropChars.
 * @param {Uint8Array} shp @param {Uint8Array | null | undefined} dbf
 * @param {{ maxShapes: number, maxPoints: number }} caps
 * @returns {{ features: any[], n: number, over: boolean, points: number, bad: number, notLonLat: boolean, error?: string }}
 */
export function readShapefile(shp, dbf, caps) {
  const res = { features: /** @type {any[]} */ ([]), n: 0, over: false, points: 0, bad: 0, notLonLat: false };
  if (!(shp instanceof Uint8Array) || shp.length < 100) return { ...res, error: 'the .shp file is too short' };
  if (shp.length > SHAPEFILE_LIMITS.maxBytes) return { ...res, error: `the .shp file is larger than ${SHAPEFILE_LIMITS.maxBytes / 1048576} MB` };
  const dv = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (dv.getInt32(0, false) !== 9994 || dv.getInt32(28, true) !== 1000) return { ...res, error: 'the .shp file is not a shapefile (no 9994 file code / version 1000)' };
  const end = Math.min(shp.length, dv.getInt32(24, false) * 2);
  const attrs = dbf ? readDbf(dbf) : null;
  if (attrs?.error) return { ...res, error: attrs.error };
  let o = 100, rec = 0;
  while (o + 8 <= end) {
    const clen = dv.getInt32(o + 4, false) * 2;
    const start = o + 8;
    o = start + clen;
    if (clen < 4 || o > end) { res.bad++; break; } // a record longer than the file: nothing after it can be trusted
    const row = rec++;
    const type = dv.getInt32(start, true);
    if (type === 0) continue; // a null shape
    if (type === 1 || type === 11 || type === 21 || type === 8 || type === 18 || type === 28) { res.points++; continue; }
    if (![3, 5, 13, 15, 23, 25].includes(type)) { res.bad++; continue; }
    if (clen < 44) { res.bad++; continue; }
    const nparts = dv.getInt32(start + 36, true), np = dv.getInt32(start + 40, true);
    // the counts must fit the record before anything is allocated
    if (nparts < 1 || np < 2 || 44 + nparts * 4 + np * 16 > clen) { res.bad++; continue; }
    if (res.features.length >= caps.maxShapes || res.n + np > caps.maxPoints) { res.over = true; break; }
    const parts = [];
    for (let k = 0; k < nparts; k++) parts.push(dv.getInt32(start + 44 + k * 4, true));
    if (parts[0] !== 0 || parts.some((p, k) => p >= np || (k && p <= parts[k - 1]))) { res.bad++; continue; }
    const p0 = start + 44 + nparts * 4;
    const rings = [];
    let bad = false;
    for (let k = 0; k < nparts && !bad; k++) {
      const a = parts[k], b = k + 1 < nparts ? parts[k + 1] : np;
      const ring = [];
      for (let j = a; j < b; j++) {
        const x = dv.getFloat64(p0 + j * 16, true), y = dv.getFloat64(p0 + j * 16 + 8, true);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { bad = true; break; }
        if (Math.abs(x) > 180.000001 || Math.abs(y) > 90.000001) res.notLonLat = true;
        ring.push([x, y]);
      }
      rings.push(ring);
    }
    if (bad) { res.bad++; continue; }
    res.n += np;
    let geometry;
    if (type === 3 || type === 13 || type === 23) {
      if (rings.some(r => r.length < 2)) { res.bad++; continue; }
      geometry = rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings };
    } else {
      // clockwise rings start a polygon, counter-clockwise ones are holes of the polygon before them
      const polys = [];
      for (const r of rings) {
        if (r.length < 4) continue;
        let area = 0;
        for (let j = 0; j + 1 < r.length; j++) area += (r[j + 1][0] - r[j][0]) * (r[j + 1][1] + r[j][1]);
        if (area >= 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r);
      }
      if (!polys.length) { res.bad++; continue; }
      geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    }
    res.features.push({ type: 'Feature', properties: attrs?.rows[row] ?? {}, geometry });
  }
  return res;
}

/**
 * A dBASE table (.dbf) → rows of { field: value }. Fields are checked against the header length, records against
 * the file; character data is read as UTF-8 (Latin-1 bytes that are not UTF-8 show as replacement characters).
 * @param {Uint8Array} b @returns {{ rows: Record<string, any>[], error?: string }}
 */
export function readDbf(b) {
  if (!(b instanceof Uint8Array) || b.length < 33) return { rows: [], error: 'the .dbf file is too short' };
  if (b.length > SHAPEFILE_LIMITS.maxBytes) return { rows: [], error: `the .dbf file is larger than ${SHAPEFILE_LIMITS.maxBytes / 1048576} MB` };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nrec = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
  if (hlen < 33 || hlen > b.length || rlen < 1) return { rows: [], error: 'the .dbf header is not valid' };
  const dec = new TextDecoder('utf-8');
  const fields = [];
  let off = 1;
  for (let p = 32; p + 32 <= hlen && b[p] !== 0x0d; p += 32) {
    if (fields.length >= SHAPEFILE_LIMITS.maxFields) return { rows: [], error: `the .dbf has more than ${SHAPEFILE_LIMITS.maxFields} fields` };
    let e = p; while (e < p + 11 && b[e]) e++;
    const name = dec.decode(b.subarray(p, e)).trim();
    const type = String.fromCharCode(b[p + 11]), size = b[p + 16];
    fields.push({ name, type, off, size });
    off += size;
  }
  if (off > rlen) return { rows: [], error: 'the .dbf fields are longer than its records' };
  const rows = [];
  const n = Math.min(nrec, Math.floor((b.length - hlen) / rlen));
  let chars = 0;
  for (let r = 0; r < n; r++) {
    const at = hlen + r * rlen;
    /** @type {Record<string, any>} */
    const row = {};
    for (const f of fields) {
      if (!f.name) continue;
      const raw = dec.decode(b.subarray(at + f.off, at + f.off + f.size)).trim();
      chars += raw.length;
      if (chars > SHAPEFILE_LIMITS.maxPropChars) return { rows, error: `the .dbf holds more than ${SHAPEFILE_LIMITS.maxPropChars / 1e6} million characters of attributes` };
      row[f.name] = f.type === 'N' || f.type === 'F' ? (raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw))
        : f.type === 'L' ? (/^[YyTt]$/.test(raw) ? true : /^[NnFf]$/.test(raw) ? false : null)
        : f.type === 'D' && /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
    }
    rows.push(row);
  }
  return { rows };
}
