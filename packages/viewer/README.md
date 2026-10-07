# @pagewrightjs/viewer

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fviewer)](https://www.npmjs.com/package/@pagewrightjs/viewer) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/viewer)](https://socket.dev/npm/package/@pagewrightjs/viewer) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The Pagewright report viewer in any web app (React is bundled inside, in a shadow root, so your styles do not leak in). A React app imports `@pagewrightjs/viewer/react-peer` (and `/react-peer/designer`) instead, the same viewer using the app's own React, so the page loads React once; `@pagewrightjs/react` does this for you:

## Without a server (library only)

```bash
npm i @pagewrightjs/viewer @pagewrightjs/fonts
# serve the fonts as static files, e.g. from your app's public folder
cp -r node_modules/@pagewrightjs/fonts/public public/pw     # fonts/, harfbuzz-subset.wasm, icc/
```

```js
import { mountViewer } from '@pagewrightjs/viewer';
mountViewer('#report', {
  definition,                         // the report JSON (see @pagewrightjs/engine/report)
  data: { orders: { rows: [...] } },  // JSON for each data source, by name (REST sources in the definition are fetched as usual)
  fontsUrl: '/pw/fonts/',             // the copied fonts folder; PDF subsetting and PDF/A use ../harfbuzz-subset.wasm and ../icc/
});
```

Nothing calls `/api`; each font is downloaded once; the toolbar uses the system font. Copying only `fonts/` works too
(PDFs then embed whole fonts, and PDF/A export needs `icc/`).

## What works standalone, what needs the server

The npm packages are a library: nothing here needs a Pagewright server. The server is a separate, self-hosted app
(not on npm): [github.com/MrArun005/pagewright](https://github.com/MrArun005/pagewright), run it with Docker
([instructions](https://github.com/MrArun005/pagewright#docker)). Options that need it are optional and hidden without it.

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

In Node, `@pagewrightjs/engine` renders and exports with no server and no browser.

## With the self-hosted Pagewright server

```js
mountViewer('#report', { server: 'https://reports.example.com', report: 'loan-statement', params: { accountId: 'LN-1' } });
```

The Pagewright server must allow your site's origin (`PW_EMBED_ORIGINS`). PDF export and barcodes load only when used. MIT.

The designer is a second entry, loaded only by pages that use it:

```js
import { mountDesigner } from '@pagewrightjs/viewer/designer';
const designer = mountDesigner('#designer', {
  server: 'https://reports.example.com',
  definition,                                   // or report: 'id' to load it from the server
  onSave: (def) => saveToMyApp(def),            // without onSave, Save writes to the Pagewright server
  onOpen: () => pickAReport(),                  // shows an Open… button; return a definition
  readOnly: false,
  toolbox: { hide: ['map', 'chart'] },
  panels: { data: true, inspector: true },
  dataSourceTemplates: [{ label: 'Orders API', source: { name: 'orders', type: 'rest', url: 'https://api.example.com/orders' } }],
});
designer.getDefinition();
```

Types are included (`ViewerOptions`, `DesignerOptions`, …). Framework wrappers: `@pagewrightjs/react`, `@pagewrightjs/vue`, `@pagewrightjs/svelte`, `@pagewrightjs/angular`.
