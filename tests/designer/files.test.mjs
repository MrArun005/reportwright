// Designer files: download the definition (.pw.json), import (.jrxml .rdl .rdlc .rptdesign .json), Open (onOpen),
// Save / Ctrl+S, the save-state indicator, isDirty / onDirtyChange, Ctrl+S while a dialog is open.
// Every sample report in the repository is imported through the real file picker.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { setup, report, tb, root, Designer } from './harness.mjs';
import { readReportFile } from '../../src/designer/importFile.js';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

/** Poll fn until it returns a truthy value (or fail after ms). */
async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${last})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const saveState = (d) => d.page.getByTestId('save-state').innerText();
const saved = (d) => d.page.evaluate(() => window.__saved.map((x) => JSON.parse(JSON.stringify(x))));
/** Click download-def and return { name, text } of the file. */
async function download(d) {
  const [dl] = await Promise.all([d.page.waitForEvent('download'), d.page.getByTestId('download-def').click()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
}
/** Pick a file with the Import button (the real file chooser). file: a path or { name, mimeType, buffer }. */
async function importVia(d, file) {
  const [fc] = await Promise.all([d.page.waitForEvent('filechooser'), d.page.getByTestId('import-report').click()]);
  await fc.setFiles(file);
  await d.page.getByTestId('import-result').waitFor();
}
const importDialog = (d) => d.page.locator('.dialog[aria-label="Import report"]');
async function closeImport(d) {
  await importDialog(d).locator('footer .btn').click();
  await importDialog(d).waitFor({ state: 'detached' });
}
/** Nudge item `name` right by 1 pt with the keyboard (an unsaved change). */
async function nudge(d, name) {
  // the canvas may still settle (zoom to fit, fonts) right after it opens: click again until the item is selected
  await until(
    async () => {
      await d.click(name);
      return (await d.selected()).includes(name);
    },
    8000,
    `${name} selected`,
  );
  await d.press('ArrowRight');
  await until(() => d.dirty(), 5000, 'an unsaved change');
}
// the harness has no server: data a report fetches (SQL through /api/data, images on the web) fails to load
const NETWORK = [/Failed to load resource/, /net::ERR_/];

describe('download the definition', () => {
  test('download-def gives <name>.pw.json with the definition as it is now (unsaved changes too)', async () => {
    const d = await env.open(report([tb('A', 10, 10), tb('B', 10, 60)], { name: 'Quarterly Sales' }));
    await nudge(d, 'A');
    assert.equal(await saveState(d), 'Unsaved changes');
    const f = await download(d);
    assert.equal(f.name, 'Quarterly-Sales.pw.json');
    const got = JSON.parse(f.text);
    assert.deepEqual(got, await d.def());
    assert.ok(Designer.find(got, 'A').x > 10, 'the nudge is in the file');
    assert.equal(await saveState(d), 'Unsaved changes', 'a download is not a save');
    d.expectClean();
  });

  test('download → open in a fresh designer → download again gives the identical file', async () => {
    const d = await env.open(
      report(
        [
          tb('A', 10, 10),
          tb('B', 10, 60, 120, 30, { style: { fontWeight: 'bold' } }),
          { type: 'container', name: 'Box', x: 200, y: 10, w: 200, h: 100, items: [tb('Inner', 5, 5, 80, 20)] },
        ],
        { parameters: [{ name: 'region', type: 'string', default: 'North' }] },
      ),
    );
    await nudge(d, 'B');
    const first = await download(d);
    d.expectClean();
    const d2 = await env.open(JSON.parse(first.text));
    const second = await download(d2);
    assert.equal(second.name, first.name);
    assert.equal(second.text, first.text, 'the second download differs from the first');
    d2.expectClean();
  });

  test('a .pw.json downloaded from one designer imports into another unchanged', async () => {
    const d = await env.open(report([tb('A', 10, 10), tb('B', 10, 60)], { name: 'Round trip' }));
    await nudge(d, 'A');
    const f = await download(d);
    const want = await d.def();
    d.expectClean();
    const d2 = await env.open(report([tb('Other', 0, 0)]));
    await importVia(d2, { name: f.name, mimeType: 'application/json', buffer: Buffer.from(f.text) });
    assert.match(await d2.page.getByTestId('import-result').innerText(), /Round-trip\.pw\.json is imported/);
    assert.equal(await importDialog(d2).locator('li').count(), 0, 'a definition file has no warnings');
    assert.deepEqual(await d2.def(), want);
    await closeImport(d2);
    assert.equal(await d2.item('Other').count(), 0);
    await d2.item('A').waitFor();
    d2.expectClean();
  });
});

describe('import', () => {
  test('the hidden file input accepts the report formats', async () => {
    const d = await env.open(report([tb('A', 0, 0)]));
    const input = d.page.getByTestId('import-file');
    assert.equal(await input.getAttribute('type'), 'file');
    assert.deepEqual(
      (await input.getAttribute('accept')).split(',').sort(),
      ['.json', '.jrxml', '.rdl', '.rdlc', '.rptdesign'].sort(),
    );
    assert.equal(await input.isVisible(), false);
    d.expectClean();
  });

  test('read-only: no Import button', async () => {
    const d = await env.open(report([tb('A', 0, 0)]), { readOnly: true });
    assert.equal(await d.page.getByTestId('import-report').count(), 0);
    assert.equal(await d.page.getByTestId('save-state').count(), 0);
    await d.page.getByTestId('download-def').waitFor(); // download stays
    d.expectClean();
  });

  for (const [label, file, msg] of [
    [
      'invalid JSON',
      { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ "sections": ') },
      /broken\.json is not valid JSON/,
    ],
    [
      'JSON that is not a report',
      { name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"rows":[1,2]}') },
      /data\.json is not a report definition/,
    ],
    [
      'JSON null',
      { name: 'null.json', mimeType: 'application/json', buffer: Buffer.from('null') },
      /null\.json is not a report definition/,
    ],
    [
      'a Crystal Reports .rpt',
      {
        name: 'Invoice.rpt',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
      },
      /Invoice\.rpt is not a report file/,
    ],
    [
      'an ActiveReports .rdlx-json',
      {
        name: 'invoice.rdlx-json',
        mimeType: 'application/json',
        buffer: fs.readFileSync(path.join(root, 'tests/fixtures/rdlx/invoice.rdlx-json')),
      },
      /invoice\.rdlx-json is not a report file/,
    ],
    ['an empty .jrxml', { name: 'empty.jrxml', mimeType: 'text/xml', buffer: Buffer.alloc(0) }, /./],
  ]) {
    test(`importing ${label} shows the error and keeps the report`, async () => {
      const d = await env.open(report([tb('Keep', 10, 10)]));
      await nudge(d, 'Keep');
      const before = await d.def();
      await importVia(d, file);
      const text = await d.page.getByTestId('import-result').innerText();
      assert.match(text, msg);
      assert.doesNotMatch(text, /is imported/);
      assert.deepEqual(await d.def(), before);
      assert.equal(await saveState(d), 'Unsaved changes');
      await closeImport(d);
      await d.click('Keep');
      assert.deepEqual(await d.selected(), ['Keep']);
      d.expectClean();
    });
  }

  test('the same file can be imported twice in a row (the input is reset)', async () => {
    const d = await env.open(report([tb('A', 0, 0)]));
    const f = path.join(root, 'tests/fixtures/jrxml/crosstab-sales.jrxml');
    await importVia(d, f);
    await closeImport(d);
    await d.focusCanvas();
    await nudgeAny(d);
    await importVia(d, f);
    assert.match(await d.page.getByTestId('import-result').innerText(), /crosstab-sales\.jrxml is imported/);
    await closeImport(d);
    d.expectClean(NETWORK);
  });

  test('regression: an imported report shows "Saved" and its Save button is disabled, though nothing was saved', async () => {
    const d = await env.open(report([tb('A', 0, 0)]));
    await importVia(d, path.join(root, 'site/switch/samples/jr7-tabular-TabularReport.jrxml'));
    await closeImport(d);
    assert.equal(await saveState(d), 'Unsaved changes');
    assert.equal(await d.dirty(), true);
    assert.equal(await d.page.getByTestId('save').isEnabled(), true);
    d.expectClean(NETWORK);
  });

  test('regression: a JasperReports file in ISO-8859-1 imports with its accented text broken', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" name="Enc" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
<title><band height="50"><staticText><reportElement x="0" y="0" width="200" height="20"/><text><![CDATA[Café crème]]></text></staticText></band></title>
</jasperReport>`;
    const d = await env.open(report([tb('A', 0, 0)]));
    await importVia(d, { name: 'latin1.jrxml', mimeType: 'text/xml', buffer: Buffer.from(xml, 'latin1') });
    const def = await d.def();
    assert.equal(def.sections.body.items[0].value, 'Café crème');
    await closeImport(d);
    d.expectClean();
  });

  test('an SSRS file saved as UTF-16 (with a byte-order mark) imports', async () => {
    const text = fs
      .readFileSync(path.join(root, 'site/switch/samples/rs-Transcript.rdl'), 'utf8')
      .replace(/^﻿/, '')
      .replace(/encoding="utf-8"/i, 'encoding="utf-16"');
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const d = await env.open(report([tb('A', 0, 0)]));
    await importVia(d, { name: 'utf16.rdl', mimeType: 'text/xml', buffer });
    assert.match(await d.page.getByTestId('import-result').innerText(), /utf16\.rdl is imported/);
    await closeImport(d);
    d.expectClean(NETWORK);
  });
});

/** Make some change in whatever is on the canvas (select-all, nudge). */
async function nudgeAny(d) {
  await d.focusCanvas();
  await d.press('ControlOrMeta+a');
  await d.press('ArrowDown');
}

// every sample report in the repository, imported through the file chooser
const SAMPLES = execSync("git ls-files | grep -Ei '\\.(jrxml|rdl|rdlc|rptdesign|rpt)$' || true", { cwd: root })
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);
for (const extra of ['tests/fixtures/jrxml', 'tests/fixtures/rdl', 'tests/fixtures/birt']) {
  const walk = (dir) =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(jrxml|rdl|rdlc|rptdesign|rpt)$/i.test(e.name) && !SAMPLES.includes(rel)) SAMPLES.push(rel);
    });
  if (fs.existsSync(path.join(root, extra))) walk(extra);
}

describe('import every sample report', { concurrency: 2 }, () => {
  test('samples were found', () => {
    assert.ok(SAMPLES.length >= 100, `only ${SAMPLES.length} samples`);
  });
  for (const rel of SAMPLES) {
    test(`import ${rel}`, { timeout: 180000 }, async (t) => {
      const file = path.join(root, rel);
      const name = path.basename(rel);
      const want = readReportFile(name, fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      const T0 = Date.now();
      const lap = (w) => process.env.LAP && console.log(w, Date.now() - T0);
      const d = await env.open(report([tb('Before', 10, 10)]));
      t.after(() => d.ctx.close().catch(() => {})); // 130 contexts left open exhaust the browser
      lap('open');
      await importVia(d, file);
      lap('import');
      const result = await d.page.getByTestId('import-result').innerText();
      const listed = await importDialog(d).locator('.dbody li').allInnerTexts();
      const ws = (s) => String(s).replace(/\s+/g, ' ').trim(); // innerText collapses white space
      assert.deepEqual(listed.map(ws), want.warnings.map(ws), 'the dialog lists the importer warnings');
      if (want.error) {
        // a file the importer cannot read: its error, and the report stays
        assert.equal(result.trim(), want.error.trim());
        assert.ok(await d.get('Before'), 'the report before the import stays');
        await closeImport(d);
        d.expectClean(NETWORK);
        return;
      }
      assert.match(result, new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is imported`));
      assert.equal(await d.get('Before'), null, 'the imported report replaced the one before');
      await closeImport(d);
      // the designer keeps working: select all in the body, Preview, back to Design
      const def = await d.def();
      const body = Array.isArray(def.sections.body) ? def.sections.body[0] : def.sections.body;
      await d.focusCanvas();
      await d.press('ControlOrMeta+a');
      if ((body.items || []).length)
        await until(async () => (await d.page.locator('.paper .sel[data-item]').count()) > 0, 5000, 'select all');
      lap('selectall');
      await d.page.getByTestId('tab-preview').click();
      await d.page.locator('.dpreview .vpage, .dpreview .vmsg.error').first().waitFor({ timeout: 60000 });
      lap('preview');
      await d.page
        .locator('.seg button')
        .filter({ hasText: /^Design$/ })
        .click();
      await d.page.locator('[data-testid="paper"]').waitFor();
      assert.deepEqual(await d.def(), def, 'preview changed the definition');
      d.expectClean(NETWORK);
    });
  }
});

