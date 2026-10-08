// Shared site header: the menu button on narrow screens (the links are plain anchors, so the nav works without this).
const bar = document.querySelector('.bar'), btn = document.getElementById('menu-btn');
if (bar && btn) {
  const set = (open) => { bar.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => set(!bar.classList.contains('open')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  bar.addEventListener('click', (e) => { if (e.target.closest('.nav a')) set(false); });
}
// Playground tool bar: one "Menu" button under 600 px.
const tt = document.getElementById('tools-toggle'), pb = document.getElementById('pbar');
if (tt && pb) tt.addEventListener('click', () => tt.setAttribute('aria-expanded', String(pb.classList.toggle('open'))));
