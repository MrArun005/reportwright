// Server-side render: the same engine, running in Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readReport, safeId } from '@/server/reports.js';
import { render, FontStore } from '@/engine/index.js';
import { exportPdf } from '@/exporters/pdf.js';

export const runtime = 'nodejs';

let store;
const fonts = () => (store ||= new FontStore((k) => fs.readFile(path.join(process.cwd(), 'public', 'fonts', `${k}.ttf`))));

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const def = await readReport(safeId(id));
    if (!def) return Response.json({ error: 'Report not found' }, { status: 404 });
    const url = new URL(req.url);
    const parameters = Object.fromEntries(url.searchParams.entries());
    const model = await render(def, { parameters, fontStore: fonts(), baseUrl: url.origin });
    const bytes = await exportPdf(model, fonts(), { title: def.name });
    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${id}.pdf"`,
        'x-pagewright-pages': String(model.pages.length),
        'x-pagewright-ms': String(model.stats.ms),
      },
    });
  } catch (e) {
    return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.missingParameters ? 400 : 500 });
  }
}
