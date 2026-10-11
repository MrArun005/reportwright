// ReportWright side of a showcase: renderDef(def, out) through @reportwright/engine with the faces @reportwright/fonts ships.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, exportPdf, FontStore, fontFile } from '@reportwright/engine';

const dir = path.dirname(fileURLToPath(import.meta.resolve('@reportwright/fonts/public/fonts/Inter-Regular.ttf')));
const fonts = new FontStore((key) => fs.promises.readFile(path.join(dir, fontFile(key))));

export const report = (name, items, extra = {}) => ({
  $schema: 'pagewright/report@1', name, locale: 'en-US', page: { size: 'A4', margins: [40, 40, 40, 40] }, ...extra,
  sections: { body: { items }, ...(extra.sections || {}) },
});

export async function renderDef(def, out = process.env.OUT + '/ours.pdf') {
  const model = await render(def, { fontStore: fonts });
  for (const w of model.warnings || []) console.error('warning:', typeof w === 'string' ? w : JSON.stringify(w));
  fs.writeFileSync(out, await exportPdf(model, { fonts, title: def.name }));
}
