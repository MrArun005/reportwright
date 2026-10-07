# @reportwright/viewer

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fviewer)](https://www.npmjs.com/package/@reportwright/viewer) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/viewer)](https://socket.dev/npm/package/@reportwright/viewer) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The ReportWright report viewer in any web app (React is bundled inside, in a shadow root, so your styles do not leak in). A React app imports `@reportwright/viewer/react-peer` (and `/react-peer/designer`) instead, the same viewer using the app's own React, so the page loads React once; `@reportwright/react` does this for you:

Import it through your bundler (Vite, webpack, esbuild, Rollup, Next…). Its third-party libraries (pdf-lib,
@pdf-lib/fontkit, bwip-js, fflate, bidi-js) are ordinary dependencies, pinned to the versions the tests ran
against, so the package itself holds only ReportWright's own readable code.

## Without a server (library only)

```bash
npm i @reportwright/viewer @reportwright/fonts
# serve the fonts as static files, e.g. from your app's public folder
cp -r node_modules/@reportwright/fonts/public public/pw     # fonts/, harfbuzz-subset.wasm, icc/
```

```js
import { mountViewer } from '@reportwright/viewer';
mountViewer('#report', {
  definition,                         // the report JSON (see @reportwright/engine/report)
  data: { orders: { rows: [...] } },  // JSON for each data source, by name (REST sources in the definition are fetched as usual)
  fontsUrl: '/pw/fonts/',             // the copied fonts folder; PDF subsetting and PDF/A use ../harfbuzz-subset.wasm and ../icc/
});
```

Nothing calls `/api`; each font is downloaded once; the toolbar uses the system font. Copying only `fonts/` works too
(PDFs then embed whole fonts, and PDF/A export needs `icc/`).

## What works standalone, what needs the server

The npm packages are a library: nothing here needs a ReportWright server. The server is a separate, self-hosted app
(not on npm): [github.com/MrArun005/reportwright](https://github.com/MrArun005/reportwright), run it with Docker
([instructions](https://github.com/MrArun005/reportwright#docker)). Options that need it are optional and hidden without it.

| Feature | Standalone (`definition`, `data`, `fontsUrl`) | With `server` |
|---|---|---|
| View, page, search, zoom, parameters, sort, drill-down, document map | yes | yes |
| Export PDF, PDF/A, Word, Excel, PowerPoint, HTML, CSV (in the browser) | yes | yes |
| REST / JSON / XML / CSV data sources the browser can reach (CORS) | yes | yes |
| Designer: edit, preview, `onSave` / `onOpen` to your app | yes | yes |
| Load a saved report by id (`report: 'id'`), drill-through to another saved report | pass `reports: { id: definition }` | yes |
| Designer **Save** without `onSave` (writes to the server), version history | no (Save is hidden) | yes |
| SQL data sources (the server holds the connections) | no | yes |
| Server-side PDF for very large reports, schedules and e-mail, uploaded fonts, AI drafts, users and roles | no | yes |

In Node, `@reportwright/engine` renders and exports with no server and no browser.

## With the self-hosted ReportWright server

```js
mountViewer('#report', { server: 'https://reports.example.com', report: 'loan-statement', params: { accountId: 'LN-1' } });
```

The ReportWright server must allow your site's origin (`PW_EMBED_ORIGINS`). PDF export and barcodes load only when used. MIT.

The designer is a second entry, loaded only by pages that use it:

```js
import { mountDesigner } from '@reportwright/viewer/designer';
const designer = mountDesigner('#designer', {
  server: 'https://reports.example.com',
  definition,                                   // or report: 'id' to load it from the server
  onSave: (def) => saveToMyApp(def),            // without onSave, Save writes to the ReportWright server
  onOpen: () => pickAReport(),                  // shows an Open… button; return a definition
  readOnly: false,
  toolbox: { hide: ['map', 'chart'] },
  panels: { data: true, inspector: true },
  dataSourceTemplates: [{ label: 'Orders API', source: { name: 'orders', type: 'rest', url: 'https://api.example.com/orders' } }],
});
designer.getDefinition();
```

Types are included (`ViewerOptions`, `DesignerOptions`, …). Framework wrappers: `@reportwright/react`, `@reportwright/vue`, `@reportwright/svelte`, `@reportwright/angular`.

## Size

What a page downloads when the viewer mounts: **847 KB gzipped** (0.7.3: 877 KB), readable unminified code with
source maps. Loaded only when used: other interface languages (about 20 KB gzipped each), PDF export (pdf-lib),
barcodes (bwip-js), Excel/HTML/CSV export, the designer. Most of the first load is the font engine (fontkit) the
layout measures text with, and React. The package is larger unpacked (two builds: React inside, and React from your
app at `@reportwright/viewer/react-peer`, plus source maps); only one build reaches your page. PDF export, fontkit,
barcodes, zip and bidi come from the dependencies above, so your bundler can share them with the rest of your app.