describe('open (onOpen)', () => {
  test('no onOpen: no Open button', async () => {
    const d = await env.open(report([tb('A', 0, 0)]));
    assert.equal(await d.page.getByTestId('open').count(), 0);
    d.expectClean();
  });

  test('Open loads the definition the host gives, as saved, with a fresh undo history', async () => {
    const other = report([tb('Opened', 20, 20)], { name: 'From host' });
    const d = await env.open(report([tb('A', 10, 10)]), { openDef: other });
    await nudge(d, 'A');
    assert.equal(await saveState(d), 'Unsaved changes');
    await d.page.getByTestId('open').click();
    await d.item('Opened').waitFor();
    assert.equal(await d.page.evaluate(() => window.__opened), 1);
    assert.equal(await d.item('A').count(), 0);
    assert.equal((await d.def()).name, 'From host');
    assert.equal(await saveState(d), 'Saved');
    assert.equal(await d.dirty(), false);
    assert.equal(await d.page.getByRole('button', { name: /^Undo/ }).isDisabled(), true);
    await d.focusCanvas();
    await d.undo();
    assert.equal(await d.item('Opened').count(), 1, 'undo does not bring the old report back');
    d.expectClean();
  });
});

describe('save', () => {
  test('Save button: Unsaved → onSave gets the definition → Saved; disabled while saved', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    const btn = d.page.getByTestId('save');
    assert.equal(await saveState(d), 'Saved');
    assert.equal(await btn.isDisabled(), true);
    await nudge(d, 'A');
    assert.equal(await saveState(d), 'Unsaved changes');
    assert.equal(await d.dirty(), true);
    assert.equal(await btn.isEnabled(), true);
    await btn.click();
    await until(async () => (await saveState(d)) === 'Saved', 5000, 'Saved');
    const s = await saved(d);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0], await d.def());
    assert.ok(Designer.find(s[0], 'A').x > 10);
    assert.equal(await d.dirty(), false);
    assert.equal(await btn.isDisabled(), true);
    d.expectClean();
  });

  test('Ctrl+S saves (from the canvas and from an Inspector field)', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await nudge(d, 'A');
    await d.press('ControlOrMeta+s');
    await until(async () => (await saved(d)).length === 1, 5000, 'save');
    assert.equal(await saveState(d), 'Saved');
    // typing in the report name, then Ctrl+S in that field
    const nameBox = d.page.getByRole('textbox', { name: 'Report name' });
    await nameBox.fill('Renamed');
    assert.equal(await saveState(d), 'Unsaved changes');
    await nameBox.press('ControlOrMeta+s');
    await until(async () => (await saved(d)).length === 2, 5000, 'second save');
    assert.equal((await saved(d))[1].name, 'Renamed');
    assert.equal(await saveState(d), 'Saved');
    d.expectClean();
  });

  test('read-only: Ctrl+S does not call onSave', async () => {
    const d = await env.open(report([tb('A', 10, 10)]), { readOnly: true });
    assert.equal(await d.page.getByTestId('save').count(), 0);
    await d.focusCanvas();
    await d.press('ControlOrMeta+s');
    await d.page.waitForTimeout(200);
    assert.deepEqual(await saved(d), []);
    d.expectClean();
  });

  test('undo back to the saved state still counts as unsaved (no compare); a save clears it', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await nudge(d, 'A');
    await d.undo();
    assert.equal((await d.get('A')).x, 10);
    assert.equal(await d.dirty(), true);
    await d.press('ControlOrMeta+s');
    await until(async () => !(await d.dirty()), 5000, 'saved');
    d.expectClean();
  });

  test('onDirtyChange is told when changes come and go; isDirty agrees', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    // mount again in the same element with onDirtyChange (the harness mount has none)
    await d.page.evaluate(
      async (def) => {
        window.h.unmount();
        const { mountDesigner } = await import('/pw/designer.js');
        window.__dirty = [];
        window.h = mountDesigner('#d', {
          definition: def,
          fontsUrl: '/pw-fonts/',
          height: '100vh',
          warnOnLeave: false,
          onSave: (x) => {
            window.__saved.push(x);
          },
          onDirtyChange: (v) => {
            window.__dirty.push(v);
          },
        });
      },
      report([tb('A', 10, 10)]),
    );
    await d.item('A').waitFor();
    assert.deepEqual(await d.page.evaluate(() => window.__dirty), []);
    await nudge(d, 'A');
    await d.press('ArrowRight');
    assert.deepEqual(await d.page.evaluate(() => window.__dirty), [true], 'told once, not on every change');
    assert.equal(await d.dirty(), true);
    await d.press('ControlOrMeta+s');
    await until(async () => (await d.page.evaluate(() => window.__dirty)).length === 2, 5000, 'dirty false');
    assert.deepEqual(await d.page.evaluate(() => window.__dirty), [true, false]);
    assert.equal(await d.dirty(), false);
    await d.page.evaluate(() => window.h.save());
    assert.deepEqual(
      await d.page.evaluate(() => window.__dirty),
      [true, false],
      'a save with nothing changed tells nothing',
    );
    d.expectClean();
  });

  test('a host onDirtyChange that throws is reported, the designer keeps working', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await d.page.evaluate(
      async (def) => {
        window.h.unmount();
        const { mountDesigner } = await import('/pw/designer.js');
        window.h = mountDesigner('#d', {
          definition: def,
          fontsUrl: '/pw-fonts/',
          height: '100vh',
          warnOnLeave: false,
          onSave: (x) => {
            window.__saved.push(x);
          },
          onDirtyChange: () => {
            throw new Error('host boom');
          },
        });
      },
      report([tb('A', 10, 10)]),
    );
    await d.item('A').waitFor();
    await nudge(d, 'A');
    assert.ok((await d.get('A')).x > 10);
    d.expectClean([/host boom/]);
  });
});

