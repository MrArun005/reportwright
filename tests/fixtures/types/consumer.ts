// What a TypeScript app writes against the published types. Each @ts-expect-error line MUST fail to type-check:
// if one starts to pass, tsc reports the directive as unused and the test fails.
import type { Report, Item } from '@reportwright/engine';
import { render, exportPdf, FontStore } from '@reportwright/engine';
import { mountViewer, type ViewerOptions } from '@reportwright/viewer';
import { mountDesigner } from '@reportwright/viewer/designer';
import type { ReportWrightViewerProps, PagewrightViewerProps } from '@reportwright/react';
import { ReportWrightViewer, PagewrightViewer } from '@reportwright/react';
import { reportWrightViewer, pagewrightViewer } from '@reportwright/svelte';
import { defineReportWrightElements, definePagewrightElements } from '@reportwright/angular';

const report: Report = {
  $schema: 'reportwright/report@1',
  name: 'Typed',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  images: { logo: 'data:image/png;base64,iVBORw0KGgo=' },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: {
    body: {
      items: [
        { type: 'textbox', name: 'Title', x: 0, y: 0, w: 200, h: 20, value: '=Parameters.title', headingLevel: 1, style: { fontWeight: 'bold' } },
        { type: 'image', x: 0, y: 30, w: 60, h: 30, src: 'embedded:logo', fit: 'clip', autoSize: true },
        { type: 'barcode', x: 0, y: 70, w: 120, h: 120, symbology: 'qrcode', value: '=Fields.id', qrErrorLevel: 'H', rotate: 90 },
        { type: 'toc', x: 0, y: 200, w: 300, h: 20, source: 'headings', numbering: ['roman', 'alpha'] },
        { type: 'textbox', x: 0, y: 240, w: 100, h: 20, value: 'Go', action: { type: 'url', url: 'https://example.com' } },
      ],
    },
  },
};

// @ts-expect-error a misspelt item type
const typo: Item = { type: 'textbx', x: 0, y: 0, w: 1, h: 1 };
// @ts-expect-error a string where a number goes
const str: Item = { type: 'textbox', x: '10', y: 0, w: 1, h: 1 };
// @ts-expect-error an unknown option on an item
const extra: Item = { type: 'image', x: 0, y: 0, w: 1, h: 1, fitt: 'clip' };
// @ts-expect-error not a fit
const fit: Item = { type: 'image', x: 0, y: 0, w: 1, h: 1, fit: 'stretch' };
// @ts-expect-error QR error levels are L, M, Q and H
const ecc: Item = { type: 'barcode', x: 0, y: 0, w: 1, h: 1, qrErrorLevel: 'Z' };
// @ts-expect-error the report needs sections
const noSections: Report = { $schema: 'reportwright/report@1' };

async function exportIt(store: FontStore) {
  const model = await render(report, { fontStore: store });
  await exportPdf(model, { fonts: store, encrypt: { userPassword: 'x', ownerPassword: 'y', permissions: { copy: false, print: true } } });
  // @ts-expect-error not a permission
  await exportPdf(model, { fonts: store, encrypt: { permissions: { root: false } } });
  // @ts-expect-error fonts is a FontStore
  await exportPdf(model, { fonts: 'Inter' });
}

const viewer: ViewerOptions = { server: 'https://r.example.com', report: 'invoice', params: { id: '1' }, viewMode: 'single', toolbar: { hide: ['excel'] } };
mountViewer('#v', viewer).unmount();
// @ts-expect-error not a view mode
mountViewer('#v', { viewMode: 'carousel' });
const d = mountDesigner('#d', { definition: report, onSave: async (def) => { void def; }, toolbox: { hide: ['map'] }, panels: { data: false },
  dataSourceTemplates: [{ label: 'Orders', source: { name: 'orders', type: 'rest', url: 'https://api.example.com/orders' } }] });
const def: object = d.getDefinition();
// @ts-expect-error readOnly is a boolean
mountDesigner('#d', { readOnly: 'yes' });

const props: ReportWrightViewerProps = { server: 'https://r.example.com', report: 'invoice', onReady: (h) => h.unmount() };
const action = reportWrightViewer(document.body, { server: 'x', report: 'y' });
action.destroy?.();
defineReportWrightElements();
const el = document.createElement('reportwright-viewer');
el.options = { report: 'invoice' };
// the names from before the rename (Pagewright, deprecated in 0.9) still type-check
const oldProps: PagewrightViewerProps = props;
const sameComponent: typeof ReportWrightViewer = PagewrightViewer;
pagewrightViewer(document.body, { server: 'x' }).destroy?.();
definePagewrightElements();
document.createElement('pagewright-viewer').options = { report: 'invoice' };
const renamed: Report = { $schema: 'reportwright/report@1', sections: { body: { items: [] } } };

void [typo, str, extra, fit, ecc, noSections, exportIt, def, props, oldProps, sameComponent, renamed];
