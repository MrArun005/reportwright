// node pdfjs-check.mjs <file.pdf>: can pdf.js open it and get the text of its first and last page? One JSON line.
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const r = { ok: false };
try {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), password: '', isEvalSupported: false, verbosity: 0 }).promise;
  r.pages = doc.numPages;
  for (const n of new Set([1, doc.numPages])) await (await doc.getPage(n)).getTextContent();
  r.ok = true;
} catch (e) { r.error = String(e?.message ?? e).slice(0, 300); }
console.log(JSON.stringify(r));
process.exit(0);
