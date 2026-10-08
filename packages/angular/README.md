# @reportwright/angular

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fangular)](https://www.npmjs.com/package/@reportwright/angular) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/angular)](https://socket.dev/npm/package/@reportwright/angular)

`<reportwright-viewer>` and `<reportwright-designer>` custom elements for Angular. Custom elements need no Angular compiler step, so they work with any Angular version.

```ts
// main.ts
import { defineReportWrightElements } from '@reportwright/angular';
defineReportWrightElements();

// a standalone component
@Component({
  selector: 'app-report',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <reportwright-viewer [options]="{ definition: def, data: { orders: orders }, fontsUrl: '/pw/fonts/' }"></reportwright-viewer>
    <reportwright-viewer [options]="{ server: 'https://reports.example.com', report: 'invoice', params: { id: id } }"></reportwright-viewer>
    <reportwright-designer [options]="{ server: server, definition: def }" (pw-save)="save($event.detail)"></reportwright-designer>`,
})
export class ReportComponent { /* … */ }
```

`options` are those of `mountViewer` / `mountDesigner` (see `@reportwright/viewer`); `server`, `report`, `height` and `lang` also work as attributes. Events: `pw-ready` (detail: the handle) and, on the designer without an `onSave`, `pw-save` (detail: the definition). MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
