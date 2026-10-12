// Builds the extension into dist/. Three bundles plus copied assets:
//   extension.js  the VS Code glue (commands, diagnostics, preview) - loaded at activation
//   engine.js     the report engine (render, exporters, validate, import) - loaded on first use, so opening JSON stays cheap
//   reportwright-viewer.full.js  the viewer for the preview webview (the same single-file build as the HTML export)
// Everything comes from this repository's own source (src/, packages/engine/), so the extension always matches the engine.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(here, 'dist');
const href = (...p) => pathToFileURL(path.join(root, ...p)).href;
const quietDynamic = { 'empty-import-meta': 'silent', 'unsupported-dynamic-import': 'silent' };

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning', logOverride: quietDynamic };
await esbuild.build({ ...node, entryPoints: [path.join(here, 'src/extension.ts')], external: ['vscode'], outfile: path.join(dist, 'extension.js') });
await esbuild.build({ ...node, entryPoints: [path.join(here, 'src/engine.ts')], outfile: path.join(dist, 'engine.js') });

// the viewer: scripts/embed-options.mjs is the same option set the embeddable viewer ships with
const { common } = await import(href('scripts/embed-options.mjs'));
await esbuild.build({ ...common, format: 'iife', outfile: path.join(dist, 'reportwright-viewer.full.js') });

// fonts: the four Inter faces (the engine's default family) + the PDF subsetter + the sRGB profile for PDF/A.
// A report in another script or family (Noto, JetBrains Mono) falls back to Inter with the engine's warning.
const pub = path.join(root, 'public');
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
for (const f of ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-Italic.ttf', 'Inter-BoldItalic.ttf', 'OFL-Inter.txt']) fs.copyFileSync(path.join(pub, 'fonts', f), path.join(dist, 'fonts', f));
fs.copyFileSync(path.join(pub, 'harfbuzz-subset.wasm'), path.join(dist, 'harfbuzz-subset.wasm'));
fs.cpSync(path.join(pub, 'icc'), path.join(dist, 'icc'), { recursive: true });

// the report schema (the same one @reportwright/engine publishes) and a snippet from the blank report
const { REPORT_SCHEMA } = await import(href('src/engine/schema/report.schema.js'));
fs.mkdirSync(path.join(dist, 'schemas'), { recursive: true });
fs.writeFileSync(path.join(dist, 'schemas/report.schema.json'), JSON.stringify(REPORT_SCHEMA, null, 2) + '\n');
const { blankReport } = await import(href('src/engine/schema/template.js'));
// "$" and "\" are snippet syntax: escape them so "$schema" is text
const body = JSON.stringify(blankReport(), null, 2).split('\n').map((l) => l.replace(/\\/g, '\\\\').replace(/\$/g, '\\$'));
fs.mkdirSync(path.join(dist, 'snippets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'snippets/report.json'), JSON.stringify({ 'New ReportWright report': { prefix: ['reportwright', 'rw-report'], description: 'A blank ReportWright report (reportwright/report@1)', body } }, null, 2) + '\n');

console.log('extension built into', path.relative(root, dist));
