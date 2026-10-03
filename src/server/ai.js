// Draft a report from a description with Claude (official Anthropic SDK). The answer must pass
// validate() and a trial render on the sample data; any problems go back to the model, 3 tries in all.
// Nothing is saved here: the designer reviews the draft, then saves it like any report.
import Anthropic from '@anthropic-ai/sdk';
import { validate, SCHEMA_ID } from '@/engine/schema/validate.js';
import { render } from '@/engine/index.js';
import { ITEMS } from '@/engine/items/index.js';
import { FUNCTION_NAMES } from '@/engine/expr/evaluate.js';
import { blankReport } from '@/engine/schema/template.js';

const TRIES = 3;
const MAX_PROMPT = 4000;
const MAX_SAMPLE_JSON = 64 * 1024;
const fail = (message, status) => Object.assign(new Error(message), { status });
const model = () => process.env.PW_AI_MODEL || 'claude-opus-5';

/** The report format, built from the live item registry so it always matches the engine. */
export function systemPrompt() {
  const items = Object.values(ITEMS).map((s) => {
    const props = (s.props || []).map(p => `${p.key} (${p.type}${p.options ? `: ${p.options.join('|')}` : ''})`).join(', ');
    return `- "${s.type}" (${s.label}). Defaults: ${JSON.stringify(s.defaults?.() ?? {})}. Properties: ${props}`;
  }).join('\n');
  return `You write report definitions for Pagewright, a report engine. Reply with one JSON object, the whole definition, in a \`\`\`json block.

Format ("${SCHEMA_ID}"):
- page: { size: "A4" | "A5" | "A3" | "Letter" | "Legal" | "Pageless", orientation: "portrait" | "landscape", margins: [top, right, bottom, left] }. Units are points; A4 is 595 × 842. Pageless pages grow to fit and take a width.
- parameters: [{ name, type: "string" | "number" | "date" | "boolean", default, required, multi, options }]
- dataSources: [{ name, type: "json", data } | { name, type: "rest", url } | { name, type: "csv", data }]
- dataSets: [{ name, source, path (JSONPath, e.g. "$.rows"), fields?: [{ name, type, expr? }], filters?: [{ expr, op, value }], sort?: [{ by, dir }] }]
- sections: { pageHeader: { height, items }, body: { items }, pageFooter: { height, items } }
- Every item has type, a unique name, and x, y, w, h in points relative to its section. The body is the page width minus the margins.
- A value is a literal, "=expression", or text with {expression} parts. Expressions use Fields.x, Parameters.x, Globals.PageNumber and Globals.TotalPages (page header and footer only), Globals.ExecutionTime; operators + - * / & (joins text) = <> < > <= >= and or not, a ? b : c; functions ${FUNCTION_NAMES.join(', ')}. Aggregates may name a scope: Sum(Fields.x, "GroupName").
- Number formats: N0, N2, C2 (currency), P1, or patterns like "#,##0.00". Dates: "dd MMM yyyy".
- Tables: columns [{ width }]; header, detail and footer rows [{ height, cells: [{ value, style }] }]; groups [{ name, expr, header, footer }].
- Styles: { fontSize, fontWeight, color, backgroundColor, textAlign, format, border, borderBottom, padding }.

Item types:
${items}

Use only these item types and properties, and the data's real field names. Keep every item inside the page. Give the report a clear title, readable column widths, number formats, and a page footer with "Page {Globals.PageNumber} of {Globals.TotalPages}".

A minimal valid report:
${JSON.stringify(blankReport('Example'))}`;
}

/**
 * @param {{ prompt: string, sample?: any, url?: string, base?: object }} input
 *   sample: rows (or the JSON a URL returns); url: where the real data will come from; base: a report to change
 * @param {{ client: any, fontStore: any, fetch?: Function }} deps
 */
