// The interactive HTML export inlines the viewer bundle in a <script>: "<!--" then "<script" in the bundle's strings
// put the HTML parser in a state where </script> no longer ends it, and the rest of the page became script.
import { it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('the inlined bundle has no "<!--", "<script" or "</script" left, and still says the same', async () => {
  const js = 'var a = "<!-- x", b = "<script>", c = "</SCRIPT>", d = /<script/;';
  vi.stubGlobal('window', { location: { origin: 'http://pw.test' } });
  vi.stubGlobal('fetch', async (u) => (String(u).endsWith('.full.js') ? new Response(js) : String(u).includes('/api/') ? Response.json([]) : new Response(new Uint8Array(4))));
  vi.resetModules();
  const { exportInteractiveHtml } = await import('../../src/viewer/interactiveHtml.js');
  const { html } = await exportInteractiveHtml({ name: 'R', sections: { body: { items: [] } } }, { model: { pages: [] } });
  const inlined = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  expect(inlined).not.toMatch(/<(!--|\/?script)/i);
  const env = {}; new Function(inlined.replace(/var /, 'var ') + '; Object.assign(this, { a, b, c, d });').call(env);
  expect([env.a, env.b, env.c, env.d.source]).toEqual(['<!-- x', '<script>', '</SCRIPT>', '\\x3Cscript']);
});
