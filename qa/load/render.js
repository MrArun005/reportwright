// k6: POST /api/v1/render. Env: BASE, KEY, MIX (small|mixed), and either VUS+DURATION or STAGES ("1:30s,50:60s" vus:dur).
// Counters: unexpected (a status other than 200/429/503, or no answer), noretry (a 429/503 without Retry-After),
// rejected (429/503, deliberate), and http_req_duration tagged ok:true for answered renders.
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const unexpected = new Counter('unexpected');
const noretry = new Counter('noretry');
const rejected = new Counter('rejected');
const okDur = new Trend('ok_duration', true);
const statuses = new Counter('status_5xx');
const neterr = new Counter('neterr');
const s4xx = new Counter('status_4xx');

const MIXES = {
  small: [{ template: 'invoice-gallery', format: 'pdf' }],
  mixed: [
    { template: 'invoice-gallery', format: 'pdf' },
    { template: 'sales-by-region', format: 'pdf', parameters: { year: 2025 } },
    { template: 'loan-statement', format: 'pdf', parameters: { accountId: 'LN-2025-001982' } },
    { template: 'sales-by-region', format: 'xlsx', parameters: { year: 2025 } },
  ],
};
const mix = MIXES[__ENV.MIX || 'small'];
const stages = (__ENV.STAGES || '').split(',').filter(Boolean).map(s => { const [target, duration] = s.split(':'); return { target: Number(target), duration }; });
export const options = stages.length
  ? { scenarios: { s: { executor: 'ramping-vus', startVUs: 1, stages, gracefulRampDown: '10s' } } }
  : { scenarios: { s: { executor: 'constant-vus', vus: Number(__ENV.VUS || 10), duration: __ENV.DURATION || '60s' } } };
options.summaryTrendStats = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'];
options.discardResponseBodies = true;

export default function () {
  const body = mix[Math.floor(Math.random() * mix.length)];
  const r = http.post(`${__ENV.BASE}/api/v1/render`, JSON.stringify(body), { headers: { authorization: `Bearer ${__ENV.KEY}`, 'content-type': 'application/json' }, timeout: '120s' });
  if (r.status === 200) okDur.add(r.timings.duration);
  else if (r.status === 429 || r.status === 503) { rejected.add(1); if (!r.headers['Retry-After']) noretry.add(1); }
  else { unexpected.add(1); if (r.status >= 500) statuses.add(1); else if (r.status >= 400) s4xx.add(1); else if (r.status === 0) neterr.add(1); }
}
