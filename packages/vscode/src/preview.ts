// The preview webview's page. Strict CSP: one nonce'd script (the viewer bundle shipped with the extension and the
// inline mount script), no remote loads; fonts and the PDF subsetter come from the extension's own folder.

export interface PreviewPage {
  nonce: string;
  /** webview.cspSource: the extension's resource origin */
  cspSource: string;
  viewerSrc: string;
  /** the webview URL of the bundled fonts folder, with a trailing slash */
  fontsUrl: string;
  /** origin of reportwright.baseUrl, when set: the only remote origin the page may call */
  connectOrigin?: string;
}

export function previewCsp(p: PreviewPage): string {
  const connect = [p.cspSource, p.connectOrigin].filter(Boolean).join(' ');
  return [
    "default-src 'none'",
    `img-src ${p.cspSource} data: blob:`,
    `style-src ${p.cspSource} 'unsafe-inline'`,
    `font-src ${p.cspSource} data:`,
    `script-src 'nonce-${p.nonce}' ${p.cspSource} 'wasm-unsafe-eval'`,
    `connect-src ${connect}`,
    'worker-src blob:',
  ].join('; ');
}

export function previewHtml(p: PreviewPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${previewCsp(p)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body, #host { height: 100%; margin: 0; }
  body { background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-foreground, #ccc); font: 13px var(--vscode-font-family, sans-serif); }
  #host { overflow: hidden; }
  #notice { padding: 16px; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="host"><div id="notice">Loading the preview…</div></div>
<script nonce="${p.nonce}" src="${p.viewerSrc}"></script>
<script nonce="${p.nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  var FONTS = ${JSON.stringify(p.fontsUrl)};
  var host = document.getElementById('host');
  function notice(text) { host.replaceChildren(); var n = document.createElement('div'); n.id = 'notice'; n.textContent = text; host.appendChild(n); }
  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    if (m.type === 'error') return notice(m.message);
    if (m.type !== 'render') return;
    if (!window.ReportWright || !window.ReportWright.mountViewer) return notice('The viewer did not load.');
    host.replaceChildren();
    var target = document.createElement('div');
    target.style.height = '100%';
    host.appendChild(target);
    try {
      Promise.resolve(window.ReportWright.mountViewer(target, {
        definition: m.definition, data: m.data || undefined, fontsUrl: FONTS, server: m.server || undefined,
        title: m.title || undefined, height: '100%', showWarnings: true, lang: 'en'
      })).catch(function (e) { notice(String((e && e.message) || e)); });
    } catch (e) { notice(String((e && e.message) || e)); }
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>
`;
}
