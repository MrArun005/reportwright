// Builds ESRI shapefiles (.shp + .dbf) per the ESRI whitepaper (1998) and dBASE III, for the importer tests.
/** @param {{ type: number, parts: number[][][] }[]} recs parts → points [x, y] */
export function shp(recs) {
  const bodies = recs.map(({ type, parts }) => {
    const pts = parts.flat();
    const b = Buffer.alloc(44 + parts.length * 4 + pts.length * 16);
    b.writeInt32LE(type, 0);
    b.writeInt32LE(parts.length, 36); b.writeInt32LE(pts.length, 40);
    let k = 0; parts.forEach((p, i) => { b.writeInt32LE(k, 44 + i * 4); k += p.length; });
    pts.forEach(([x, y], i) => { b.writeDoubleLE(x, 44 + parts.length * 4 + i * 16); b.writeDoubleLE(y, 52 + parts.length * 4 + i * 16); });
    return b;
  });
  const len = 100 + bodies.reduce((a, b) => a + 8 + b.length, 0);
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0); h.writeInt32BE(len / 2, 24); h.writeInt32LE(1000, 28); h.writeInt32LE(recs[0]?.type ?? 5, 32);
  return Buffer.concat([h, ...bodies.flatMap((b, i) => { const r = Buffer.alloc(8); r.writeInt32BE(i + 1, 0); r.writeInt32BE(b.length / 2, 4); return [r, b]; })]);
}
/** @param {{ name: string, type: string, size: number }[]} fields @param {any[][]} rows */
export function dbf(fields, rows) {
  const hlen = 32 + fields.length * 32 + 1, rlen = 1 + fields.reduce((a, f) => a + f.size, 0);
  const b = Buffer.alloc(hlen + rows.length * rlen + 1, 0x20);
  b.fill(0, 0, hlen);
  b[0] = 3; b.writeUInt32LE(rows.length, 4); b.writeUInt16LE(hlen, 8); b.writeUInt16LE(rlen, 10);
  fields.forEach((f, i) => { b.write(f.name, 32 + i * 32, 'latin1'); b[32 + i * 32 + 11] = f.type.charCodeAt(0); b[32 + i * 32 + 16] = f.size; });
  b[hlen - 1] = 0x0d;
  rows.forEach((r, j) => { let o = hlen + j * rlen + 1; fields.forEach((f, i) => { b.write(String(r[i]).slice(0, f.size).padEnd(f.size), o, 'utf8'); o += f.size; }); });
  b[b.length - 1] = 0x1a;
  return b;
}
/** Two states (clockwise squares), the second with a hole, and their names and codes. */
export const statesShp = () => shp([
  { type: 5, parts: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] },
  { type: 5, parts: [[[10, 0], [10, 10], [20, 10], [20, 0], [10, 0]], [[12, 2], [14, 2], [14, 4], [12, 4], [12, 2]]] },
]);
export const statesDbf = () => dbf([{ name: 'STATENAME', type: 'C', size: 20 }, { name: 'CODE', type: 'N', size: 4 }], [['Westland', 1], ['Eastland', 2]]);
