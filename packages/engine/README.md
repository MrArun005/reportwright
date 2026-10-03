# @pagewright/engine

The Pagewright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, HTML or CSV. Includes the `pw` command line.

```js
import { render, FontStore, exportPdf } from '@pagewright/engine';
import fs from 'node:fs';
const fonts = new FontStore((key) => fs.readFileSync(new URL(`./node_modules/@pagewright/engine/public/fonts/${key}.ttf`, import.meta.url)));
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts, parameters: { accountId: 'LN-1' } });
fs.writeFileSync('statement.pdf', await exportPdf(model, fonts, { title: 'Statement' }));
```

```bash
npx pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx pw test reports        # snapshot tests for reports-as-code
```

MIT. The fonts in `public/fonts` are under the SIL Open Font License.
