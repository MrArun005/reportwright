// GET /api/v1/batches/<id>/download — a finished batch's output (zip or merged PDF), from the shared blob storage
// (src/server/blobs.js), so any server answers. With an API key, for the key's own batches; or with ?exp=&sig= from a
// link in a scheduled email (signed, expiring: src/server/jobs.js downloadLink), while the batch's owner may still run
// its report (linkJob).
import { apiPrincipal } from '@/server/auth.js';
import { jobFile, linkOk, linkJob } from '@/server/jobs.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  let principal, via = 'api';
  if (sp.has('sig')) {
    if (!/^b_[a-z0-9]+$/.test(id) || !linkOk(id, sp.get('exp'), sp.get('sig')) || !(await linkJob(id))) {
      await audit('batch.download', { req, status: 'denied', detail: { batch: String(id).slice(0, 40), via: 'link', reason: 'bad or expired link, or the owner may no longer run the report' } });
      return Response.json({ error: 'This download link is not valid or has expired.' }, { status: 403 });
    }
    principal = { kind: 'service' }; via = 'link'; // the signature names this one job's output, nothing else
  } else {
    const r = await apiPrincipal(req);
    if (r.res) return r.res;
    principal = r.principal;
  }
  const f = await jobFile(id, principal);
  if (!f) return Response.json({ error: 'Nothing to download yet' }, { status: 404 });
  await audit('batch.download', { req, ...(via === 'api' ? { principal } : { actor: 'link' }), detail: { batch: id, via, bytes: f.bytes.length } });
  return new Response(f.bytes, { headers: { 'content-type': f.type, 'content-length': String(f.bytes.length), 'content-disposition': `attachment; filename="${f.name}"`, 'cache-control': 'no-store' } });
}
