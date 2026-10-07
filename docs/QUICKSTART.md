# Quick start (5 minutes, library only)

No server, no account: the npm packages render reports in Node and in the browser. Node 20.9 or later.

## 1. Install

```bash
mkdir my-reports && cd my-reports && npm init -y && npm pkg set type=module
npm i @pagewrightjs/engine@0.8.0 @pagewrightjs/fonts@0.8.0
```

## 2. A report

A report is JSON: data sources, data sets, and items placed in points (1/72 inch). Save this as `invoice.pw.json`
(the full reference: [SCHEMA.md](SCHEMA.md); editors can validate against `@pagewrightjs/engine/schema.json`):

```json
{
  "$schema": "pagewright/report@1",
  "name": "Invoice",
  "page": { "size": "A4", "margins": [36, 36, 36, 36] },
  "dataSources": [{ "name": "orders", "type": "json", "data": { "rows": [] } }],
  "dataSets": [{ "name": "Lines", "source": "orders", "path": "$.rows" }],
  "sections": {
    "body": {
      "items": [
        { "type": "textbox", "name": "Title", "x": 0, "y": 0, "w": 300, "h": 24, "value": "Invoice", "style": { "fontSize": 18, "fontWeight": "bold" } },
        { "type": "table", "name": "Table", "x": 0, "y": 40, "w": 400, "h": 60, "dataSet": "Lines",
          "columns": [{ "width": 250 }, { "width": 150 }],
          "header": [{ "height": 18, "cells": [{ "value": "Item" }, { "value": "Amount", "style": { "textAlign": "right" } }] }],
          "detail": [{ "height": 18, "cells": [{ "value": "=Fields.item" }, { "value": "=Fields.amount", "style": { "format": "C2", "textAlign": "right" } }] }],
          "footer": [{ "height": 18, "cells": [{ "value": "Total" }, { "value": "=Sum(Fields.amount)", "style": { "format": "C2", "textAlign": "right", "fontWeight": "bold" } }] }] }
      ]
    }
  }
}
```

## 3. Render it

`render.js`:

```js
import fs from 'node:fs';
import { render, defaultFontStore, exportPdf, exportXlsx, validate } from '@pagewrightjs/engine';

const def = JSON.parse(fs.readFileSync('invoice.pw.json', 'utf8'));
console.log(validate(def).warnings);                          // [] when the definition is clean
def.dataSources[0].data = { rows: [{ item: 'Design', amount: 1200 }, { item: 'Hosting', amount: 99.5 }] }; // your data
const fonts = defaultFontStore();                             // from @pagewrightjs/fonts
const model = await render(def, { fontStore: fonts, exportData: true });
fs.writeFileSync('invoice.pdf', await exportPdf(model, { fonts, title: 'Invoice' }));
fs.writeFileSync('invoice.xlsx', await exportXlsx(model, { fonts }));
```

```bash
node render.js && open invoice.pdf
```

Or with no code: `npx -p @pagewrightjs/cli pw render invoice.pw.json -d orders=data.json -f pdf -o invoice.pdf`.

## 4. Show it in a web page

```bash
npm i @pagewrightjs/viewer@0.8.0
cp -r node_modules/@pagewrightjs/fonts/public public/pw     # serve the fonts as static files
```

```js
import { mountViewer } from '@pagewrightjs/viewer';
mountViewer('#report', { definition, data: { orders: { rows } }, fontsUrl: '/pw/fonts/' });
```

React, Vue, Svelte and Angular: `@pagewrightjs/react` and friends, see [examples/](../examples).

## Next

- [SCHEMA.md](SCHEMA.md): every item and property. [FUNCTIONS.md](FUNCTIONS.md): the expression functions.
- [FROM-JASPER.md](FROM-JASPER.md): coming from JasperReports.
- Many reports at once: `createPool` from `@pagewrightjs/engine/pool`.
- The self-hosted server (saved reports, SQL, schedules, users): this repository's README, run with Docker.
