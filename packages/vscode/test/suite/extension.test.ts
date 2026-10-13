import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXT_ID = 'reportwright.reportwright-vscode';
const ext = vscode.extensions.getExtension(EXT_ID)!;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-vscode-'));
// the repository's own report fixtures (the extension lives in packages/vscode)
const fixtures = path.resolve(ext?.extensionPath ?? '.', '..', '..', 'tests', 'fixtures');
let api: { testing: { previewStatus: (uri: vscode.Uri) => { viewerReady: boolean; pages?: number; errors: string[]; cspViolations: string[] } | undefined } };

/** Polls until fn returns a truthy value (diagnostics and files appear asynchronously). */
async function waitFor<T>(fn: () => T | undefined | false, what: string, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

suite('ReportWright extension', () => {
  suiteSetup(async () => {
    assert.ok(ext, `${EXT_ID} is installed in the test host`);
    api = (await ext.activate()) as typeof api;
  });

  test('associates *.pw.json with the bundled report schema', async () => {
    const entry = ext.packageJSON.contributes.jsonValidation.find((j: { fileMatch: string }) => j.fileMatch === '*.pw.json');
    assert.ok(entry, 'a jsonValidation entry for *.pw.json');
    const schema = JSON.parse(fs.readFileSync(path.join(ext.extensionPath, entry.url), 'utf8'));
    assert.strictEqual(schema.title, 'ReportWright report definition');
    const file = path.join(dir, 'schema-check.pw.json');
    fs.writeFileSync(file, '{}\n');
    const doc = await vscode.workspace.openTextDocument(file);
    assert.strictEqual(doc.languageId, 'json', 'reports stay JSON, so the JSON language service applies the schema');
  });

  test('reports a misspelled property with a did-you-mean warning in the Problems panel', async () => {
    const file = path.join(dir, 'typo.pw.json');
    fs.writeFileSync(file, '{\n  "$schema": "reportwright/report@1",\n  "sectons": {},\n  "sections": { "body": [] }\n}\n');
    const uri = vscode.Uri.file(file);
    await vscode.workspace.openTextDocument(uri);
    const found = await waitFor(() => {
      const d = vscode.languages.getDiagnostics(uri).find((x) => x.message.includes('did you mean "sections"'));
      return d;
    }, 'a did-you-mean diagnostic');
    assert.strictEqual(found.severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(found.range.start.line, 2, 'the range is on the misspelled key');
    assert.strictEqual(found.source, 'ReportWright');
  });

  test('renders a report to PDF next to the file', async () => {
    const { blankReport } = require(path.join(ext.extensionPath, 'dist', 'engine.js'));
    const file = path.join(dir, 'ok.pw.json');
    fs.writeFileSync(file, JSON.stringify(blankReport(), null, 2));
    const uri = vscode.Uri.file(file);
    await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('reportwright.renderPdf', uri);
    const pdf = path.join(dir, 'ok.pdf');
    assert.ok(fs.existsSync(pdf), 'ok.pdf was written');
    assert.strictEqual(fs.readFileSync(pdf).subarray(0, 5).toString('latin1'), '%PDF-', 'a PDF file');
  });

  test('imports an SSRS .rdl file to .pw.json beside it', async () => {
    const src = path.join(fixtures, 'rdl', 'kitchen-sink.rdl');
    const file = path.join(dir, 'kitchen-sink.rdl');
    fs.copyFileSync(src, file);
    await vscode.commands.executeCommand('reportwright.importReport', vscode.Uri.file(file));
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'kitchen-sink.pw.json'), 'utf8'));
    assert.ok(out.sections?.body, 'the imported report has a body section');
  });

  test('imports an ActiveReports .rdlx-json file to .pw.json beside it', async () => {
    const file = path.join(dir, 'invoice.rdlx-json');
    fs.copyFileSync(path.join(fixtures, 'rdlx', 'invoice.rdlx-json'), file);
    await vscode.commands.executeCommand('reportwright.importReport', vscode.Uri.file(file));
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'invoice.pw.json'), 'utf8'));
    assert.ok(out.sections?.body, 'the imported report has a body section');
  });

  test('the preview mounts the viewer, which reports ready, with no CSP violation', async function () {
    this.timeout(60_000);
    const { blankReport } = require(path.join(ext.extensionPath, 'dist', 'engine.js'));
    const file = path.join(dir, 'preview.pw.json');
    fs.writeFileSync(file, JSON.stringify(blankReport(), null, 2));
    const uri = vscode.Uri.file(file);
    await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('reportwright.openPreview', uri);
    const st = await waitFor(() => {
      const s = api.testing.previewStatus(uri);
      return s && (s.viewerReady || s.errors.length || s.cspViolations.length) ? s : undefined;
    }, 'the viewer to report ready', 50_000);
    assert.deepStrictEqual(st.errors, [], 'no viewer error');
    assert.deepStrictEqual(st.cspViolations, [], 'no CSP violation in the webview');
    assert.ok(st.viewerReady, 'the viewer reported ready');
  });
});
