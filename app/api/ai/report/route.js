// POST /api/ai/report { prompt, sample?, url?, base?: id | definition?: object, sources? } → { definition, warnings, tries }
// Drafts a report with Claude. Nothing is saved: POST /api/reports with the definition saves it.
// Designer role when accounts are on (proxy.js). Needs ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { draftReport } from '@/server/ai.js';
import { fontStore } from '@/server/renderer.js';
import { safeId } from '@/server/reports.js';
import { principalOf, readReportFor } from '@/server/perms.js';

export const runtime = 'nodejs';
export const maxDuration = 300; // a draft with retries can take minutes

const MAX_BODY = 1024 * 1024; // the designer sends the report and a trimmed copy of its data
const err = (error, status) => Response.json({ error }, { status });
let client;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return err('AI drafting is off: set ANTHROPIC_API_KEY on the server.', 501);
  // every draft costs money: in production, only people who signed in may ask for one
  if (process.env.NODE_ENV === 'production' && process.env.PW_AUTH !== 'users' && !process.env.PW_BASIC_AUTH) {
    return err('Turn on accounts (PW_AUTH=users) or PW_BASIC_AUTH to use AI drafting in production.', 403);
  }
  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return err('The request is larger than 1 MB.', 413);
    body = JSON.parse(text);
  } catch { return err('Send JSON: { prompt, sample?, url?, base? }', 400); }
  try {
    // the report to change: unsaved from the designer (definition), or a saved one (base id)
    const base = body.definition ?? (body.base ? await readReportFor(await principalOf(req), safeId(String(body.base)), 'view') : null);
    client ||= new Anthropic(); // reads ANTHROPIC_API_KEY
    return Response.json(await draftReport({ prompt: body.prompt, sample: body.sample, url: body.url, base, sources: body.sources }, { client, fontStore: fontStore() }));
  } catch (e) {
    return err(e.message, e.status || 500);
  }
}
