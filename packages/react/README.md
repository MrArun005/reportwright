# @pagewrightjs/react

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Freact)](https://www.npmjs.com/package/@pagewrightjs/react) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/react)](https://socket.dev/npm/package/@pagewrightjs/react) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The Pagewright viewer and designer as React components. React is a peer dependency; the viewer loads on mount, so it is safe in server-rendered apps (Next.js, Remix).

```jsx
import { PagewrightViewer, PagewrightDesigner } from '@pagewrightjs/react';

<PagewrightViewer definition={def} data={{ orders }} fontsUrl="/pw/fonts/" style={{ height: 720 }} />   {/* no server */}
<PagewrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} style={{ height: 720 }} />
<PagewrightDesigner server="https://reports.example.com" definition={def} onSave={(d) => save(d)} toolbox={{ hide: ['map'] }} />
```

Props are the options of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`), plus `className`, `style` and `onReady(handle)`. The viewer remounts when what it shows changes (compared by content, so inline objects are fine); the designer only for another `report` or a `definition` with different content, so it keeps its edits. If the viewer's code fails to load, the element shows the error and `onError(error)` is called. MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@pagewrightjs/fonts/public/fonts`). `server` (the [self-hosted Pagewright server](https://github.com/MrArun005/pagewright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/pagewright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
