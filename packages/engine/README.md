# @pagewright/engine

The Pagewright report engine for Node and browsers: a JSON report definition and data in, pages out, then PDF (also PDF/A-2b), Word, Excel, HTML or CSV. Includes the `pw` command line.

```js
import { render, FontStore, exportPdf, createSubsetter } from '@pagewright/engine';
import fs from 'node:fs';
const pub = new URL('./node_modules/@pagewright/engine/public/', import.meta.url);
const fonts = new FontStore((key) => fs.readFileSync(new URL(`fonts/${key}.ttf`, pub)));
// embed only the glyphs a PDF uses (without it, every font embeds in full: a few hundred KB each)
const subset = createSubsetter(() => fs.promises.readFile(new URL('harfbuzz-subset.wasm', pub)));
const model = await render(JSON.parse(fs.readFileSync('statement.pw.json', 'utf8')), { fontStore: fonts, parameters: { accountId: 'LN-1' } });
fs.writeFileSync('statement.pdf', await exportPdf(model, fonts, { title: 'Statement', subset }));
```

```bash
npx pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx pw test reports        # snapshot tests for reports-as-code
```

MIT. The fonts in `public/fonts` are under the SIL Open Font License.
