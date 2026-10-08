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

Nothing calls `/api`; each font is downloaded once; the toolbar uses the system font.

If a font cannot be loaded (wrong `fontsUrl`, the folder not served), the report still draws in a fallback font and the
viewer says which fonts failed, on screen. `onReady(error)` is called when the first run ends: `null` when it went
through, or the error that stopped it (a font that did not load counts). Bundled apps: serve the fonts folder at the URL
you pass as `fontsUrl`; `fontsUrl` is not inferred from the package. Copying only `fonts/` works too
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

## Content Security Policy

The viewer needs no `'unsafe-inline'`: its styles are constructable stylesheets, and the style attributes of the drawing
are applied through CSSOM. The policy for a page with the viewer (standalone, fonts on the same origin):

```
default-src 'self';
script-src 'self';
style-src 'self';
font-src 'self';
img-src 'self' data: blob:;
connect-src 'self'
```

This is the policy the viewer's standalone page is tested under (PDF export included). Keep the viewer's script in a
file (`<script type="module" src="…">`), not inline. The viewer adds a `<style>` element only in browsers without
constructable stylesheets, and gives it the `nonce` you pass (`mountViewer(el, { nonce })`).

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

### Viewer toolbar: `toolbar.hide`

`toolbar: { hide: [...], add: [...] }` hides built-in items. A group key hides the whole group; an item id hides that one item. Hiding every export format also hides the Export menu and its options gear.

| Key | Hides |
|---|---|
| `export` | the Export menu: every format and the options gear (Print stays) |
| `pdf`, `excel`, `word`, `powerpoint`, `html`, `csv`, `json` | that one export format |
| `print` | the Print button |
| `search` | the search box and its match controls |
| `zoom` | zoom out, zoom value, zoom in, whole page, fit width |
| `navigation` | first page, previous, page number, next, last page |
| `sidebar` | the page thumbnails and the document map buttons |
| `parameters` | the Parameters button |
| `run`, `viewMode`, `fullScreen`, `stats` | those single items (use their id) |
| `exportOptions` | the options gear (the formats stay) |

Any other key is taken as an item id. Unknown keys hide nothing.

### Controlling a mounted viewer: `ViewerHandle`

`mountViewer` returns a handle (the React, Vue, Svelte and Angular wrappers give you the same one through their ready callback or event):

| Method | What it does |
|---|---|
| `setParameters(params)` | merges `params` into the current parameters and runs the report again; the host element is not remounted |
| `setDefinition(def)` | shows another report definition in the same element |
| `goToPage(n)` | scrolls to page `n` (1-based) |
| `getPageCount()` | the page count of the last run (0 before the first) |
| `print()` | opens the print dialog for the PDF |
| `export(format)` | `Promise<Blob>`: `format` is `pdf`, `xlsx`, `docx`, `pptx`, `html`, `csv` or `json` (or the item ids `excel`, `word`, `powerpoint`) |
| `on(event, fn)` | listens for `ready` (a run finished, detail: page count), `error` (detail: message), `page` (detail: current page), `parameters` (detail: the parameters); returns an unsubscribe function |
| `unmount()` | removes the viewer |

```js
const viewer = mountViewer('#report', { server, report: 'loan-statement' });
viewer.setParameters({ accountId: 'LN-2' });      // re-runs; 'ready' fires when it is done
const pdf = await viewer.export('pdf');           // a Blob
```

## Size

What a page downloads when the viewer mounts: **847 KB gzipped** (0.7.3: 877 KB), readable unminified code with
source maps. Loaded only when used: other interface languages (about 20 KB gzipped each), PDF export (pdf-lib),
barcodes (bwip-js), Excel/HTML/CSV export, the designer. Most of the first load is the font engine (fontkit) the
layout measures text with, and React. The package is larger unpacked (two builds: React inside, and React from your
app at `@reportwright/viewer/react-peer`, plus source maps); only one build reaches your page. PDF export, fontkit,
barcodes, zip and bidi come from the dependencies above, so your bundler can share them with the rest of your app.