export async function draftReport(input, { client, fontStore, fetch }) {
  const { prompt, sample, url, base } = input || {};
  if (typeof prompt !== 'string' || !prompt.trim()) throw fail('Describe the report you want.', 400);
  if (prompt.length > MAX_PROMPT) throw fail(`The description can be at most ${MAX_PROMPT} characters.`, 400);
  if (sample != null && typeof sample !== 'object') throw fail('"sample" must be rows of data (a JSON array or object).', 400);
  if (url != null && !/^https?:\/\//i.test(String(url))) throw fail('"url" must be an http or https URL.', 400);
  const rows = Array.isArray(sample) ? sample.slice(0, 50) : sample;
  const rowsJson = rows == null ? null : JSON.stringify(rows);
  if (rowsJson && rowsJson.length > MAX_SAMPLE_JSON) throw fail('The sample data is too large: send up to 50 rows.', 400);

  const parts = [`What the report should show:\n${prompt.trim()}`];
  if (rowsJson) parts.push(url
    ? `The data source is a rest source named "data" with url "${url}". It returns this (first rows):\n${rowsJson}`
    : `The data, to embed as a json data source named "data" with data { "rows": [...] } and a data set path "$.rows" (first rows):\n${rowsJson}`);
  else parts.push('There is no data yet: add a json data source named "data" with { "rows": [...] } holding a few realistic sample rows.');
  if (base) parts.push(`Change this existing report, and keep what the description does not mention:\n${JSON.stringify(base)}`);
  const messages = [{ role: 'user', content: parts.join('\n\n') }];

  let problems = [];
  for (let t = 1; t <= TRIES; t++) {
    const msg = await ask(client, messages);
    if (msg.stop_reason === 'refusal') throw fail('Claude declined this request. Try describing the report differently.', 422);
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const res = await check(text, { rows, url, fontStore, fetch });
    if (!res.errors.length) return { definition: res.definition, warnings: res.warnings, tries: t };
    problems = res.errors;
    // send the whole answer back unchanged (thinking blocks included), then the problems
    messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: `The report has problems. Fix them and send the whole definition again:\n- ${problems.join('\n- ')}` });
  }
  throw fail(`No valid report after ${TRIES} tries. Last problems: ${problems.slice(0, 5).join('; ')}`, 422);
}

async function ask(client, messages) {
  try {
    return await client.beta.messages.stream({
      model: model(),
      max_tokens: 64000,
      // if the model declines on a safety category, the API retries on a fallback model in the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages,
    }).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw fail('The Anthropic API refused the key. Check ANTHROPIC_API_KEY.', 502);
    if (e instanceof Anthropic.RateLimitError) throw fail('The Anthropic API is busy (rate limit). Try again in a minute.', 429);
    if (e instanceof Anthropic.APIConnectionError) throw fail('Could not reach the Anthropic API.', 502);
    if (e instanceof Anthropic.APIError) throw fail(`The Anthropic API returned an error: ${e.message}`, 502);
    throw e;
  }
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return JSON.parse(fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

const SAMPLE_VALUE = { string: 'x', number: 1, boolean: false };

/** Parse, validate and trial-render one answer. A trial render never fetches anything. */
async function check(text, { rows, url, fontStore, fetch }) {
  let def;
  try { def = extractJson(text); } catch { return { errors: ['The answer was not one JSON object in a ```json block.'] }; }
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { errors: ['The answer was not one JSON object.'] };
  def.$schema = SCHEMA_ID;
  // the real sample, not a copy the model may have shortened or invented
  const src = (def.dataSources || []).find(s => s && s.name === 'data');
  if (rows != null && src && !url) { src.type = 'json'; src.data = Array.isArray(rows) ? { rows } : rows; delete src.url; }

  const v = validate(def);
  if (v.errors.length) return { errors: v.errors };
  const noFetch = () => { throw new Error('a trial render cannot load data: put the rows in the json data source "data"'); };
  const sources = url ? Object.fromEntries((def.dataSources || []).map(s => [s.name, s.type === 'json' ? s.data : s.name === 'data' ? rows ?? [] : []])) : undefined;
  const parameters = Object.fromEntries((def.parameters || []).map(p => [p.name, p.type === 'date' ? new Date().toISOString().slice(0, 10) : SAMPLE_VALUE[p.type] ?? 'x']));
  try {
    const out = await render(def, { fontStore, sources, parameters, fetch: fetch || noFetch });
    return { definition: def, warnings: [...v.warnings, ...out.warnings], errors: [] };
  } catch (e) {
    return { errors: [`The trial render failed: ${e.message}`] };
  }
}
