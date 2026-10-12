# Embedding the viewer (and designer) in your app

Show a ReportWright report inside your own web app, with your users' sign-in. Use it when reports belong in your product, not on a separate site. The viewer and designer run in a Shadow DOM, so your page styles do not change them.

## In the UI

Not a UI feature. Embedding is code you add to your own app. Set `PW_EMBED_ORIGINS` on the ReportWright server, and build it, so your site may read reports (see Notes).

## From the CLI

Not available in the CLI.

## Through the API

Not available in the API. The embed uses the viewer script, `/embed/reportwright-viewer.js`, which reads reports from the server. Your app may also call the API (see [render-a-report](render-a-report.md)).

## Code

Script tag:

```html
<div id="report"></div>
<script src="https://reports.example.com/embed/reportwright-viewer.js"></script>
<script>
  ReportWright.mountViewer('#report', {
    server: 'https://reports.example.com',
    report: 'loan-statement',
    params: { accountId: 'LN-2025-001982' },
    lang: 'en',
    viewMode: 'continuous',
    toolbar: { hide: ['excel', 'word'] },
  });
</script>
```

Designer, in the same page: `const designer = await ReportWright.mountDesigner('#designer', { server, report: 'id', onSave: (def) => … })`.

React:

```jsx
import { ReportWrightViewer } from '@reportwright/react';
<ReportWrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} style={{ height: 720 }} />
```

Vue:

```html
<ReportWrightViewer :options="{ server, report }" />
```

Svelte:

```html
<div use:reportWrightViewer={{ server, report }}></div>
```

Angular: call `defineReportWrightElements()`, then use `<reportwright-viewer [options]="…">` with `CUSTOM_ELEMENTS_SCHEMA`.

Templates to start from: [create-reportwright](create-reportwright.md).

## Notes

- Options: `server`, `report`, `params`, `lang` (`en`, `hi`, `es`, `fr`, `de`, `ja`, `zh`, `pt-BR`, `ar`), `viewMode` (`single`, `continuous`, `galley`), `toolbar` (`hide`, `add`).
- Toolbar ids: `parameters`, `documentMap`, `run`, `firstPage`, `previousPage`, `pageNumber`, `nextPage`, `lastPage`, `zoomOut`, `zoomValue`, `zoomIn`, `fitWidth`, `viewMode`, `fullScreen`, `stats`, `search`, `print`, `pdf`, `excel`, `word`, `powerpoint`, `html`, `csv`, `json`, `exportOptions`.
- Add your own button with `toolbar.add`. A new id that matches a built-in is ignored. Hide the built-in first to replace it.
- `PW_EMBED_ORIGINS` (set at build time too) lets your site read reports and sample data. With accounts on, set it at run time as well.
- Designer options: `onSave`, `onOpen`, `readOnly`, `toolbox.hide`, `panels`, `dataSourceTemplates`, `height`.
- Packages: `@reportwright/viewer`, `@reportwright/react`, `@reportwright/vue`, `@reportwright/svelte`, `@reportwright/angular`, `@reportwright/engine` (see `docs/API.md`, Framework packages).
