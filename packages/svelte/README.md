# @reportwright/svelte

Svelte actions that mount the ReportWright report viewer and drag-and-drop designer on any element.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fsvelte)](https://www.npmjs.com/package/@reportwright/svelte) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/svelte)](https://socket.dev/npm/package/@reportwright/svelte)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) ([Embed it](https://mrarun005.github.io/reportwright-demo/#embed) shows the wrapper code; the [designer playground](https://mrarun005.github.io/reportwright-demo/play.html) is the designer this package mounts).

Plain JavaScript, so no compiler step and any Svelte version.

## Install

```bash
npm i @reportwright/svelte @reportwright/viewer @reportwright/fonts
cp -r node_modules/@reportwright/fonts/public public/pw     # serve the fonts as static files
```

Vite 7: set `worker: { format: 'es' }` in `vite.config.js` (see [`@reportwright/viewer`'s bundler setup](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#bundler-setup-read-this-first)).

## Quick start (30 seconds)

```svelte
<script>
  import { reportWrightViewer } from '@reportwright/svelte';
  import definition from './orders.pw.json';   // the report from @reportwright/engine's README examples
  const orders = { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] };
</script>
<div style="height: 720px" use:reportWrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/' }}></div>
```

The action was verified against this version with Vite 7 in Chromium (called directly, as Svelte calls it).

## Examples

**Get the handle, re-run with parameters, export:**

```svelte
<script>
  let viewer;
  const excel = async () => open(URL.createObjectURL(await viewer.export('xlsx')));
</script>
<button on:click={() => viewer.setParameters({ minAmount: 100 })}>Over 100</button>
<button on:click={excel}>Excel</button>
<div use:reportWrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/', onReady: (h) => (viewer = h), onError: console.error }}></div>
```

**Edit a report and save it to your own API:**

```svelte
<div use:reportWrightDesigner={{ definition, fontsUrl: '/pw/fonts/', onSave: (def) => fetch('/api/reports/orders', { method: 'PUT', body: JSON.stringify(def) }) }}></div>
```

**With a self-hosted ReportWright server:**

```svelte
<div use:reportWrightViewer={{ server: 'https://reports.example.com', report: 'invoice', params: { id } }}></div>
<div use:reportWrightDesigner={{ server, definition, onSave: save }}></div>
```

A runnable app is in the repository's [`examples/svelte`](https://github.com/MrArun005/reportwright/tree/main/examples/svelte).

## Options

| | Meaning |
|---|---|
| everything of `mountViewer` / `mountDesigner` | full table in [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#options-reference) |
| `onReady(handle)` | the `ViewerHandle` / `DesignerHandle` |
| `onError(error)` | the viewer's code did not load (the element shows the message) |

When the options change, the viewer remounts only if what it shows changed (compared by content, callbacks ignored); the designer only for another `server`, `report`, `readOnly` or `definition` content, so it keeps its edits. `destroy` unmounts.

## Support

Any Svelte version (peer `svelte >= 3`). Browsers and limits are the viewer's: see [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#browser-support-and-limits).

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).

## Related packages

[`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) (what this wraps), [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine), [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts), and the [`react`](https://github.com/MrArun005/reportwright/tree/main/packages/react), [`vue`](https://github.com/MrArun005/reportwright/tree/main/packages/vue) and [`angular`](https://github.com/MrArun005/reportwright/tree/main/packages/angular) wrappers.

MIT.
