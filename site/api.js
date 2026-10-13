// API page: language tabs, copy buttons, and the "Try it" render. The render mirrors play.js exportAs:
// a viewer mounted out of sight renders the definition, then viewer.export(format) gives the file.
const SERVER = new URL('.', document.baseURI).href.replace(/\/$/, '');
const $ = (s) => document.querySelector(s);

/* ---------- language tabs (roving tabindex; arrows, Home, End) ---------- */
for (const group of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const show = (i, focus) => {
    tabs.forEach((t, j) => { const on = j === i; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; panels[j].hidden = !on; });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(i, false));
    t.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) { e.preventDefault(); show((i + step + tabs.length) % tabs.length, true); }
      else if (e.key === 'Home') { e.preventDefault(); show(0, true); }
      else if (e.key === 'End') { e.preventDefault(); show(tabs.length - 1, true); }
    });
  });
  group.querySelector('.copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget, pre = panels.find((p) => !p.hidden);
    let ok = false;
    try { await navigator.clipboard.writeText(pre.textContent); ok = true; } catch {
      const sel = getSelection(), r = document.createRange();
      r.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(r);
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      sel.removeAllRanges();
    }
    btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  });
}

/* ---------- try it ---------- */
const json = $('#try-json'), fmt = $('#try-format'), go = $('#try-render'), status = $('#try-status');
const frame = $('#try-frame'), dl = $('#try-dl'), empty = $('#try-empty');
let fileUrl = null; // the object URL of the last result; revoked when replaced
const setStatus = (text, bad = false) => { status.textContent = text; status.classList.toggle('err', bad); };

// The sample is the gallery's invoice, a self-contained report with inline data; the playground's start-from loads it the same way.
fetch(`${SERVER}/api/reports/invoice-gallery`)
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((def) => { json.value = JSON.stringify(def, null, 2); setStatus(''); })
  .catch(() => { json.value = ''; setStatus('Could not load the sample. Paste a report definition here.', true); });

const loadViewer = () => import(`${SERVER}/embed/esm/viewer.js`);
const download = (blob, name) => { // as play.js does: an anchor click with an object URL
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

async function render() {
  let def;
  try { def = JSON.parse(json.value); } catch (e) { setStatus(`Not valid JSON: ${e.message}`, true); return; }
  const format = fmt.value, label = fmt.selectedOptions[0].text;
  go.disabled = true; setStatus(`Rendering ${label}…`);
  const box = document.createElement('div');
  box.className = 'mount';
  box.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:700px';
  document.body.append(box);
  let v;
  try {
    const { mountViewer } = await loadViewer();
    v = mountViewer(box, { server: SERVER, definition: def, height: '700px' });
    const ready = new Promise((res, rej) => { v.on('ready', res); v.on('error', (d) => rej(new Error(d?.message || 'the report did not run'))); });
    const blob = await Promise.race([
      ready.then(async () => { for (let i = 0; i < 50 && !v.getPageCount(); i++) await new Promise((r) => setTimeout(r, 100)); return v.export(format); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 2 minutes')), 120000)),
    ]);
    const base = (def.name || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
    const name = `${base}.${format}`;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(blob);
    empty.hidden = true;
    if (format === 'pdf') { frame.src = fileUrl; frame.hidden = false; }
    else { frame.hidden = true; frame.removeAttribute('src'); }
    dl.href = fileUrl; dl.download = name; dl.textContent = `Download ${name}`; dl.hidden = false;
    setStatus(format === 'pdf' ? 'Rendered. The PDF is shown on the right; the button downloads it.' : `Rendered. ${name} is downloading; the button saves it again if the browser blocked it.`);
    if (format !== 'pdf') download(blob, name);
  } catch (e) {
    setStatus(`Render failed: ${e.message}`, true); console.error(e);
  } finally { try { v?.unmount(); } catch {} box.remove(); go.disabled = false; }
}
go.addEventListener('click', render);
