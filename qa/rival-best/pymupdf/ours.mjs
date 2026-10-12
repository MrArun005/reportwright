import fs from 'node:fs';
import { loadPdf } from '@reportwright/pdf';
const d = await loadPdf(fs.readFileSync(process.env.OUT + '/in.pdf'));
const t = await d.extractText();
fs.writeFileSync(process.env.OUT + '/ours.txt', Array.isArray(t) ? t.join('\n') : typeof t === 'string' ? t : JSON.stringify(t));