describe('Ctrl+S while a dialog is open', () => {
  const addParam = async (d) => {
    await d.page.locator('.pane h4', { hasText: 'Parameters' }).getByRole('button', { name: '+ Add' }).click();
    return d.page.locator('.dialog').last();
  };

  test('a valid dialog is saved first, then the report (with what the dialog holds)', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    const dlg = await addParam(d);
    await dlg.locator('input').first().fill('region');
    await d.press('ControlOrMeta+s');
    await dlg.waitFor({ state: 'detached' });
    await until(async () => (await saved(d)).length === 1, 5000, 'save');
    const s = (await saved(d))[0];
    assert.deepEqual(
      (s.parameters || []).map((p) => p.name),
      ['region'],
    );
    assert.equal(await saveState(d), 'Saved');
    d.expectClean();
  });

  test('an invalid dialog: nothing is saved, the dialog stays, a message says why', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await nudge(d, 'A');
    const dlg = await addParam(d); // no name yet: its Save is disabled
    assert.equal(await dlg.locator('footer .btn.primary').isDisabled(), true);
    await d.press('ControlOrMeta+s');
    await d.page.locator('.dmsg .err').waitFor();
    assert.ok((await d.page.locator('.dmsg .err').innerText()).length > 0);
    assert.equal(await dlg.isVisible(), true);
    await d.page.waitForTimeout(150);
    assert.deepEqual(await saved(d), []);
    assert.equal(await saveState(d), 'Unsaved changes');
    // fixed, then Ctrl+S again works
    await dlg.locator('input').first().fill('ok_name');
    await d.press('ControlOrMeta+s');
    await until(async () => (await saved(d)).length === 1, 5000, 'save');
    assert.deepEqual(
      (await saved(d))[0].parameters.map((p) => p.name),
      ['ok_name'],
    );
    d.expectClean();
  });

  test('a dialog without a primary button (shortcuts): Ctrl+S saves the report, the dialog stays', async () => {
    const d = await env.open(report([tb('A', 10, 10)]));
    await nudge(d, 'A');
    await d.press('?');
    const dlg = d.page.locator('.dialog').last();
    await dlg.waitFor();
    await d.press('ControlOrMeta+s');
    await until(async () => (await saved(d)).length === 1, 5000, 'save');
    assert.equal(await dlg.isVisible(), true);
    d.expectClean();
  });
});
