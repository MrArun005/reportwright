// A WOFF file's tables together unpack to at most the sfnt cap, not just each table on its own.
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { toSfnt } from '../../src/server/fonts.js';

function woff(n, orig) {
  const blob = zlib.deflateSync(Buffer.alloc(orig));
  const b = Buffer.alloc(44 + n * 20 + blob.length);
  b.writeUInt32BE(0x774f4646, 0); b.writeUInt32BE(0x00010000, 4); b.writeUInt16BE(n, 12);
  const off = 44 + n * 20;
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    b.writeUInt32BE(0x61616100 + i, e); b.writeUInt32BE(off, e + 4); b.writeUInt32BE(blob.length, e + 8); b.writeUInt32BE(orig, e + 12);
  }
  blob.copy(b, off);
  return new Uint8Array(b);
}

describe('WOFF unpack bound', () => {
  it('refuses tables whose total exceeds the cap', () => {
    expect(() => toSfnt(woff(100, 1024 * 1024))).toThrow(expect.objectContaining({ status: 413 }));
  });
  it('refuses a table directory longer than the file', () => {
    const b = woff(1, 16); new DataView(b.buffer).setUint16(12, 5000);
    expect(() => toSfnt(b)).toThrow(/damaged/);
  });
  it('still unpacks a small file', () => {
    expect(toSfnt(woff(2, 16)).length).toBeGreaterThan(12);
  });
});
