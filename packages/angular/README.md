# @reportwright/angular

`<reportwright-viewer>` and `<reportwright-designer>` custom elements: the ReportWright report viewer and drag-and-drop designer in Angular.

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fangular)](https://www.npmjs.com/package/@reportwright/angular) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/angular)](https://socket.dev/npm/package/@reportwright/angular)

**Live demo:** [mrarun005.github.io/reportwright-demo](https://mrarun005.github.io/reportwright-demo) ([Embed it](https://mrarun005.github.io/reportwright-demo/#embed) shows the wrapper code; the [designer playground](https://mrarun005.github.io/reportwright-demo/play.html) is the designer these elements mount).

Custom elements need no Angular compiler step, so they work with any Angular version.

## Install

```bash
npm i @reportwright/angular @reportwright/viewer @reportwright/fonts
```

Serve the fonts as static assets, e.g. in `angular.json` under `assets`:
`{ "glob": "**/*", "input": "node_modules/@reportwright/fonts/public", "output": "pw" }`, then pass `fontsUrl: '/pw/fonts/'`.

## Quick start (30 seconds)

```ts
// main.ts
import { defineReportWrightElements } from '@reportwright/angular';
defineReportWrightElements();

// orders.component.ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import definition from './orders.pw.json';   // the report from @reportwright/engine's README examples (resolveJsonModule)

@Component({
  selector: 'app-orders',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<reportwright-viewer [options]="options" style="display:block;height:720px"></reportwright-viewer>`,
})
export class OrdersComponent {
  options = {
    definition,
    data: { orders: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }, { customer: 'Ben Ode', amount: 80 }] } },
    fontsUrl: '/pw/fonts/',
  };
}
```

The elements were verified against this version with Vite 7 in Chromium (created from plain JavaScript, as Angular does).

## Examples

**Get the handle, re-run with parameters, export:**

```ts
@Component({
  selector: 'app-orders',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <button (click)="viewer?.setParameters({ minAmount: 100 })">Over 100</button>
    <button (click)="excel()">Excel</button>
    <reportwright-viewer [options]="options" (pw-ready)="viewer = $event.detail"></reportwright-viewer>`,
})
export class OrdersComponent {
  viewer?: ViewerHandle;   // import type { ViewerHandle } from '@reportwright/angular'
  options = { definition, data: { orders }, fontsUrl: '/pw/fonts/' };
  async excel() { open(URL.createObjectURL(await this.viewer!.export('xlsx'))); }
}
```

**Edit a report and save it** (without `onSave` in the options, the designer fires `pw-save`):

```html
<reportwright-designer [options]="{ definition: def, fontsUrl: '/pw/fonts/' }" (pw-save)="save($event.detail)"></reportwright-designer>
```

**With a self-hosted ReportWright server:**

```html
<reportwright-viewer [options]="{ server: 'https://reports.example.com', report: 'invoice', params: { id: id } }"></reportwright-viewer>
<reportwright-designer [options]="{ server: server, definition: def }" (pw-save)="save($event.detail)"></reportwright-designer>
```

A runnable app is in the repository's [`examples/angular`](https://github.com/MrArun005/reportwright/tree/main/examples/angular).

## Properties, attributes and events

| | Element | Meaning |
|---|---|---|
| `options` property | both | the options of `mountViewer` / `mountDesigner` (full table in [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#options-reference)) |
| `server`, `report`, `height`, `lang` attributes | both | the same options as attributes |
| `pw-ready` | both | `detail`: the `ViewerHandle` / `DesignerHandle` |
| `pw-error` | both | `detail`: the error when the viewer's code did not load |
| `pw-save` | designer | `detail`: the definition (only when `options` has no `onSave`) |

Exports: `defineReportWrightElements()`, and the types `ReportWrightViewerElement`, `ReportWrightDesignerElement`, `ReportWrightReadyEvent`, `ViewerHandle`, `DesignerHandle`.

## Support

Angular 14 or later (peer `@angular/core >= 14`). Browsers and limits are the viewer's: see [`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#browser-support-and-limits).

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).

## Related packages

[`@reportwright/viewer`](https://github.com/MrArun005/reportwright/tree/main/packages/viewer) (what this wraps), [`@reportwright/engine`](https://github.com/MrArun005/reportwright/tree/main/packages/engine), [`@reportwright/fonts`](https://github.com/MrArun005/reportwright/tree/main/packages/fonts), and the [`react`](https://github.com/MrArun005/reportwright/tree/main/packages/react), [`vue`](https://github.com/MrArun005/reportwright/tree/main/packages/vue) and [`svelte`](https://github.com/MrArun005/reportwright/tree/main/packages/svelte) wrappers.

MIT.
