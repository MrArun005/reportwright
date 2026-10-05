# @pagewrightjs/angular

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
    <pagewright-viewer [options]="{ server: 'https://reports.example.com', report: 'invoice', params: { id: id } }"></pagewright-viewer>
    <pagewright-designer [options]="{ server: server, definition: def }" (pw-save)="save($event.detail)"></pagewright-designer>`,
})
export class ReportComponent { /* … */ }
```

`options` are those of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`); `server`, `report`, `height` and `lang` also work as attributes. Events: `pw-ready` (detail: the handle) and, on the designer without an `onSave`, `pw-save` (detail: the definition). MIT.
