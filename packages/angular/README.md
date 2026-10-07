# @pagewrightjs/angular

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fangular)](https://www.npmjs.com/package/@pagewrightjs/angular) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/angular)](https://socket.dev/npm/package/@pagewrightjs/angular) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

`<pagewright-viewer>` and `<pagewright-designer>` custom elements for Angular. Custom elements need no Angular compiler step, so they work with any Angular version.

```ts
// main.ts
import { definePagewrightElements } from '@pagewrightjs/angular';
definePagewrightElements();

// a standalone component
@Component({
  selector: 'app-report',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <pagewright-viewer [options]="{ definition: def, data: { orders: orders }, fontsUrl: '/pw/fonts/' }"></pagewright-viewer>
    <pagewright-viewer [options]="{ server: 'https://reports.example.com', report: 'invoice', params: { id: id } }"></pagewright-viewer>
    <pagewright-designer [options]="{ server: server, definition: def }" (pw-save)="save($event.detail)"></pagewright-designer>`,
})
export class ReportComponent { /* … */ }
```

`options` are those of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`); `server`, `report`, `height` and `lang` also work as attributes. Events: `pw-ready` (detail: the handle) and, on the designer without an `onSave`, `pw-save` (detail: the definition). MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@pagewrightjs/fonts/public/fonts`). `server` (the [self-hosted Pagewright server](https://github.com/MrArun005/pagewright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/pagewright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
