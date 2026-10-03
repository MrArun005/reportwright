// Batch jobs: render one template for many parameter sets, then deliver.
// In-process queue with a small worker pool. Job state lives in data/jobs/<id>/.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { loadTemplate, renderTo, baseUrl as defaultBase } from './renderer.js';
import { serverFetch } from './safeFetch.js';
import { jsonPath } from '@/engine/data/index.js';
import { evalValue } from '@/engine/expr/evaluate.js';

const DATA = path.join(process.cwd(), 'data');
const JOBS = path.join(DATA, 'jobs');
const MAX_ITEMS = 10000;
const CONCURRENCY = Math.max(1, Number(process.env.PW_BATCH_CONCURRENCY) || 2);

const g = globalThis;
g.__pwJobs ||= { jobs: new Map(), queue: [], running: 0 };
const S = g.__pwJobs;

const rid = () => `b_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const save = async (job) => { await fs.mkdir(path.join(JOBS, job.id), { recursive: true }); await fs.writeFile(path.join(JOBS, job.id, 'job.json'), JSON.stringify(publicJob(job), null, 2)); };

export function publicJob(job) {
  const { items, _def, ...rest } = job;
  return { ...rest, total: job.total, done: job.done, failed: job.failed };
}

/** Expand itemsFrom: fetch a list and map each element to parameters. */
async function expandItems(spec, base, fetch) {
  if (Array.isArray(spec.items)) return spec.items;
  if (!spec.itemsFrom?.url) throw Object.assign(new Error('Give "items" or "itemsFrom.url"'), { status: 400 });
  let url = spec.itemsFrom.url;
  if (url.startsWith('/')) url = base + url;
  const res = await fetch(url, { headers: spec.itemsFrom.headers || {} });
  if (!res.ok) throw new Error(`itemsFrom: HTTP ${res.status} from ${url}`);
  let list = jsonPath(await res.json(), spec.itemsFrom.path || '$');
  if (!Array.isArray(list)) list = [list];
  const map = spec.itemsFrom.map || {};
  return list.map((row) => {
    const parameters = {};
    for (const [k, p] of Object.entries(map)) parameters[k] = typeof p === 'string' && p.startsWith('$') ? jsonPath(row, p) : p;
    return { parameters };
  });
}

export async function createBatch(spec, req) {
  // self: this server, the one local address batch fetches may reach; baseUrl may come from the caller
  const self = defaultBase(req);
  const base = spec.baseUrl || self;
  const def = await loadTemplate(spec.template);
  const items = await expandItems(spec, base, serverFetch(self));
  if (!items.length) throw Object.assign(new Error('The batch has no items'), { status: 400 });
  if (items.length > MAX_ITEMS) throw Object.assign(new Error(`A batch can hold at most ${MAX_ITEMS} items`), { status: 400 });
  const format = spec.format || 'pdf';
  const job = {
    id: rid(), status: 'queued', createdAt: new Date().toISOString(), template: typeof spec.template === 'string' ? spec.template : def.name,
    format, output: spec.output || { type: 'zip' }, webhook: spec.webhook || null, fileName: spec.fileName || null, schedule: spec.schedule || null,
    total: items.length, done: 0, failed: 0, results: [], errors: [], base, self, items, _def: def,
  };
  S.jobs.set(job.id, job);
  await save(job);
  S.queue.push(job.id);
  pump();
  return publicJob(job);
}

export async function getJob(id) {
  if (!/^b_[a-z0-9]+$/.test(id)) return null;
  const j = S.jobs.get(id);
  if (j) return publicJob(j);
  try { return JSON.parse(await fs.readFile(path.join(JOBS, id, 'job.json'), 'utf8')); } catch { return null; }
}

export async function listJobs() {
  let names = [];
  try { names = await fs.readdir(JOBS); } catch { return []; }
  const out = [];
  for (const n of names.sort().reverse().slice(0, 50)) { const j = await getJob(n); if (j) out.push(j); }
  return out;
}

export async function jobFile(id) {
  const j = await getJob(id);
  if (!j?.download) return null;
  return { path: path.join(JOBS, id, j.download.file), name: j.download.name, type: j.download.type };
}

function pump() {
  while (S.running < 1 && S.queue.length) {
    const id = S.queue.shift();
    const job = S.jobs.get(id);
    if (!job) continue;
    S.running++;
    run(job).catch(e => { job.status = 'failed'; job.errors.push(e.message); }).finally(async () => { S.running--; await save(job); pump(); });
  }
}

// letters, digits and . _ @ - only, and never a leading dot, so ".." or ".x" cannot name a path outside data/outputs
export const safeName = (s) => String(s || 'report').replace(/[^\w.@-]+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'report';

function itemName(job, item, i) {
  if (item.name) return safeName(item.name);
  if (job.fileName) {
    try { return safeName(evalValue(job.fileName, { params: item.parameters || {}, globals: { ExecutionTime: new Date() }, dataSets: {}, fields: null })); } catch { /* fall through */ }
  }
  const p = Object.values(item.parameters || {}).filter(v => v != null && v !== '').join('-');
  return safeName(p || `item-${i + 1}`);
}

async function run(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  await save(job);
  const dir = path.join(JOBS, job.id);
  const outputs = [];
  let next = 0;
  const worker = async () => {
    while (next < job.items.length) {
      const i = next++;
      const item = job.items[i];
      const name = `${itemName(job, item, i)}.${job.format === 'json' ? 'json' : job.format}`;
      try {
        const r = await renderTo(job._def, { parameters: item.parameters, data: item.data, format: job.format, baseUrl: job.base, self: job.self });
        outputs[i] = { name, bytes: r.bytes, pages: r.model.pages.length };
        if (item.putUrl) {
          const res = await serverFetch(job.self)(item.putUrl, { method: 'PUT', body: r.bytes, headers: { 'content-type': r.contentType } });
          if (!res.ok) throw new Error(`upload: HTTP ${res.status}`);
        }
        job.results.push({ index: i, name, pages: r.model.pages.length, bytes: r.bytes.length });
        job.done++;
      } catch (e) {
        job.failed++;
        job.errors.push(`${name}: ${e.message}`);
      }
      if ((job.done + job.failed) % 25 === 0) await save(job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, job.items.length) }, worker));

  const ok = outputs.filter(Boolean);
  const out = job.output || { type: 'zip' };
  if (ok.length) {
    if (out.type === 'merged' && job.format === 'pdf') {
      const merged = await PDFDocument.create();
      for (const o of ok) { const d = await PDFDocument.load(o.bytes); (await merged.copyPages(d, d.getPageIndices())).forEach(p => merged.addPage(p)); }
      await fs.writeFile(path.join(dir, 'merged.pdf'), await merged.save());
      job.download = { file: 'merged.pdf', name: `${safeName(job.template)}.pdf`, type: 'application/pdf' };
    } else if (out.type === 'folder') {
      const target = path.join(DATA, 'outputs', safeName(out.folder || job.template));
      await fs.mkdir(target, { recursive: true });
      for (const o of ok) await fs.writeFile(path.join(target, o.name), o.bytes);
      job.folder = path.relative(process.cwd(), target);
    } else if (out.type !== 'none') {
      const files = {};
      for (const o of ok) files[o.name] = new Uint8Array(o.bytes);
      await fs.writeFile(path.join(dir, 'output.zip'), zipSync(files, { level: 6 }));
      job.download = { file: 'output.zip', name: `${safeName(job.template)}.zip`, type: 'application/zip' };
    }
  }
  job.status = job.failed && !job.done ? 'failed' : job.failed ? 'completed_with_errors' : 'completed';
  job.finishedAt = new Date().toISOString();
  job.items = [];
  delete job._def;
  await save(job);
  if (job.webhook) await notify(job);
}

/** POST the job summary to the webhook, signed with HMAC-SHA256 of the body (PW_WEBHOOK_SECRET). */
async function notify(job) {
  const body = JSON.stringify({ event: 'batch.finished', job: publicJob(job), downloadUrl: job.download ? `${job.base}/api/v1/batches/${job.id}/download` : null });
  const headers = { 'content-type': 'application/json', 'user-agent': 'Pagewright' };
  if (process.env.PW_WEBHOOK_SECRET) headers['x-pagewright-signature'] = 'sha256=' + crypto.createHmac('sha256', process.env.PW_WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const res = await serverFetch(job.self)(job.webhook, { method: 'POST', headers, body });
    job.webhookStatus = res.status;
  } catch (e) { job.webhookStatus = `error: ${e.message}`; }
  await save(job);
}
