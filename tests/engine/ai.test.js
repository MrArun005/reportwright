// AI report drafting (C3). A fake Claude client; no test calls the real API.
import { describe, it, expect } from 'vitest';
import { draftReport, systemPrompt } from '../../src/server/ai.js';
import { fontStore } from '../helpers.js';

const good = {
  $schema: 'pagewright/report@1', name: 'Sales by city', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'data', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'data', path: '$.rows' }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 150 }, { width: 150 }],
    header: [{ height: 18, cells: [{ value: 'City' }, { value: 'Sales' }] }], detail: [{ height: 16, cells: [{ value: '=Fields.city' }, { value: '=Fields.sales' }] }] }] } },
};
const sample = [{ city: 'Pune', sales: 10 }, { city: 'Delhi', sales: 20 }];

/** A client whose replies come from a list; it records every request. */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (req) => { calls.push(req); const r = replies[Math.min(calls.length - 1, replies.length - 1)]; return { finalMessage: async () => (typeof r === 'function' ? r() : r) }; } } },
  };
}
const answer = (text, stop_reason = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason, stop_details: null });

describe('AI report drafting', () => {
  it('returns a report that validates and renders, with the sample data inline', async () => {
    const client = fakeClient([answer('Here it is:\n```json\n' + JSON.stringify(good) + '\n```')]);
    const out = await draftReport({ prompt: 'A table of sales by city', sample }, { client, fontStore });
    expect(out.definition.name).toBe('Sales by city');
    expect(out.definition.dataSources[0].data.rows).toEqual(sample); // the real sample replaces whatever the model wrote
    expect(out.tries).toBe(1);
    const req = client.calls[0];
    expect(req.model).toBe('claude-opus-5');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.fallbacks).toBe('default');
    expect(JSON.stringify(req.messages)).toContain('Pune');
    expect(JSON.stringify(req.messages)).toContain('A table of sales by city');
  });

  it('the system prompt lists every item type the engine has', () => {
    const s = systemPrompt();
    for (const t of ['textbox', 'table', 'chart', 'matrix', 'map', 'field', 'barcode']) expect(s).toContain(`"${t}"`);
    expect(s).toContain('Fields.');
  });

  it('sends errors back and accepts the fixed answer', async () => {
    const broken = { ...good, sections: {} };
    const client = fakeClient([answer(JSON.stringify(broken)), answer(JSON.stringify(good))]);
    const out = await draftReport({ prompt: 'x', sample }, { client, fontStore });
    expect(out.tries).toBe(2);
    expect(JSON.stringify(client.calls[1].messages)).toMatch(/no body section/);
  });

  it('gives up after three tries with the last problems', async () => {
    const client = fakeClient([answer('not json at all')]);
    await expect(draftReport({ prompt: 'x', sample }, { client, fontStore })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/JSON/) });
    expect(client.calls).toHaveLength(3);
  });

  it('reports a refusal plainly', async () => {
    const client = fakeClient([answer('', 'refusal')]);
    await expect(draftReport({ prompt: 'x', sample }, { client, fontStore })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/declined/) });
  });

  it('checks its input', async () => {
    const client = fakeClient([answer(JSON.stringify(good))]);
    await expect(draftReport({ prompt: '' }, { client, fontStore })).rejects.toMatchObject({ status: 400 });
    await expect(draftReport({ prompt: 'x'.repeat(4001) }, { client, fontStore })).rejects.toMatchObject({ status: 400 });
    await expect(draftReport({ prompt: 'x', sample: 'rows' }, { client, fontStore })).rejects.toMatchObject({ status: 400 });
  });

  it('a URL source keeps the URL, and the trial render uses the sample instead of fetching', async () => {
    const withUrl = { ...good, dataSources: [{ name: 'data', type: 'rest', url: 'https://api.example.com/sales' }], dataSets: [{ name: 'Rows', source: 'data', path: '$' }] };
    const client = fakeClient([answer(JSON.stringify(withUrl))]);
    const out = await draftReport({ prompt: 'x', sample, url: 'https://api.example.com/sales' }, { client, fontStore, fetch: () => { throw new Error('no fetch in a trial render'); } });
    expect(out.definition.dataSources[0]).toMatchObject({ type: 'rest', url: 'https://api.example.com/sales' });
  });
});

describe('AI route', () => {
  const post = async (body, env = {}) => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try {
      const { POST } = await import('../../app/api/ai/report/route.js');
      return await POST(new Request('http://x/api/ai/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
  };
  it('is off without an API key', async () => {
    const res = await post({ prompt: 'x' }, { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' });
    expect(res.status).toBe(501);
  });
  it('is refused in production when nobody has to sign in', async () => {
    const res = await post({ prompt: 'x' }, { ANTHROPIC_API_KEY: 'k', NODE_ENV: 'production', PW_AUTH: '', PW_BASIC_AUTH: '' });
    expect(res.status).toBe(403);
  });
});
