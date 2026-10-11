import fs from 'node:fs';
import { loadPdf, mergePdfs } from '@reportwright/pdf';
const dir = process.env.OUT + '/in';
const files = fs.readdirSync(dir).sort().map((f) => `${dir}/${f}`);
const docs = await Promise.all(files.map(async (f) => loadPdf(fs.readFileSync(f))));
fs.writeFileSync(process.env.OUT + '/ours.pdf', (await mergePdfs(docs)).bytes);
