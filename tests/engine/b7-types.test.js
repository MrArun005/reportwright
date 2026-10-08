// B7 #9: the designer's onSave takes the report definition type (checked against the built viewer declarations).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = path.join(import.meta.dirname, '..', '..');
const designerDts = path.join(root, 'packages/viewer/dist/designer.d.ts');
const viewerDts = path.join(root, 'packages/viewer/dist/viewer.d.ts');

/** Type errors of a consumer snippet that imports the built designer types. */
function diagnosticsOf(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b7-types-'));
  const file = path.join(dir, 'consumer.ts');
  fs.writeFileSync(file, `import type { DesignerOptions } from ${JSON.stringify(designerDts)};\n${body}\n`);
  try {
    const program = ts.createProgram([file], {
      strict: true, noEmit: true, skipLibCheck: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, types: [],
      paths: { '@reportwright/engine/report': [path.join(root, 'packages/engine/report.d.ts')], '@reportwright/viewer': [viewerDts], '@reportwright/viewer/designer': [designerDts] },
      baseUrl: root,
    });
    return ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe.skipIf(!fs.existsSync(designerDts))('designer onSave type', () => {
  it('a handler that takes a number is a type error', () => {
    expect(diagnosticsOf('const o: DesignerOptions = { onSave: (d: number) => { void d; } };').length).toBeGreaterThan(0);
  });
  it('the handler receives the Report type: its $schema and name are typed', () => {
    expect(diagnosticsOf('const o: DesignerOptions = { onSave: (d) => { const s: "pagewright/report@1" | "reportwright/report@1" = d.$schema; const n: string | undefined = d.name; void s; void n; } };')).toEqual([]);
  });
});
