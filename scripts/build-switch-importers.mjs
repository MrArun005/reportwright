// Bundles the report-file importers (SSRS .rdl/.rdlc, JasperReports .jrxml, BIRT .rptdesign, ActiveReportsJS .rdlx-json)
// into site/switch/importers.js, so the Switch page can run them in the browser. Re-run after the importers change.
import { build } from 'esbuild';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
await build({
  stdin: { contents: "export { importXmlReport } from './src/importers/index.js';\nexport { importRdlx } from './src/importers/rdlx.js';", resolveDir: root, loader: 'js' },
  bundle: true, minify: true, format: 'esm', target: ['es2020'], charset: 'utf8', legalComments: 'none',
  outfile: path.join(root, 'site/switch/importers.js'), logLevel: 'info',
});
