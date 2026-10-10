// Home page: section-by-section keys, progress dots and an Apple-style reveal as each section arrives.
(() => {
  const secs = [...document.querySelectorAll('main > section')];
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const label = (s) => s.getAttribute('aria-label') || document.getElementById(s.getAttribute('aria-labelledby'))?.textContent || s.id;

  // progress dots
  const dots = document.createElement('nav');
  dots.setAttribute('aria-label', 'Page sections');
  const ol = document.createElement('ol'); ol.className = 'snap-dots';
  const btns = secs.map((s, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.setAttribute('aria-label', `Section ${i + 1} of ${secs.length}: ${label(s)}`); b.title = label(s);
    b.addEventListener('click', () => go(i));
    const li = document.createElement('li'); li.append(b); ol.append(li); return b;
  });
  dots.append(ol); document.body.append(dots);

  let cur = 0;
  const setCur = (i) => { cur = i; btns.forEach((b, j) => b.setAttribute('aria-current', String(j === i))); };
  const go = (i) => { i = Math.max(0, Math.min(secs.length - 1, i)); secs[i].scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); setCur(i); };

  // reveal: headings, then text, then visuals
  const groups = [['h1', '.kicker', '.num', 'h2'], ['.lede', '.hero-actions', '.sect-note', '.install', '.tools', '.subnav'], ['.spec', '.split', '.code-split', '.caps', '.viewer-host']];
  if (!calm) {
    secs.forEach((s) => groups.forEach((g, gi) => s.querySelectorAll(g.join(',')).forEach((n) => {
      if (n.closest('[data-rv]')) return;
      n.dataset.rv = ''; n.style.setProperty('--rv-d', `${gi * 110}ms`);
    })));
    root.classList.add('reveal-on');
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio >= 0.5) { e.target.classList.add('in'); setCur(secs.indexOf(e.target)); }
  }), { threshold: 0.5 });
  secs.forEach((s) => io.observe(s));
  setCur(0);

  if (calm) return; // reduced motion: plain scrolling, no section keys
  const keys = { PageDown: 1, PageUp: -1, ArrowDown: 1, ArrowUp: -1, ' ': 1, Home: -Infinity, End: Infinity };
  addEventListener('keydown', (e) => {
    if (!(e.key in keys) || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const t = e.target;
    if (t.closest?.('input,select,textarea,[contenteditable],[role=tablist],.viewer-host,pre')) return;
    if (e.key === ' ' && t.closest?.('a,button')) return;
    let d = keys[e.key]; if (e.key === ' ' && e.shiftKey) d = -1;
    const s = secs[cur];
    // a section taller than the screen scrolls inside first
    if (Math.abs(d) === 1 && s.scrollHeight > s.clientHeight + 1) {
      const room = d > 0 ? s.scrollHeight - s.clientHeight - s.scrollTop : s.scrollTop;
      if (room > 1) { e.preventDefault(); s.scrollBy({ top: d * (e.key.startsWith('Arrow') ? 80 : s.clientHeight * 0.85), behavior: 'smooth' }); return; }
    }
    e.preventDefault();
    go(d === Infinity ? secs.length - 1 : d === -Infinity ? 0 : cur + d);
  });
})();
