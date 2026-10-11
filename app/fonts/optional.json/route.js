// GET /fonts/optional.json: the optional CJK and emoji fonts installed here (npm run fonts:cjk). The browser asks only
// for these (src/engine/text/fonts.js, setOptionalFonts), so a server without them answers no font request with a 404.
import { installedOptionalFonts } from '@/server/fonts.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() { return Response.json(installedOptionalFonts(), { headers: { 'cache-control': 'no-cache' } }); }
