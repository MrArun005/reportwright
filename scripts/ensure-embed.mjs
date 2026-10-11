// npm run dev: build public/embed/ once when it is missing, so the viewer's interactive HTML export works in development
// (it inlines public/embed/reportwright-viewer.full.js). After changing viewer code, run "npm run build:embed" again.
import fs from 'node:fs';
import path from 'node:path';
const file = path.join(import.meta.dirname, '..', 'public/embed/reportwright-viewer.full.js');
if (!fs.existsSync(file)) {
  console.log('[reportwright] public/embed is missing: building it once (npm run build:embed) for the interactive HTML export…');
  await import('./build-embed.mjs');
}
