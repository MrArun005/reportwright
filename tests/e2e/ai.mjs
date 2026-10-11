// AI drafting end to end (ROADMAP week 11), against a local mock of the Anthropic Messages API (streaming),
// so the real SDK, our checks and the UI all run without a live call. Start the server like this:
//   PW_BASIC_AUTH=admin:pw ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4199 npx next start -p 3200
// then: BASE=http://localhost:3200 BASIC=admin:pw node tests/e2e/ai.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
const BASE = process.env.BASE || 'http://localhost:3000';
const [user, pass] = (process.env.BASIC || 'admin:pw').split(':');
const AUTH = { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
const step = (s) => console.log('·', s);

const drafted = {
  $schema: 'reportwright/report@1', name: 'Sales by city', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'data', type: 'json', data: { rows: [] } }], dataSets: [{ name: 'Rows', source: 'data', path: '$.rows' }],
  sections: { pageHeader: { height: 30, items: [{ type: 'textbox', name: 'Title', x: 0, y: 0, w: 300, h: 20, value: 'Sales by city' }] },
    body: { items: [{ type: 'table', name: 'Cities', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 150 }, { width: 150 }],
      header: [{ height: 18, cells: [{ value: 'City' }, { value: 'Sales' }] }], detail: [{ height: 16, cells: [{ value: '=Fields.city' }, { value: '=Fields.sales' }] }] }] },
    pageFooter: { height: 20, items: [] } },
};
// the mock: answer every request with a definition; a request that changes a report gets that report plus a new text box
const requests = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const r = JSON.parse(body);
    requests.push(r);
    const user = r.messages[0].content;
    let def = drafted;
    const m = /Change this existing report[^\n]*\n(\{[\s\S]*?\})\n\n/.exec(user + '\n\n');
    if (m) { def = JSON.parse(m[1]); def.sections.body.items.push({ type: 'textbox', name: 'AiNote', x: 0, y: 300, w: 300, h: 16, value: 'Added by AI' }); }
    const text = '```json\n' + JSON.stringify(def) + '\n```';
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: r.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
      + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
      + ev('content_block_stop', { index: 0 })
      + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 100 } })
      + ev('message_stop', {}),
    );
  });
}).listen(4199, '127.0.0.1');

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, httpCredentials: { username: user, password: pass } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const made = [];

step('home page: describe a report → saved → designer');
await p.goto(BASE);
await p.getByRole('button', { name: 'Describe a report (AI)' }).click();
await p.getByLabel('What should the report show?').fill('A table of sales by city');
await p.getByLabel(/Sample rows as JSON/).fill('[{"city":"Pune","sales":10},{"city":"Delhi","sales":20}]');
await p.getByRole('button', { name: 'Draft the report' }).click();
await p.waitForURL(/\/designer\//, { timeout: 60000 });
const id = p.url().split('/designer/')[1];
made.push(id);
const saved = await (await fetch(`${BASE}/api/reports/${id}`, { headers: AUTH })).json();
assert.equal(saved.name, 'Sales by city');
assert.deepEqual(saved.dataSources[0].data.rows, [{ city: 'Pune', sales: 10 }, { city: 'Delhi', sales: 20 }], 'the real sample rows, not the model\'s');
assert.equal(requests[0].model, 'claude-opus-5');
assert.equal(requests[0].stream, true);
assert.equal(requests[0].fallbacks, 'default');

step('designer: Ask AI → what changes + preview → apply → undo');
await p.waitForSelector('[data-testid=paper]');
await p.getByRole('button', { name: 'Ask AI' }).click();
const dlg = p.getByRole('dialog');
await dlg.getByLabel(/Describe the change/).fill('Add a note under the table');
await dlg.getByRole('button', { name: 'Draft the change' }).click();
await dlg.getByText('Added: AiNote').waitFor({ timeout: 60000 });
const preview = await dlg.locator('.cw-paper text').allTextContents();
assert.ok(preview.includes('Added by AI') && preview.includes('Pune'), 'preview shows the change with the data');
await dlg.getByTestId('ai-apply').click();
await p.locator('[data-item=AiNote]').waitFor();
await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await p.locator('[data-item=AiNote]').waitFor({ state: 'detached' });

await b.close();
mock.close();
for (const rid of made) await fetch(`${BASE}/api/reports/${rid}`, { method: 'DELETE', headers: { ...AUTH, origin: BASE } });
assert.deepEqual(errs, []);
console.log(`PASS ai (${requests.length} calls to the mock API)`);
