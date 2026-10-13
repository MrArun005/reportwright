// Assess a folder of reports before importing: POST multipart form files (or one .zip) of SSRS, JasperReports, BIRT and
// ActiveReports files, optional `usage` (a CSV/JSON usage export); the query takes retireDays and hours. Nothing is saved:
// the answer is the assessment (the same JSON as pw assess writes to assessment.json). Limits as src/cli/assess.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { principalOf } from '@/server/perms.js';
import { arrive } from '@/server/pool.js';
import { errorResponse } from '@/server/errors.js';
import { assessFolder, parseUsage, parseHours, ASSESS_LIMITS } from '@/cli/assess.js';

export const runtime = 'nodejs';

const KEEP = /\.(rdlc?|jrxml|rptdesign|rdlx-json|rds|jrtx|rptlibrary|png|jpe?g|gif|svg|bmp|webp)$/i;
const BODY_MAX = 50 * 1024 * 1024; // the upload as a whole; each file is then capped by the assessment's own limits
const USAGE_MAX = 16 * 1024 * 1024; // as pw assess --usage
const MAX_RUNNING = 2; // assessments at once per process: each one parses many files
let running = 0;
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** the body, read under BODY_MAX whatever content-length says (or does not) */
async function readCapped(req) {
  if (Number(req.headers.get('content-length')) > BODY_MAX) return null;
  if (!req.body) return new Uint8Array(0);
  const parts = [];
  let n = 0;
  for await (const c of req.body) {
    n += c.length;
    if (n > BODY_MAX) return null;
    parts.push(c);
  }
  return Buffer.concat(parts);
}

/**
 * A zip's report entries, read from its central directory and inflated by zlib with maxOutputLength, so no entry can
 * grow past what is left of the limits however its headers lie (zlib stops before allocating more). Only stored and
 * deflated entries are read; anything else is refused.
 */
function unzipBounded(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => httpError(400, 'The zip is damaged');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw damaged();
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count > ASSESS_LIMITS.maxFiles) throw httpError(413, `the zip has more than ${ASSESS_LIMITS.maxFiles} files`);
  const out = {};
  let p = cdOff, total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw damaged();
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || !KEEP.test(name)) continue;
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw damaged();
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw damaged();
    const data = buf.subarray(start, start + csize);
    const room = Math.min(ASSESS_LIMITS.maxBytes, ASSESS_LIMITS.maxTotal - total);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) {
      try { raw = zlib.inflateRawSync(data, { maxOutputLength: room + 1 }); } catch (e) {
        if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer/i.test(String(e?.message))) raw = null; else throw damaged();
      }
    } else throw httpError(400, 'The zip uses a compression method other than deflate');
    if (!raw || raw.length > room)
      throw httpError(413, raw === null || raw.length > ASSESS_LIMITS.maxTotal - total ? `a file in the zip is larger than ${ASSESS_LIMITS.maxBytes} bytes or the zip unpacks to more than the assessment limit` : `a file in the zip is larger than ${ASSESS_LIMITS.maxBytes} bytes`);
    total += raw.length;
    out[name] = raw;
  }
  return out;
}

/** The uploaded files as { name, bytes } (a .zip is opened: its entries count against the same limits). */
async function uploaded(form) {
  const out = [];
  let total = 0;
  const add = (name, bytes) => {
    const base = path.basename(String(name).replace(/\\/g, '/'));
    if (!KEEP.test(base)) return;
    total += bytes.length;
    if (out.length >= ASSESS_LIMITS.maxFiles) throw httpError(413, `more than ${ASSESS_LIMITS.maxFiles} files`);
    if (total > ASSESS_LIMITS.maxTotal)
      throw httpError(413, `the files add up to more than ${ASSESS_LIMITS.maxTotal} bytes`);
    out.push({ name: base, bytes });
  };
  for (const f of form.getAll('files')) {
    if (typeof f === 'string') continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipBounded(bytes);
      for (const [name, data] of Object.entries(entries)) add(name, data);
    } else add(f.name, bytes);
  }
  return out;
}

export async function POST(req) {
  let ticket;
  try {
    ticket = arrive(req); // 429/503 before auth or the body, like a render
  } catch (e) {
    return errorResponse(e);
  }
  let counted = false;
  try {
    const p = await principalOf(req);
    if (p.kind === 'anon') throw httpError(401, 'Sign in to assess reports');
    if (!(p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && p.role !== 'viewer')))
      throw httpError(403, 'Only designers can assess reports');
    ticket.bind(p);
    if (running >= MAX_RUNNING) return Response.json({ error: 'Too many assessments are running; try again shortly' }, { status: 429, headers: { 'retry-after': '5' } });
    running++;
    counted = true;
    if (!/multipart\/form-data/i.test(req.headers.get('content-type') || ''))
      throw httpError(400, 'Send the report files as multipart/form-data (field "files")');
    const body = await readCapped(req);
    if (!body) throw httpError(413, 'The upload can be at most 50 MB');
    let form;
    try {
      form = await new Request(req.url, { method: 'POST', headers: { 'content-type': req.headers.get('content-type') || '' }, body }).formData();
    } catch {
      throw httpError(400, 'Send the report files as multipart/form-data (field "files")');
    }
    const files = await uploaded(form);
    if (!files.length)
      throw httpError(
        400,
        'No report files: send .rdl, .rdlc, .jrxml, .rptdesign or .rdlx-json files, or a .zip of them',
      );
    const sp = new URL(req.url).searchParams;
    const usageField = form.get('usage');
    if (usageField && typeof usageField !== 'string' && usageField.size > USAGE_MAX) throw httpError(413, 'The usage file can be at most 16 MB');
    const usage =
      usageField && typeof usageField !== 'string' ? parseUsage(await usageField.text(), usageField.name) : undefined;
    let hours;
    try {
      hours = parseHours(sp.get('hours') || '');
    } catch (e) {
      throw httpError(400, e.message);
    }
    const retireDays = Number(sp.get('retireDays')) || undefined;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-assess-'));
    try {
      for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.bytes, { flag: 'wx' }); // flat, names sanitised; duplicates refused by wx
      const a = await assessFolder(dir, {
        usage,
        hours,
        retireDays,
        maxFiles: ASSESS_LIMITS.maxFiles,
        maxBytes: ASSESS_LIMITS.maxBytes,
        maxTotal: ASSESS_LIMITS.maxTotal,
      });
      return Response.json({ ...a, input: 'uploaded files' }); // the server's temporary folder is not shown
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    if (e?.status) return Response.json({ error: e.message }, { status: e.status });
    if (e?.code === 'EEXIST') return Response.json({ error: 'Two uploaded files have the same name' }, { status: 400 });
    return errorResponse(e);
  } finally {
    if (counted) running--;
    ticket.release();
  }
}
