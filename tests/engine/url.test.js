// One allow-list for every link the engine emits (rich text <a href> and url actions).
import { describe, it, expect } from 'vitest';
import { safeUrl } from '../../src/engine/url.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const CASES = [
  ['//x', null], ['/\\x', null], ['\\\\x', null], ['https:x', null], ['http:/x', null],
  ['java\tscript:alert(1)', null], [' javascript:alert(1)', null], ['JAVASCRIPT:alert(1)', null],
  ['data:text/html,<b>x</b>', null], ['vbscript:x', null], ['https://ok.example\n', null], ['https://ok.example/a b', null],
  ['/\x7fx', null], ['', null], ['https://', null],
  ['mailto:a@b', 'mailto:a@b'], ['/viewer/x?y=1', '/viewer/x?y=1'], ['https://ok.example', 'https://ok.example'],
  ['HTTP://OK.example/p?q=1#h', 'HTTP://OK.example/p?q=1#h'], ['/', '/'],
];

describe('safeUrl', () => {
  it.each(CASES)('%j → %j', (v, want) => expect(safeUrl(v)).toBe(want));
  it('non-strings are refused', () => { expect(safeUrl(null)).toBe(null); expect(safeUrl(42)).toBe(null); });
});

const hrefs = (m) => m.pages[0].items.filter(i => i.t === 'link' && i.action?.type === 'url').map(i => i.action.href);
const attr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

describe('links in reports use it', () => {
  it.each(CASES)('rich text <a href=%j>', async (v, want) => {
    const m = await render(report([{ type: 'richtext', name: 'R', x: 0, y: 0, w: 300, h: 20, value: `<a href="${attr(v)}">link</a>` }]), { fontStore });
    expect(hrefs(m)).toEqual(want ? [want] : []);
  });
  it.each(CASES)('text box url action %j', async (v, want) => {
    const m = await render(report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 20, value: 'go', action: { type: 'url', url: `="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` } }]), { fontStore });
    expect(hrefs(m)).toEqual(want ? [want] : []);
  });
});
