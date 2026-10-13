# @reportwright/react

The ReportWright report viewer and drag-and-drop designer as React components.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Freact)](https://www.npmjs.com/package/@reportwright/react) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/react)](https://socket.dev/npm/package/@reportwright/react)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) ([Embed it](https://mrarun005.github.io/reportwright-demo/#embed) shows the wrapper code; the [designer playground](https://mrarun005.github.io/reportwright-demo/play.html) is the designer this package mounts).

React is a peer dependency, and the components use your app's React (through `@reportwright/viewer/react-peer`), so the page loads React once. The viewer loads on mount, so it is safe in server-rendered apps (Next.js, Remix).


<img src="https://raw.githubusercontent.com/MrArun005/reportwright/main/docs/screenshots/ui-viewer.jpg" alt="The viewer" width="60%">

## Install

```bash
npm i @reportwright/react @reportwright/viewer @reportwright/fonts
cp -r node_modules/@reportwright/fonts/public public/pw     # serve the fonts as static files
```

Vite 7: set `worker: { format: 'es' }` in `vite.config.js` (see [`@reportwright/viewer`'s bundler setup](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#bundler-setup-read-this-first)).

## Quick start (30 seconds)

```jsx
import { createRoot } from 'react-dom/client';
import { ReportWrightViewer } from '@reportwright/react';
import definition from './orders.pw.json';   // the report from @reportwright/engine's README examples

const orders = { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] };

createRoot(document.getElementById('app')).render(
  <ReportWrightViewer definition={definition} data={{ orders }} fontsUrl="/pw/fonts/" style={{ height: 720 }} />,
);
```

Verified against this version with Vite 7 and React 18 in Chromium.

## Examples

**Control the viewer through a ref** (the ref gets the same `ViewerHandle` as `onReady`):

```jsx
import { useRef } from 'react';

function Orders({ minAmount }) {
  const viewer = useRef(null);
  return (
    <>
      <button onClick={() => viewer.current?.setParameters({ minAmount })}>Apply</button>
      <button onClick={async () => open(URL.createObjectURL(await viewer.current.export('xlsx')))}>Excel</button>
      <ReportWrightViewer ref={viewer} definition={definition} data={{ orders }} fontsUrl="/pw/fonts/"
        onReady={(h) => h.on('ready', ({ pages }) => console.log(pages, 'pages'))} onError={console.error} style={{ height: 720 }} />
    </>
  );
}
```

**Edit a report and save it to your own API:**

```jsx
import { ReportWrightDesigner } from '@reportwright/react';

<ReportWrightDesigner definition={definition} fontsUrl="/pw/fonts/" toolbox={{ hide: ['map'] }} style={{ height: 760 }}
  onSave={(def) => fetch('/api/reports/orders', { method: 'PUT', body: JSON.stringify(def) })} />
```

**With a self-hosted ReportWright server** (saved reports, SQL sources):

```jsx
<ReportWrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} style={{ height: 720 }} />
<ReportWrightDesigner server="https://reports.example.com" definition={def} onSave={(d) => save(d)} toolbox={{ hide: ['map'] }} />
```

A runnable app is in the repository's [`examples/react`](https://github.com/MrArun005/reportwright/tree/main/examples/react).

## Props

Props are the options of `mountViewer` / `mountDesigner` (full table in [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#options-reference)), plus:

| Prop | Component | Meaning |
|---|---|---|
| `className`, `style` | both | on the host element |
| `onReady(handle)` | both | the `ViewerHandle` / `DesignerHandle` (the viewer's own `onReady(error)` is not passed through) |
| `onError(error)` | both | the viewer's code did not load (the element shows the message) |
| `ref` | viewer | the `ViewerHandle` (`setParameters`, `setDefinition`, `goToPage`, `getPageCount`, `print`, `export`, `on`, `unmount`); `null` after unmount |

The viewer remounts when what it shows changes (compared by content, so inline objects are fine); the designer only for another `report` or a `definition` with different content, so it keeps its edits. Types: `ReportWrightViewerProps`, `ReportWrightDesignerProps`.

## Support

React 18 or later (`react`, `react-dom` peers). Browsers and limits are the viewer's: see [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#browser-support-and-limits).

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).

## Related packages

[`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) (what this wraps), [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine) (render the same reports in Node), [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts), and the [`vue`](https://github.com/MrArun005/reportwright/tree/main/packages/vue), [`svelte`](https://github.com/MrArun005/reportwright/tree/main/packages/svelte) and [`angular`](https://github.com/MrArun005/reportwright/tree/main/packages/angular) wrappers.

MIT.
