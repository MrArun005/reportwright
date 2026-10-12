import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import { diagnose } from './diagnostics';
import { previewHtml } from './preview';

// The engine (dist/engine.js) loads on first use: opening a JSON file must not pay for the renderer.
type Engine = typeof import('./engine');
let engineModule: Engine | undefined;
const engine = (): Engine => (engineModule ??= require(path.join(__dirname, 'engine.js')) as Engine);

const isReport = (doc: vscode.TextDocument) => doc.fileName.toLowerCase().endsWith('.pw.json');
const baseName = (file: string) => path.basename(file).replace(/\.pw\.json$/i, '');
const baseUrl = () => vscode.workspace.getConfiguration('reportwright').get<string>('baseUrl', '').trim();
let output: vscode.OutputChannel;
const diagnostics = vscode.languages.createDiagnosticCollection('reportwright');

/** The report in a document: the parsed JSON, or the reason it is not a report. */
function readReport(text: string): { def?: any; error?: string } {
  const errors: ParseError[] = [];
  const def = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) return { error: `The file is not valid JSON (${printParseErrorCode(errors[0].error)}).` };
  return { def };
}

/** The sibling <name>.data.json (keyed by data source name), if there is one. */
async function readData(file: string): Promise<any> {
  const sibling = path.join(path.dirname(file), `${baseName(file)}.data.json`);
  try { return JSON.parse((await fs.readFile(sibling, 'utf8')).replace(/^﻿/, '')); } catch { return undefined; }
}

function validateDocument(doc: vscode.TextDocument) {
  if (!isReport(doc)) return;
  try {
    const found = diagnose(doc.getText(), (def) => engine().validate(def));
    diagnostics.set(doc.uri, found.map((f) => {
      const d = new vscode.Diagnostic(new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end)), f.message,
        f.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = 'ReportWright';
      return d;
    }));
  } catch (e) {
    output.appendLine(`Validation failed for ${doc.fileName}: ${(e as Error).message}`);
  }
}

/** Debounced per document: diagnostics on change, 400 ms after the last keystroke. */
const timers = new Map<string, NodeJS.Timeout>();
function scheduleValidation(doc: vscode.TextDocument) {
  if (!isReport(doc)) return;
  const key = doc.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); validateDocument(doc); }, 400));
}

/** The report document a command acts on: the given URI, else the active editor. */
async function targetDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
  if (!doc || !isReport(doc)) { void vscode.window.showErrorMessage('ReportWright: open a *.pw.json report first.'); return undefined; }
  return doc;
}

// ---- preview ----
const previews = new Map<string, vscode.WebviewPanel>();

