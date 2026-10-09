// E11: the viewer's scrolling page area is reachable by keyboard (axe scrollable-region-focusable), named, with a focus ring.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportViewer from '../../src/viewer/ReportViewer.jsx';

it('div.vpages is focusable, named, and has a visible focus style', () => {
  const html = renderToStaticMarkup(createElement(ReportViewer, { definition: { name: 'Sales' }, autoRun: false }));
  const tag = html.match(/<div class="vpages"[^>]*>/)[0];
  expect(tag).toMatch(/tabindex="0"/);
  expect(tag).toMatch(/role="region"/);
  expect(tag).toMatch(/aria-label="Sales"/);
  const css = fs.readFileSync(path.join(import.meta.dirname, '../../app/globals.css'), 'utf8');
  expect(css).toMatch(/\.vpages:focus-visible\s*\{[^}]*outline:/);
});
