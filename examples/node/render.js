import fs from 'node:fs';
import { render, defaultFontStore, exportPdf, exportXlsx, validate } from '@pagewrightjs/engine';

const def = JSON.parse(fs.readFileSync(new URL('../report.pw.json', import.meta.url), 'utf8'));
def.dataSources[0].data = JSON.parse(fs.readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const { errors, warnings } = validate(def);
if (errors.length) throw new Error(errors.join('\n'));
if (warnings.length) console.warn(warnings.join('\n'));
const fonts = defaultFontStore();
const model = await render(def, { fontStore: fonts, exportData: true });
fs.writeFileSync('orders.pdf', await exportPdf(model, { fonts, title: 'Orders' }));
fs.writeFileSync('orders.xlsx', await exportXlsx(model, { fonts }));
console.log(`orders.pdf (${model.pages.length} page), orders.xlsx`);
