// Keyboard reachability and focus rings in the viewer (a chart report with drill links), plus the phone layout.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const REPORT = process.env.REPORT || 'sales-explorer,charts-showcase,torture-test';
const b = await chromium.launch();

async function tabAudit(p) {
  // every interactive thing: real controls, and the drawing's clickable spots (each must have a keyboard twin)
  const report = await p.evaluate(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const controls = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, summary, [tabindex]:not([tabindex="-1"])')]
      .filter(el => vis(el) || el.classList.contains('vlink'));
    const drawn = [...document.querySelectorAll('svg .pw-link')];
    return { controls: controls.length, drawn: drawn.length };
  });
  const reached = new Set(); const noRing = [];
  await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await p.locator('body').focus();
  for (let i = 0; i < 2000; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      if (!el.dataset.pwSeen) el.dataset.pwSeen = String(Math.random());
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (s.boxShadow && s.boxShadow !== 'none');
      return { id: el.dataset.pwSeen, ring, desc: `${el.tagName.toLowerCase()}.${el.className}` + (el.getAttribute('aria-label') || el.textContent || '').slice(0, 30) };
    });
    if (!info) continue;
    if (reached.has(info.id)) break; // wrapped around
    reached.add(info.id);
    if (!info.ring) noRing.push(info.desc);
  }
  // back to the first page: the paging buttons are as they were when the walk passed them
  await p.evaluate(() => document.querySelector('.vpages')?.scrollTo(0, 0));
  await p.waitForTimeout(300);
  const unreachable = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = [];
    for (const el of document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, summary'))
      if ((vis(el) || el.classList.contains('vlink')) && !el.dataset.pwSeen && !el.closest('[inert]')) out.push(`${el.tagName.toLowerCase()}.${el.className} ${(el.getAttribute('aria-label') || el.textContent || '').slice(0, 30)}`);
    // a drawn clickable spot needs a keyboard twin with the same action that was reached
    const twins = new Set([...document.querySelectorAll('.vlink[data-pw-seen]')].map(e => e.getAttribute('data-action')));
    for (const el of document.querySelectorAll('svg .pw-link')) if (!twins.has(el.getAttribute('data-action')) && !el.closest('.vfrozen-head')) out.push(`drawn ${el.getAttribute('data-action').slice(0, 60)}`);
    // mouse-only: something that shows a pointer and takes clicks but is not a control (a pie slice has its twin above)
    const ok = (el) => el.closest('a[href], button, input, select, summary, label, textarea, [tabindex]:not([tabindex="-1"])');
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.cursor !== 'pointer' || st.pointerEvents === 'none' || ok(el)) continue;
      if (el.matches('svg path.pw-link') && twins.has(el.getAttribute('data-action'))) continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer' && !ok(el.parentElement)) continue; // counted once, at the top
      out.push(`mouse-only ${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''}`);
    }
    return out;
  });
  return { ...report, reached: reached.size, unreachable, noRing };
}

for (const rep of REPORT.split(',')) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await p.goto(`${BASE}/viewer/${rep}`);
  await p.waitForSelector('.vpage svg');
  await p.waitForTimeout(800);
  assert.ok((await p.title()).length > 0, 'the page has a title');
  if (!process.env.SKIPLM) for (const lm of ['main', 'header']) assert.ok(await p.locator(lm === 'main' ? 'main, [role=main]' : 'header, [role=banner]').count(), `landmark ${lm}`);
  const r = await tabAudit(p);
  console.log(rep, JSON.stringify({ controls: r.controls, drawn: r.drawn, reached: r.reached, unreachable: r.unreachable.length, noRing: r.noRing.length }));
  if (r.unreachable.length) console.log(' unreachable:', r.unreachable.slice(0, 15));
  if (r.noRing.length) console.log(' no ring:', r.noRing.slice(0, 15));
  if (!process.env.SOFT) assert.equal(r.unreachable.length, 0, 'every interactive element is reachable by Tab');
  if (!process.env.SOFT) assert.equal(r.noRing.length, 0, 'every focused element shows a focus ring');
  // a page is announced with its number
  assert.match(await p.locator('.vpage').first().getAttribute('aria-label'), /1/);
  await p.context().close();
}

// phone: no sideways scroll, no tiny tap targets
for (const rep of (process.env.PHONE || 'loan-statement,torture-test,charts-showcase,sales-explorer').split(',')) {
  const p = await (await b.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true })).newPage();
  await p.goto(`${BASE}/viewer/${rep}`);
  await p.waitForSelector('.vpage svg');
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const v = document.querySelector('.vpages');
    const over = Math.max(document.documentElement.scrollWidth - window.innerWidth, v ? v.scrollWidth - v.clientWidth : 0);
    const small = [...document.querySelectorAll('button, a[href], input, select, summary, [role=button]')].filter(el => {
      if (el.classList.contains('vlink')) return false; // overlays sized to the drawn spot
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
      return r.width < 24 || r.height < 24;
    }).map(el => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { over, small };
  });
  console.log('phone', rep, JSON.stringify({ overflow: m.over, small: m.small.length }), m.small.slice(0, 20));
  if (!process.env.SOFT) assert.ok(m.over <= 0, `no horizontal scroll (${m.over}px)`);
  if (!process.env.SOFT) assert.equal(m.small.length, 0, 'tap targets of 24px or more');
  await p.context().close();
}
await b.close();
console.log('b2-a11y OK');
