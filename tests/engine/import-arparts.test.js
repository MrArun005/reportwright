// ActiveReports reuse: master reports, report parts (libraries) and layers map to Pagewright's own.
import { describe, it, expect } from 'vitest';
import { importRdlx } from '../../src/importers/rdlx.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const tb = (Name, Value, extra = {}) => ({ Type: 'textbox', Name, Value, Left: '0in', Top: '0in', Width: '2in', Height: '0.25in', ...extra });
const report = (extra) => ({ Name: 'R', Page: { PageWidth: '8.5in', PageHeight: '11in' }, Body: { Height: '2in', ReportItems: [] }, ...extra });

describe('ActiveReports layers', () => {
  it('Layers become report layers; LayerName puts an item on one', () => {
    const r = importRdlx(report({
      Layers: [{ Name: 'default' }, { Name: 'Watermark', TargetDevice: 'Paper' }, { Name: 'Notes', TargetDevice: 'None' }, { Name: 'Hidden', DesignerVisible: false, Visible: false }],
      Body: { Height: '2in', ReportItems: [tb('A', 'a'), tb('B', 'b', { LayerName: 'Watermark' }), tb('C', 'c', { LayerName: 'default' })] },
    }));
    expect(r.definition.layers).toEqual([{ name: 'Watermark', target: 'print' }, { name: 'Notes', target: 'design' }, { name: 'Hidden', visible: false }]);
    const [a, b, c] = r.definition.sections.body.items;
    expect(a.layer).toBeUndefined(); expect(b.layer).toBe('Watermark'); expect(c.layer).toBeUndefined();
  });
  it('an item on an undeclared layer is kept on it, with a note', () => {
    const r = importRdlx(report({ Body: { Height: '1in', ReportItems: [tb('A', 'a', { LayerName: 'Ghost' })] } }));
    expect(r.definition.sections.body.items[0].layer).toBe('Ghost');
    expect(r.definition.layers).toEqual([{ name: 'Ghost' }]);
  });
});

describe('ActiveReports report parts', () => {
  it('a library: ReportParts become parts with properties; PartProperties!x.Value reads them', async () => {
    const lib = importRdlx(report({
      Name: 'Sales Library',
      ReportParts: [{ Name: 'Banner', ReportItemName: 'BannerBox', Description: 'A title bar', Properties: [{ Name: 'Title', DefaultValue: 'Sales' }, { Name: 'Color', DefaultValue: 'Navy' }] }],
      Body: { Height: '1in', ReportItems: [tb('BannerBox', '=PartProperties!Title.Value & " report"')] },
    }));
    expect(lib.definition.parts).toEqual([{ name: 'Banner', item: 'BannerBox', description: 'A title bar', properties: [{ name: 'Title', default: 'Sales' }, { name: 'Color', default: 'Navy' }] }]);
    const box = lib.definition.sections.body.items[0];
    expect(box.value).toMatch(/PartProperties\.Title/);
    // and it renders through a part instance in another report
    const user = importRdlx(report({
      Body: { Height: '1in', ReportItems: [{ Type: 'reportpart', Name: 'Top', Library: 'Sales Library.rdlx-json', ReportPart: 'Banner', Left: '0in', Top: '0in', Width: '3in', Height: '0.3in', Properties: [{ Name: 'Title', Value: 'Q3' }] }] },
    }));
    const inst = user.definition.sections.body.items[0];
    expect(inst).toMatchObject({ type: 'part', library: 'sales-library', part: 'Banner', properties: { Title: 'Q3' } });
    expect(user.warnings.join('\n')).toMatch(/sales-library/);
    const out = await render(user.definition, { fontStore, loadReport: async (id) => (id === 'sales-library' ? lib.definition : null) });
    expect(out.pages[0].items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text))).toContain('Q3 report');
  });
});

describe('ActiveReports master reports', () => {
  it('a master: ContentPlaceHolder items become placeholders', () => {
    const m = importRdlx(report({ Body: { Height: '3in', ReportItems: [tb('Logo', 'ACME'), { Type: 'contentplaceholder', Name: 'Main', Left: '0in', Top: '0.5in', Width: '7in', Height: '2in' }] } }));
    const ph = m.definition.sections.body.items.find(i => i.type === 'placeholder');
    expect(ph).toMatchObject({ type: 'placeholder', name: 'Main', y: 36, h: 144 });
    expect(m.stats.dropped).toBe(0);
  });
  it('a content report names its master by id; the body fills the master', async () => {
    const m = importRdlx(report({ Body: { Height: '3in', ReportItems: [tb('Logo', 'ACME'), { Type: 'contentplaceholder', Name: 'Main', Left: '0in', Top: '0.5in', Width: '7in', Height: '2in' }] } }));
    const c = importRdlx(report({ MasterReport: 'Corporate Master.rdlx-master', Body: { Height: '1in', ReportItems: [tb('Hello', 'Hello')] } }));
    expect(c.definition.master).toBe('corporate-master');
    expect(c.warnings.join('\n')).toMatch(/corporate-master/);
    const out = await render(c.definition, { fontStore, loadReport: async (id) => (id === 'corporate-master' ? m.definition : null) });
    const t = out.pages[0].items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => l.text));
    expect(t).toEqual(expect.arrayContaining(['ACME', 'Hello']));
  });
});
