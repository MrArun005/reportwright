// Small inline-SVG charts for the Overview (server components: no chart library, no client JS).
// Every chart takes real values; with no data it draws nothing and the caller shows an empty state.

const max = (a) => Math.max(1, ...a);
/** A nice axis top (1, 2, 5 × 10^n) at or above v. */
const niceTop = (v) => { const e = 10 ** Math.floor(Math.log10(v)); return [1, 2, 5, 10].map(m => m * e).find(n => n >= v) || v; };

/** A tiny trend line under a KPI. */
export function Spark({ values, label }) {
  if (!values.some(Boolean)) return <div className="spark-empty" aria-hidden="true" />;
  const W = 120, H = 32, m = max(values), step = W / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * step, H - 2 - (v / m) * (H - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${d}L${W} ${H}L0 ${H}Z`} className="spark-fill" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Small bars (the render-time distribution). */
export function MiniBars({ values, label }) {
  if (!values.some(Boolean)) return <div className="spark-empty" aria-hidden="true" />;
  const W = 120, H = 32, m = max(values), bw = W / values.length;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => <rect key={i} className="spark-bar" x={i * bw + 1} width={bw - 2} y={H - Math.max(v ? 2 : 0, (v / m) * H)} height={Math.max(v ? 2 : 0, (v / m) * H)} rx="1" />)}
    </svg>
  );
}

/** A chart over time: kind 'area' or 'bar'; labels under the x axis (some skipped when crowded). */
export function TimeChart({ kind, values, labels, fmt, label }) {
  const W = 460, H = 280, L = 40, R = 6, T = 10, B = 24;
  const top = niceTop(max(values)), iw = W - L - R, ih = H - T - B;
  const n = values.length, step = iw / n;
  const y = (v) => T + ih - (v / top) * ih;
  const every = Math.ceil(n / 6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * top);
  const xs = values.map((_, i) => L + step * (i + 0.5));
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return (
    <svg className="tchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text>
        </g>
      ))}
      {kind === 'bar'
        ? values.map((v, i) => <rect key={i} className="bar" x={xs[i] - Math.min(18, step * 0.62) / 2} width={Math.min(18, step * 0.62)} y={y(v)} height={T + ih - y(v)} rx="2"><title>{`${labels[i]}: ${fmt(v)}`}</title></rect>)
        : <>
          <path className="area" d={`${line}L${xs[n - 1].toFixed(1)} ${T + ih}L${xs[0].toFixed(1)} ${T + ih}Z`} />
          <path className="line" d={line} />
          {values.map((v, i) => v ? <circle key={i} className="dot" cx={xs[i]} cy={y(v)} r="2.6"><title>{`${labels[i]}: ${fmt(v)}`}</title></circle> : null)}
        </>}
      {labels.map((l, i) => (i % every === 0 || i === n - 1) && (n - 1 - i >= every || i === n - 1) ? <text key={i} x={xs[i]} y={H - 8} textAnchor="middle" className="axis">{l}</text> : null)}
    </svg>
  );
}
