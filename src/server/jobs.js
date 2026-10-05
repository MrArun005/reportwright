// Batch jobs: render one template for many parameter sets, then deliver.
// The queue is the job records in storage (src/server/storage): any server can run a queued job. A server takes a job
// with a lease (renewed while it works); if it dies, the lease runs out and another server goes on from the last
// finished item, because every rendered item is written as it is made. Items and the output (zip, merged PDF) are
// blobs (src/server/blobs.js): in the configured storage or S3, so every server reads what any server wrote. Only the
// "folder" output writes into a local folder (data/outputs/), by design: it is for a server with a shared volume.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { loadTemplate, baseUrl as defaultBase } from './renderer.js';
import { renderInPool } from './pool.js';
import { serverFetch, checkTarget } from './safeFetch.js';
import { jsonPath } from '@/engine/data/index.js';
import { evalValue } from '@/engine/expr/evaluate.js';
import { store } from './storage/index.js';
import { blobs, removePrefix } from './blobs.js';
import { mailOn, checkRecipients, oneLine, sendMail, maxAttachmentBytes } from './mail.js';
import { audit } from './audit.js';
import { throughSnapshot } from './snapshots.js';
import { principalId, principalFromId, defaultPrincipal, vet, canDesign } from './perms.js';

const DATA = path.join(process.cwd(), 'data');
const JOBS = path.join(DATA, 'jobs');
const MAX_ITEMS = 10000;
const CONCURRENCY = Math.max(1, Number(process.env.PW_BATCH_CONCURRENCY) || 2);

/** This server, as a lease owner. */
export const ME = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const leaseMs = () => Number(process.env.PW_JOB_LEASE_MS) || 60000;

const g = globalThis;
g.__pwQueue ||= { started: false, busy: false, timer: null };
const Q = g.__pwQueue;

