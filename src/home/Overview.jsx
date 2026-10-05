import Link from 'next/link';
import { activity, renderStats, health, RANGES } from './overview.js';
import { Spark, MiniBars, TimeChart } from './Charts.jsx';
import ScheduleToggle from './ScheduleToggle.jsx';
import { listSchedules } from '@/server/schedules.js';
import { canDesign, atLeast } from '@/server/perms.js';
import { t } from '@/i18n/index.js';

const PRESETS = { '0 7 * * *': 'cronDaily', '0 7 * * 1': 'cronWeekly', '0 7 1 * *': 'cronMonthly', '0 * * * *': 'cronHourly' };
const VIA = { api: 'hm_viaApi', schedule: 'hm_viaSchedule', batch: 'hm_viaBatch', 'server link': 'hm_viaLink' };

/** % change against the previous period of the same length; null when there is nothing to compare with. */
const change = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);

function Kpi({ icon, label, value, hint, delta, chart, T, days }) {
  return (
    <article className="kpi">
      <div className="kpi-head"><span className="kpi-icon" aria-hidden="true">{icon}</span><h3>{label}</h3></div>
      <div className="kpi-row">
        <div>
          <p className="kpi-value">{value}</p>
          {delta === undefined ? null : delta === 'none'
            ? <p className="kpi-delta flat">{T('hm_newPeriod', { n: days })}</p>
            : <p className={`kpi-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}><b>{delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta)}%</b> {T('hm_vsPrev', { n: days })}</p>}
          <p className="kpi-hint">{hint}</p>
        </div>
        {chart}
      </div>
    </article>
  );
}

const ic = (d) => <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/**
 * The Overview: activity from the audit log (everyone's for admins, one's own otherwise), the render pool's counters and
 * health checks (admins), the principal's schedules (designers). Nothing is estimated or filled in.
 * @param {{ lang: string, sp: any, p: any, isAdmin: boolean, designer: boolean, canCreate: boolean, reports: Map<string, any> }} props
 */
export default async function Overview({ lang, sp, p, isAdmin, designer, canCreate, reports }) {
  const T = (k, v) => t(lang, k, v);
  const loc = lang === 'en' ? 'en-IN' : lang;
  const qa = lang === 'en' ? '' : `&lang=${encodeURIComponent(lang)}`;
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  const days = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 30;
  const by = sp.by === 'week' ? 'week' : 'day';
  const href = (o) => { const v = { range: days, by, ...o }; return `/?range=${v.range}${v.by === 'week' ? '&by=week' : ''}${qa}`; };
  const num = (n) => new Intl.NumberFormat(loc).format(n);
  const dayLabel = (d, o = { day: 'numeric', month: 'short' }) => new Date(`${d}T00:00:00Z`).toLocaleDateString(loc, { ...o, timeZone: 'UTC' });

  const scheds = designer && canDesign(p) ? await listSchedules(p) : null;
  const [a, h] = await Promise.all([activity({ p, all: isAdmin, days, by }), isAdmin ? health() : null]);
  const rs = isAdmin ? renderStats() : null;
  // a non-admin sees only events on reports they may still see (or inline definitions they sent)
  const recent = isAdmin ? a.recent : a.recent.filter(e => !e.report || reports.has(String(e.report).split('@')[0]));
  const labels = a.keys.map(k => dayLabel(k));
  const active = scheds ? scheds.filter(s => s.enabled !== false).length : 0;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>{T('hm_overview')}</h1>
          <p className="lede">{T('hm_overviewLede')} · <span className="scope">{isAdmin ? T('hm_scopeAll') : T('hm_scopeMine')}</span></p>
        </div>
        <div className="page-acts">
          <details className="drop range">
            <summary aria-label={T('hm_range')}>
              {ic('M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3')}
              <span>{dayLabel(a.start, { day: 'numeric', month: 'short' })} – {dayLabel(a.end, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            </summary>
            <div className="menu">{RANGES.map(r => <Link key={r} href={href({ range: r })} aria-current={r === days ? 'true' : undefined}>{T('hm_lastDays', { n: r })}</Link>)}</div>
          </details>
          {canCreate && <a className="btn primary lg" href="#new-report">{ic('M8 3v10M3 8h10')}{T('hm_createReport')}</a>}
        </div>
      </section>

      <section className="kpis" aria-label={T('hm_overview')}>
        <Kpi T={T} days={days} icon={ic('M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8h5M6 10.5h5')} label={T('hm_kpiGenerated')} value={num(a.cur.generated)}
          delta={a.prev.generated ? change(a.cur.generated, a.prev.generated) : a.cur.generated ? 'none' : undefined}
          hint={a.cur.generated || a.prev.generated ? T('hm_kpiGeneratedHint') : T('hm_noData')} chart={<Spark values={a.spark.generated} label={T('hm_chartGenerated')} />} />
        <Kpi T={T} days={days} icon={ic('M3.5 1.5h6l3 3v10h-9zM5.5 7h5M5.5 9.5h5M5.5 12h3')} label={T('hm_kpiPages')} value={num(a.cur.pages)}
          delta={a.prev.pages ? change(a.cur.pages, a.prev.pages) : a.cur.pages ? 'none' : undefined}
          hint={a.cur.pages || a.prev.pages ? T('hm_kpiPagesHint') : T('hm_noData')} chart={<Spark values={a.spark.pages} label={T('hm_chartPages')} />} />
        {rs && <Kpi T={T} days={days} icon={ic('M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5')} label={T('hm_kpiAvg')}
          value={rs.avgMs == null ? '—' : rs.avgMs < 1000 ? `${num(Math.round(rs.avgMs))} ms` : `${new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(rs.avgMs / 1000)} s`}
          hint={rs.timed ? T('hm_kpiAvgHint', { n: num(rs.timed) }) : T('hm_noData')} chart={<MiniBars values={rs.per} label={T('hm_dist')} />} />}
        {scheds && <Kpi T={T} days={days} icon={ic('M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M5 9.5h2')} label={T('hm_kpiSched')} value={num(scheds.length)}
          hint={T('hm_kpiSchedHint', { on: num(active), off: num(scheds.length - active) })} chart={<Spark values={a.spark.scheduled} label={T('hm_viaSchedule')} />} />}
      </section>
      {a.truncated && <p className="hint">{T('hm_truncated')}</p>}

      <section className={`ov-row ${h ? 'three' : ''}`}>
        {[['generated', 'hm_chartGenerated', 'area'], ['pages', 'hm_chartPages', 'bar']].map(([k, title, kind]) => (
          <article className="panel" key={k}>
            <div className="panel-head">
              <h2>{T(title)}</h2>
              <div className="seg" role="group" aria-label={T(title)}>
                <Link href={href({ by: 'day' })} aria-current={by === 'day' ? 'true' : undefined}>{T('hm_daily')}</Link>
                <Link href={href({ by: 'week' })} aria-current={by === 'week' ? 'true' : undefined}>{T('hm_weekly')}</Link>
              </div>
            </div>
            {a.series[k].some(Boolean)
              ? <TimeChart kind={kind} values={a.series[k]} labels={labels} fmt={(v) => new Intl.NumberFormat(loc, { notation: 'compact' }).format(v)} label={T(title)} />
              : <div className="chart-empty"><b>{T('hm_noData')}</b><span className="hint">{T('hm_noneInPeriod')}</span></div>}
          </article>
        ))}
        {h && (
          <article className="panel">
            <div className="panel-head"><h2>{T('hm_health')}</h2></div>
            <ul className="health">
              {h.checks.map(c => (
                <li key={c.id} data-check={c.id} data-state={c.state}>
                  <span className="hl-name">{T(`hm_${c.id}`)}</span>
                  <span className="hint hl-note">{c.id === 'engine' ? (c.note === 'inline' ? T('hm_inlineWorker') : T('hm_workers', { ready: c.note.split('/')[0], size: c.note.split('/')[1] })) : c.id === 'queue' ? T('hm_waiting', { n: c.note }) : c.note.startsWith('cron:') ? T('hm_viaCron', { when: c.note.slice(5) }) : c.note}</span>
                  <span className={`hl-state ${c.state}`}><i />{T(c.label === 'inline' ? 'hm_inlineState' : `hm_${c.state}`)}</span>
                </li>
              ))}
            </ul>
            <div className="health-foot">
              <span className="hint">{T('hm_sinceStart')}</span>
              {rs.done + rs.failed ? (
                <>
                  <div className="ratio" aria-hidden="true"><i style={{ width: `${(rs.done / (rs.done + rs.failed)) * 100}%` }} /></div>
                  <div className="ratio-legend">
                    <span><i className="dot ok" />{T('hm_succeeded')} <b>{num(rs.done)}</b> ({Math.round((rs.done / (rs.done + rs.failed)) * 1000) / 10}%)</span>
                    <span><i className="dot bad" />{T('hm_failed')} <b>{num(rs.failed)}</b> ({Math.round((rs.failed / (rs.done + rs.failed)) * 1000) / 10}%)</span>
                  </div>
                </>
              ) : <b className="hint">{T('hm_noData')}</b>}
            </div>
          </article>
        )}
      </section>

      <section className={`ov-row ${scheds ? 'split' : ''}`}>
        <article className="panel">
          <div className="panel-head"><h2>{T('hm_recent')}</h2>{isAdmin && <Link className="more-link" href={`/admin/audit${q}`}>{T('hm_viewAll')}</Link>}</div>
          {recent.length ? (
            <div className="tscroll">
              <table className="dtable">
                <thead><tr><th scope="col">{T('hm_colName')}</th><th scope="col">{T('hm_colFormat')}</th><th scope="col" className="num">{T('hm_colPages')}</th><th scope="col">{T('hm_colVia')}</th><th scope="col">{T('status')}</th><th scope="col">{T('hm_colAt')}</th><th scope="col"><span className="sr">{T('hm_more')}</span></th></tr></thead>
                <tbody>
                  {recent.map(e => {
                    const id = e.report ? String(e.report).split('@')[0] : null, r = id ? reports.get(id) : null;
                    return (
                      <tr key={e.id}>
                        <td>{r ? <Link href={`/viewer/${r.id}${q}`} className="cell-name">{r.name}</Link> : <span className="cell-name muted">{id ? `${id} · ${T('hm_gone')}` : T('hm_inline')}</span>}</td>
                        <td><span className="fmt">{(e.format || 'pdf').toUpperCase()}</span></td>
                        <td className="num">{e.detail?.pages != null ? num(e.detail.pages) : '—'}</td>
                        <td>{e.type === 'report.export' ? T('hm_viaExport') : T(VIA[e.detail?.via] || 'hm_viaApi')}</td>
                        <td><span className={`pill ${e.status === 'ok' ? 'ok' : 'bad'}`}>{e.status === 'ok' ? T('hm_completed') : e.status === 'denied' ? T('hm_denied') : T('hm_failed')}</span></td>
                        <td className="nowrap">{new Date(e.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td>{r && (
                          <details className="drop kebab">
                            <summary aria-label={T('hm_more')}>⋯</summary>
                            <div className="menu end">
                              <Link href={`/viewer/${r.id}${q}`}>{T('view')}</Link>
                              {designer && atLeast(r.access, 'edit') && <Link href={`/designer/${r.id}${q}`}>{T('design')}</Link>}
                            </div>
                          </details>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="chart-empty"><b>{T('hm_noData')}</b><span className="hint">{T('hm_noRecent')}</span></div>}
        </article>

        {scheds && (
          <article className="panel">
            <div className="panel-head"><h2>{T('hm_kpiSched')}</h2><Link className="more-link" href={`/schedules${q}`}>{T('hm_viewAll')}</Link></div>
            {scheds.length ? (
              <ul className="sched">
                {scheds.slice(0, 6).map(s => {
                  const on = s.enabled !== false, name = s.name || reports.get(String(s.template))?.name || String(typeof s.template === 'string' ? s.template : T('hm_inline'));
                  return (
                    <li key={s.id}>
                      <span className="sched-icon" aria-hidden="true">{ic('M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5')}</span>
                      <span className="sched-main">
                        <b>{name}</b>
                        <span className="hint">{PRESETS[s.cron] ? T(PRESETS[s.cron]) : <code>{s.cron}</code>} · {s.timezone || 'UTC'}{on && s.nextRunAt ? ` · ${T('hm_nextAt', { when: new Date(s.nextRunAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' }) })}` : ''}</span>
                      </span>
                      <ScheduleToggle id={s.id} on={on} label={T('hm_toggle', { name })} />
                      <span className={`pill ${on ? 'ok' : 'off'}`}>{on ? T('active') : T('hm_paused')}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <div className="chart-empty"><b>{T('noSchedules')}</b></div>}
          </article>
        )}
      </section>
    </>
  );
}