function openPreview(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  void (async () => {
    const doc = await targetDocument(uri);
    if (!doc) return;
    const key = doc.uri.toString();
    const existing = previews.get(key);
    if (existing) { existing.reveal(vscode.ViewColumn.Beside); return; }
    const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel('reportwright.preview', `Preview: ${baseName(doc.fileName)}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] });
    const base = baseUrl();
    let connectOrigin: string | undefined;
    try { if (base) connectOrigin = new URL(base).origin; } catch { output.appendLine(`reportwright.baseUrl is not a URL: ${base}`); }
    panel.webview.html = previewHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: panel.webview.cspSource,
      viewerSrc: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'reportwright-viewer.full.js')).toString(),
      fontsUrl: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'fonts')).toString() + '/',
      connectOrigin,
    });
    const send = async () => {
      const { def, error } = readReport(doc.getText());
      if (error) return panel.webview.postMessage({ type: 'error', message: error });
      const data = await readData(doc.uri.fsPath);
      void panel.webview.postMessage({ type: 'render', definition: def, data, title: def?.name, server: baseUrl() || undefined });
    };
    panel.webview.onDidReceiveMessage((m) => { if (m?.type === 'ready') void send(); });
    const timerKey = `preview:${key}`;
    const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== key) return;
      clearTimeout(timers.get(timerKey));
      timers.set(timerKey, setTimeout(() => void send(), 400));
    });
    panel.onDidDispose(() => { onChange.dispose(); clearTimeout(timers.get(timerKey)); previews.delete(key); });
    previews.set(key, panel);
  })();
}

// ---- render, import ----
async function renderCommand(format: 'pdf' | 'xlsx' | 'docx' | 'html', uri?: vscode.Uri) {
  const doc = await targetDocument(uri);
  if (!doc) return;
  const { def, error } = readReport(doc.getText());
  if (error) return void vscode.window.showErrorMessage(`ReportWright: ${error}`);
  const out = path.join(path.dirname(doc.uri.fsPath), `${baseName(doc.fileName)}.${format}`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `ReportWright: rendering ${format.toUpperCase()}…` }, async () => {
    try {
      const data = await readData(doc.uri.fsPath);
      const r = await engine().renderFile(format, def, data, baseUrl() || undefined);
      await fs.writeFile(out, r.bytes);
      if (r.warnings.length) { output.appendLine(`${doc.fileName} (${format}):`); r.warnings.forEach((w) => output.appendLine(`  ${w}`)); }
      // not awaited: the promise resolves only when the notification is clicked or dismissed, which would hold the command
      void vscode.window.showInformationMessage(`ReportWright: wrote ${path.basename(out)}`, 'Open')
        .then((open) => { if (open) void vscode.env.openExternal(vscode.Uri.file(out)); });
    } catch (e) {
      output.appendLine(`Render to ${format} failed: ${(e as Error).stack || e}`);
      void vscode.window.showErrorMessage(`ReportWright: the ${format.toUpperCase()} render failed: ${(e as Error).message}`);
    }
  });
}

async function importCommand() {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false, title: 'Import an SSRS, JasperReports or BIRT report',
    filters: { 'Report files': ['rdl', 'rdlc', 'rds', 'jrxml', 'rptdesign'] },
  });
  const file = picked?.[0];
  if (!file) return;
  const target = path.join(path.dirname(file.fsPath), `${baseName(file.fsPath).replace(/\.(rdl|rdlc|rds|jrxml|rptdesign)$/i, '')}.pw.json`);
  try {
    const r = engine().importReport(await fs.readFile(file.fsPath), path.basename(file.fsPath).replace(/\.[^.]+$/, ''));
    output.clear();
    output.appendLine(`Import notes for ${path.basename(file.fsPath)}:`);
    r.warnings.forEach((w) => output.appendLine(`  ${w}`));
    if (r.error || !r.definition) {
      output.show(true);
      return void vscode.window.showErrorMessage(`ReportWright: the import failed: ${r.error || 'no definition'}`);
    }
    let exists = false;
    try { await fs.access(target); exists = true; } catch { /* new file */ }
    if (exists && (await vscode.window.showWarningMessage(`${path.basename(target)} exists. Replace it?`, { modal: true }, 'Replace')) !== 'Replace') return;
    await fs.writeFile(target, JSON.stringify(r.definition, null, 2) + '\n');
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
    validateDocument(doc);
    output.show(true);
    void vscode.window.showInformationMessage(`ReportWright: imported to ${path.basename(target)} (${r.warnings.length} import note${r.warnings.length === 1 ? '' : 's'} in the output).`);
  } catch (e) {
    output.appendLine(`Import failed: ${(e as Error).stack || e}`);
    output.show(true);
    void vscode.window.showErrorMessage(`ReportWright: the import failed: ${(e as Error).message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('ReportWright');
  context.subscriptions.push(output, diagnostics);
  const reg = (id: string, fn: (uri?: vscode.Uri) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('reportwright.openPreview', (uri?: vscode.Uri) => openPreview(context, uri));
  reg('reportwright.validate', async (uri?: vscode.Uri) => {
    const doc = await targetDocument(uri);
    if (!doc) return;
    validateDocument(doc);
    const n = diagnostics.get(doc.uri)?.length ?? 0;
    void vscode.window.showInformationMessage(n ? `ReportWright: ${n} problem${n === 1 ? '' : 's'} in the Problems panel.` : 'ReportWright: no problems found.');
  });
  reg('reportwright.renderPdf', (uri?: vscode.Uri) => renderCommand('pdf', uri));
  reg('reportwright.renderXlsx', (uri?: vscode.Uri) => renderCommand('xlsx', uri));
  reg('reportwright.renderDocx', (uri?: vscode.Uri) => renderCommand('docx', uri));
  reg('reportwright.renderHtml', (uri?: vscode.Uri) => renderCommand('html', uri));
  reg('reportwright.importReport', () => importCommand());

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleValidation),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleValidation(e.document)),
    vscode.workspace.onDidSaveTextDocument(validateDocument),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
  );
  vscode.workspace.textDocuments.forEach(scheduleValidation);
}

export function deactivate() {
  for (const t of timers.values()) clearTimeout(t);
}
