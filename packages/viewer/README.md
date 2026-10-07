# @pagewrightjs/viewer

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fviewer)](https://www.npmjs.com/package/@pagewrightjs/viewer) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/viewer)](https://socket.dev/npm/package/@pagewrightjs/viewer) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The Pagewright report viewer in any web app (React is bundled inside, in a shadow root, so your styles do not leak in). A React app imports `@pagewrightjs/viewer/react-peer` (and `/react-peer/designer`) instead, the same viewer using the app's own React, so the page loads React once; `@pagewrightjs/react` does this for you:

```js
import { mountViewer } from '@pagewrightjs/viewer';
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
