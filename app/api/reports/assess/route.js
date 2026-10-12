// Assess a folder of reports before importing: POST multipart form files (or one .zip) of SSRS, JasperReports, BIRT and
// ActiveReports files, optional `usage` (a CSV/JSON usage export); the query takes retireDays and hours. Nothing is saved:
// the answer is the assessment (the same JSON as pw assess writes to assessment.json). Limits as src/cli/assess.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { principalOf } from '@/server/perms.js';
import { errorResponse } from '@/server/errors.js';
import { assessFolder, parseUsage, parseHours, ASSESS_LIMITS } from '@/cli/assess.js';

export const runtime = 'nodejs';

const KEEP = /\.(rdlc?|jrxml|rptdesign|rdlx-json|rds|jrtx|rptlibrary|png|jpe?g|gif|svg|bmp|webp)$/i;
const BODY_MAX = 50 * 1024 * 1024; // the upload as a whole; each file is then capped by the assessment's own limits
const httpError = (status, message) => Object.assign(new Error(message), { status });

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
      let n = 0,
        sum = 0;
      const entries = unzipSync(bytes, {
        filter: (e) => {
          if (e.name.endsWith('/')) return false;
          if (++n > ASSESS_LIMITS.maxFiles)
            throw httpError(413, `the zip has more than ${ASSESS_LIMITS.maxFiles} files`);
          sum += e.originalSize;
          if (sum > ASSESS_LIMITS.maxTotal) throw httpError(413, 'the zip unpacks to more than the assessment limit');
          return KEEP.test(e.name);
        },
      });
      for (const [name, data] of Object.entries(entries)) add(name, data);
    } else add(f.name, bytes);
  }
  return out;
}

export async function POST(req) {
  try {
    await principalOf(req);
    if (Number(req.headers.get('content-length')) > BODY_MAX) throw httpError(413, 'The upload can be at most 50 MB');
    if (!/multipart\/form-data/i.test(req.headers.get('content-type') || ''))
      throw httpError(400, 'Send the report files as multipart/form-data (field "files")');
    const form = await req.formData();
    const files = await uploaded(form);
    if (!files.length)
      throw httpError(
        400,
        'No report files: send .rdl, .rdlc, .jrxml, .rptdesign or .rdlx-json files, or a .zip of them',
      );
    const sp = new URL(req.url).searchParams;
    const usageField = form.get('usage');
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
  }
}
