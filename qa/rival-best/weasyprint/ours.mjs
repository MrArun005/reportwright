// The WeasyPrint brochure as rich text (the engine's HTML subset) with a page header and "Page N of M" footer.
import { execFileSync } from 'node:child_process';
import { report, renderDef } from '../lib/rw.mjs';
const body = execFileSync('python3', ['gen.py'], { encoding: 'utf8' });
const tb = (name, y, value, align) => ({ type: 'textbox', name, x: 0, y, w: 515, h: 14, value, style: { fontSize: 9, textAlign: align } });
const def = report('Brochure', [
  { type: 'textbox', name: 'H1', x: 0, y: 0, w: 515, h: 36, value: 'Folk & Field', style: { fontSize: 26, color: '#2E7D32', fontFamily: 'serif' } },
  { type: 'richtext', name: 'Body', x: 0, y: 44, w: 515, h: 40, canGrow: true, value: body.replaceAll('<h2>', '<h2 style="color:#2E7D32">'), style: { fontSize: 11, textAlign: 'justify', fontFamily: 'serif' } },
], { sections: { pageHeader: { height: 20, items: [tb('Top', 0, 'Folk & Field brochure', 'center')] }, pageFooter: { height: 20, items: [tb('Pg', 4, 'Page {Globals.PageNumber} of {Globals.TotalPages}', 'right')] } } });
await renderDef(def);