const rid = () => `b_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
// the record holds the job's inputs (_work: items and template) until it finishes, so any server can run it
const save = (job) => store().put('jobs', job.id, JSON.stringify(job, null, 2));

export function publicJob(job) {
  const { items, _def, _work, owner, ownerKey, ...rest } = job;
  return { ...rest, total: job.total, done: job.done, failed: job.failed };
}

/**
 * The URLs a batch or schedule will call later (webhook, uploads, the item list), checked when they are saved. Only a
 * designer (or a service key) may aim them at PW_INTERNAL_HOSTS: a viewer's key reaches public hosts only.
 * @param {any} spec @param {import('./perms.js').Principal} [p]
 */
export async function checkDelivery(spec, p = defaultPrincipal()) {
  const internal = canDesign(p);
  if (spec.webhook != null) await checkTarget(spec.webhook, '"webhook"', { internal });
  if (spec.email != null) checkEmail(spec.email);
  if (spec.itemsFrom?.url != null) await checkTarget(spec.itemsFrom.url, '"itemsFrom.url"', { relative: true, internal });
  for (const it of Array.isArray(spec.items) ? spec.items : []) if (it?.putUrl != null) await checkTarget(it.putUrl, '"putUrl"', { internal });
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

/**
 * @param {any} spec @param {Request} [req]
 * @param {import('./perms.js').Principal} [principal] who asks: the template and its subreports are checked for them,
 *   now and again when the items render (a schedule's owner may have lost access since)
 */
export async function createBatch(spec, req, principal = defaultPrincipal(), { session = false, since = null } = {}) {
  // self: this server, the one local address batch fetches may reach; baseUrl may come from the caller
  const self = defaultBase(req);
  const designer = canDesign(principal);
  const base = (designer && spec.baseUrl) || self; // a viewer's key cannot send the report's relative URLs elsewhere
  const def = await loadTemplate(spec.template, principal);
  await checkDelivery(spec, principal);
  const items = await expandItems(spec, base, serverFetch(self, { internal: designer }));
  if (!items.length) throw Object.assign(new Error('The batch has no items'), { status: 400 });
  if (!canDesign(principal) && items.some(i => i?.data)) throw Object.assign(new Error('Only a designer can send data for a render. Render the report with its own data.'), { status: 403 });
  if (items.length > MAX_ITEMS) throw Object.assign(new Error(`A batch can hold at most ${MAX_ITEMS} items`), { status: 400 });
  const format = spec.format || 'pdf';
  const job = {
    id: rid(), status: 'queued', createdAt: new Date().toISOString(), template: typeof spec.template === 'string' ? spec.template : def.name,
    templateRef: typeof spec.template === 'string' ? spec.template : null,
    format, fromSnapshot: !!spec.fromSnapshot, output: spec.output || { type: 'zip' }, webhook: spec.webhook || null, fileName: spec.fileName || null, schedule: spec.schedule || null, pdfa: !!spec.pdfa, sign: !!spec.sign,
    total: items.length, done: 0, failed: 0, results: [], errors: [], failedItems: [], base, self, owner: principalId(principal), ownerKey: vet(principal).viaKey || null, ownerSession: !!session, ownerSince: since, email: spec.email ? checkEmail(spec.email) : null, _work: { items, def },
  };
  await save(job);
  poke();
  return publicJob(job);
}

/** A user's key sees its own jobs only; service keys (and accounts off) see all. */
const mine = (p, job) => { p = vet(p); return p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && !!job.owner && job.owner === principalId(p) && (job.ownerKey || null) === (p.viaKey || null)); }; // per key, as schedules

/** @param {string} id @param {import('./perms.js').Principal} [p] */
export async function getJob(id, p = defaultPrincipal()) {
  if (!/^b_[a-z0-9]+$/.test(id)) return null;
  try {
    const t = await store().get('jobs', id);
    const j = t ? JSON.parse(t) : null;
    return j && mine(p, j) ? publicJob(j) : null;
  } catch { return null; }
}

/** @param {import('./perms.js').Principal} [p] */
export async function listJobs(p = defaultPrincipal()) {
  let names = [];
  try { names = await store().ids('jobs'); } catch { return []; }
  const out = [];
  // ponytail: a scoped key reads up to 500 records to find its 50; an owner index if that gets slow
  for (const n of names.sort().reverse().slice(0, p.kind === 'user' ? 500 : 50)) { const j = await getJob(n, p); if (j) out.push(j); if (out.length >= 50) break; }
  return out;
}

/* ---------------- download links (for email) ---------------- */

/** The secret that signs download links: PW_LINK_SECRET, else PW_SESSION_SECRET (32+ characters), else none. */
const linkSecret = () => [process.env.PW_LINK_SECRET, process.env.PW_SESSION_SECRET].find(s => s && s.length >= 32) || null;
const linkSig = (id, exp) => crypto.createHmac('sha256', String(linkSecret())).update(`pw-batch-download.${id}.${exp}`).digest('base64url');
export const linkDays = () => (Number(process.env.PW_MAIL_LINK_DAYS) > 0 ? Math.min(90, Number(process.env.PW_MAIL_LINK_DAYS)) : 7);
/**
 * A link that downloads a finished batch's output without an API key, until it expires (PW_MAIL_LINK_DAYS, default 7):
 * whoever holds it can download, as with an attachment. null without a signing secret or PW_BASE_URL.
 * @param {any} job
 */
export function downloadLink(job) {
  if (!linkSecret() || !process.env.PW_BASE_URL) return null;
  const exp = Math.floor(Date.now() / 1000) + linkDays() * 86400;
  return `${process.env.PW_BASE_URL.replace(/\/$/, '')}/api/v1/batches/${job.id}/download?exp=${exp}&sig=${linkSig(job.id, exp)}`;
}
/**
 * A link's batch, when its owner may still run its report now (as the run itself checks before every item): a link
 * stops when the owner is disabled, demoted past it or loses access, or the report goes. { job } or null.
 * @param {string} id
 */
export async function linkJob(id) {
  const t = await store().get('jobs', id);
  const job = t ? JSON.parse(t) : null;
  if (!job?.download) return null;
  try {
    const p = job.owner ? await principalFromId(job.owner, job.ownerKey, { session: !!job.ownerSession, since: job.ownerSince || null, madeAt: job.createdAt }) : defaultPrincipal();
    if (job.templateRef) await loadTemplate(job.templateRef, p); else if (!canDesign(p)) return null;
  } catch { return null; }
  return job;
}
/** True for a link downloadLink made for this job that has not expired. @param {string} id @param {string|null} exp @param {string|null} sig */
export function linkOk(id, exp, sig) {
  if (!linkSecret() || !/^\d{1,12}$/.test(String(exp)) || typeof sig !== 'string' || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(linkSig(id, exp)), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/**
 * The finished output of a job the principal may see: { bytes, name, type }, or null.
 * @param {string} id @param {import('./perms.js').Principal} [p]
 */
export async function jobFile(id, p) {
  const j = await getJob(id, p);
  if (!j?.download) return null;
  // jobs from before blobs kept their output under data/jobs/<id>/
  const bytes = j.download.blob ? await blobs().get(j.download.blob) : await fs.readFile(path.join(JOBS, id, j.download.file)).catch(() => null);
  return bytes ? { bytes, name: j.download.name, type: j.download.type } : null;
}

/**
 * Take one unfinished job this server may run (queued, or running with a lease that ran out) and run it.
 * @param {string} owner lease owner (this server: ME)
 * @param {{ stopAfter?: number }} [opt] stopAfter: stop after that many items, holding the lease (tests: a server that dies)
 * @returns {Promise<{ id: string, stopped: boolean } | null>} null when there was nothing to run
 */
export async function workOnce(owner, { stopAfter } = {}) {
  // ponytail: reads every job record per poll; an index of open jobs when there are many thousands of them
  const open = [];
  for (const r of await store().list('jobs')) {
    try { const j = JSON.parse(r.text); if ((j.status === 'queued' || j.status === 'running') && j._work) open.push(j); } catch { /* skip */ }
  }
  open.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const cand of open) {
    const name = `job:${cand.id}`;
    if (!(await store().lease(name, owner, leaseMs()))) continue;
    const text = await store().get('jobs', cand.id); // read again: it may have finished meanwhile
    const job = text ? JSON.parse(text) : null;
    if (!job?._work || (job.status !== 'queued' && job.status !== 'running')) { await store().release(name, owner); continue; }
    let stopped = false;
    const beat = setInterval(() => { store().lease(name, owner, leaseMs()).catch(() => {}); }, Math.max(50, leaseMs() / 3));
    try { stopped = await run(job, owner, stopAfter); }
    catch (e) { job.status = 'failed'; job.errors.push(e.message); delete job._work; await save(job); }
    finally { clearInterval(beat); }
    if (!stopped) await store().release(name, owner);
    return { id: job.id, stopped };
  }
  return null;
}

/** Run queued jobs on this server: now (poke) and every PW_QUEUE_POLL_MS (2 s), for jobs other servers left. */
function poke() {
  if (!Q.started || Q.busy) return;
  Q.busy = true;
  (async () => { try { while (await workOnce(ME)); } catch (e) { console.error(`[pagewright] batch queue: ${e.message}`); } finally { Q.busy = false; } })();
}
export function startWorker() {
  if (Q.started) return;
  Q.started = true;
  Q.timer = setInterval(poke, Number(process.env.PW_QUEUE_POLL_MS) || 2000);
  Q.timer.unref?.();
  poke();
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

async function run(job, owner, stopAfter) {
  const { items, def } = job._work;
  // the owner as they are now: a user who lost access, or was disabled, gets no further items
  // as the owner is now: the template must still be theirs to view; an inline definition needs a designer or a service.
  // Checked at the start (throws: the job fails, workOnce) and again before every item.
  const allowed = async () => {
    const p = job.owner ? await principalFromId(job.owner, job.ownerKey, { session: !!job.ownerSession, since: job.ownerSince || null, madeAt: job.createdAt }) : defaultPrincipal(); // no owner: no one's
    await loadTemplate(job.templateRef || def, p);
    return p;
  };
  await allowed();
  let ended = null; // why the owner may no longer run this batch
  job.status = 'running';
  job.startedAt ||= new Date().toISOString();
  job.failedItems ||= [];
  await save(job);
  const itemKey = (i) => `jobs/${job.id}/items/${i}`; // blobs: any server can go on from another's items
  // go on where the last server stopped: items with a result (or a failure) are done
  const finished = new Set([...job.results.map(r => r.index), ...job.failedItems]);
  const todo = items.map((_, i) => i).filter(i => !finished.has(i));
  let taken = 0;
  let saving = Promise.resolve();
  const saveSoon = () => { saving = saving.then(() => save(job)); return saving; }; // one write at a time
  const worker = async () => {
    while (todo.length) {
      if (stopAfter != null && taken >= stopAfter) return;
      taken++;
      const i = /** @type {number} */ (todo.shift());
      const item = items[i];
      const name = `${itemName(job, item, i)}.${job.format === 'json' ? 'json' : job.format}`;
      try {
        if (ended) throw ended;
        const principal = await allowed().catch((e) => { throw (ended = new Error(`The owner may no longer run this report (${e.message}).`)); });
        // in the render pool, behind interactive renders (allowed() checked the template as the owner is now)
        const opt = { parameters: item.parameters, data: item.data, format: job.format, baseUrl: job.base, self: job.self, pdfa: job.pdfa, sign: job.sign, principal };
        const render = () => renderInPool({ def, opt }, { background: true });
        // fromSnapshot (schedules): a fresh snapshot of the same report, parameters and access, within the TTL setting
        const r = job.fromSnapshot ? await throughSnapshot({ def, opt, principal }, render) : await render();
        if (item.putUrl) {
          const res = await serverFetch(job.self, { internal: canDesign(principal) })(item.putUrl, { method: 'PUT', body: r.bytes, headers: { 'content-type': r.contentType } });
          if (!res.ok) throw new Error(`upload: HTTP ${res.status}`);
        }
        await blobs().put(itemKey(i), r.bytes);
        job.results.push({ index: i, name, pages: r.pages, bytes: r.bytes.length, by: owner });
        job.done++;
      } catch (e) {
        job.failed++;
        job.failedItems.push(i);
        job.errors.push(`${name}: ${e.message}`);
      }
      await saveSoon(); // after every item: another server must see exactly what is done
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  await saving;
  if (todo.length) return true; // stopped early (tests): the lease is kept, the job stays running

  const ok = [...job.results].sort((a, b) => a.index - b.index);
  const bytesOf = async (r) => { const b = await blobs().get(itemKey(r.index)); if (!b) throw new Error(`item ${r.index} of the batch is gone from storage`); return b; };
  const out = job.output || { type: 'zip' };
  if (ok.length) {
    if (out.type === 'merged' && job.format === 'pdf') {
      const merged = await PDFDocument.create();
      for (const r of ok) { const d = await PDFDocument.load(await bytesOf(r)); (await merged.copyPages(d, d.getPageIndices())).forEach(p => merged.addPage(p)); }
      await blobs().put(`jobs/${job.id}/merged.pdf`, await merged.save());
      job.download = { blob: `jobs/${job.id}/merged.pdf`, name: `${safeName(job.template)}.pdf`, type: 'application/pdf' };
    } else if (out.type === 'folder') {
      // a user's batches write under their own folder: only service keys (and accounts off) write the shared ones
      const own = String(job.owner || '').startsWith('user:') ? ['users', crypto.createHash('sha256').update(job.owner).digest('hex').slice(0, 16)] : [];
      const target = path.join(DATA, 'outputs', ...own, safeName(out.folder || job.template));
      await fs.mkdir(target, { recursive: true });
      for (const r of ok) await fs.writeFile(path.join(target, r.name), await bytesOf(r));
      job.folder = path.relative(process.cwd(), target);
    } else if (out.type !== 'none') {
      const files = {};
      for (const r of ok) files[r.name] = new Uint8Array(await bytesOf(r));
      await blobs().put(`jobs/${job.id}/output.zip`, zipSync(files, { level: 6 }));
      job.download = { blob: `jobs/${job.id}/output.zip`, name: `${safeName(job.template)}.zip`, type: 'application/zip' };
    }
  }
  if (job.email && ok.length) job.mail = await deliver(job, ok, bytesOf);
  await removePrefix(`jobs/${job.id}/items/`);
  job.status = job.failed && !job.done ? 'failed' : job.failed ? 'completed_with_errors' : 'completed';
  job.finishedAt = new Date().toISOString();
  delete job._work;
  await save(job);
  if (job.webhook) await notify(job);
  return false;
}

/* ---------------- email delivery ---------------- */

/**
 * A delivery spec, checked: { to: [addresses in PW_MAIL_ALLOWED_DOMAINS], subject?, body?, attach (default true) }.
 * @param {any} e
 */
export function checkEmail(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw Object.assign(new Error('"email" is { to, subject?, body?, attach? }'), { status: 400 });
  if (!mailOn()) throw Object.assign(new Error('Email is not set up on this server (PW_SMTP_URL, PW_MAIL_FROM).'), { status: 400 });
  return {
    to: checkRecipients(e.to),
    subject: e.subject == null ? null : oneLine(e.subject, 200),
    body: e.body == null ? null : String(e.body).replace(/\r\n?/g, '\n').slice(0, 10000),
    attach: e.attach !== false,
  };
}

/**
 * Mail the finished output: attached (one item: that file; several: the zip or merged PDF) when it fits under
 * PW_MAIL_MAX_ATTACHMENT_MB, else (or with attach: false) a signed, expiring download link. Never throws: the outcome
 * goes on the job and in the audit log. @param {any} job @param {any[]} ok @param {(r: any) => Promise<Buffer>} bytesOf
 */
async function deliver(job, ok, bytesOf) {
  const e = job.email;
  const at = new Date().toISOString();
  try {
    let file = null;
    if (ok.length === 1) file = { filename: ok[0].name, content: await bytesOf(ok[0]), contentType: FORMAT_TYPES[job.format] || 'application/octet-stream' };
    else if (job.download?.blob) file = { filename: job.download.name, content: await blobs().get(job.download.blob), contentType: job.download.type };
    const fits = !!file?.content && file.content.length <= maxAttachmentBytes();
    const link = !e.attach || !fits ? (job.download ? downloadLink(job) : null) : null;
    if (!(e.attach && fits) && !link) throw new Error(job.download ? 'the output is too large to attach and no download link can be made (set PW_BASE_URL and PW_LINK_SECRET or PW_SESSION_SECRET)' : 'the output is too large to attach');
    const when = new Date().toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
    const lines = [e.body || `${job.template}: ${ok.length} file${ok.length === 1 ? '' : 's'}, made ${when} UTC.`];
    if (link) lines.push('', `${e.attach ? 'The file is too large to attach. ' : ''}Download it here (the link works until ${new Date(Date.now() + linkDays() * 86400000).toISOString().slice(0, 10)}):`, link);
    if (job.failed) lines.push('', `${job.failed} item(s) failed. See the batch ${job.id}.`);
    const r = await sendMail({ to: e.to, subject: e.subject || `${job.template} (${new Date().toISOString().slice(0, 10)})`, text: lines.join('\n'), attachments: e.attach && fits ? [file] : [] });
    await audit('mail.sent', { actor: job.owner || 'nobody', report: job.templateRef, detail: { batch: job.id, recipients: e.to.length, domains: [...new Set(e.to.map(a => a.split('@')[1]))], how: e.attach && fits ? 'attached' : 'link', schedule: job.schedule?.id } });
    return { status: 'sent', at, how: e.attach && fits ? 'attached' : 'link', recipients: e.to.length, accepted: r.accepted };
  } catch (err) {
    await audit('mail.failed', { actor: job.owner || 'nobody', report: job.templateRef, status: 'failed', detail: { batch: job.id, error: String(err.message).slice(0, 200), schedule: job.schedule?.id } });
    return { status: 'failed', at, error: String(err.message).slice(0, 300) };
  }
}
const FORMAT_TYPES = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', html: 'text/html', csv: 'text/csv', json: 'application/json' };

/** POST the job summary to the webhook, signed with HMAC-SHA256 of the body (PW_WEBHOOK_SECRET). */
async function notify(job) {
  const body = JSON.stringify({ event: 'batch.finished', job: publicJob(job), downloadUrl: job.download ? `${job.base}/api/v1/batches/${job.id}/download` : null });
  const headers = { 'content-type': 'application/json', 'user-agent': 'Pagewright' };
  if (process.env.PW_WEBHOOK_SECRET) headers['x-pagewright-signature'] = 'sha256=' + crypto.createHmac('sha256', process.env.PW_WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const owner = job.owner ? await principalFromId(job.owner, job.ownerKey, { session: !!job.ownerSession, since: job.ownerSince || null, madeAt: job.createdAt }) : defaultPrincipal(); // as the owner is now
    const res = await serverFetch(job.self, { internal: canDesign(owner) })(job.webhook, { method: 'POST', headers, body });
    job.webhookStatus = res.status;
  } catch (e) { job.webhookStatus = `error: ${e.message}`; }
  await save(job);
}
