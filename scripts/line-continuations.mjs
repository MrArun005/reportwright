// esbuild's lineLimit (scripts/embed-options.mjs, build-packages.mjs) keeps lines short for the package scanner by
// splitting long string literals with a backslash line continuation: "Ar\<newline>menian". That is valid JavaScript, but
// a Vite 7 production build turned one into a tab in the render worker, so /\p{Script=Armenian}/u threw. Here each
// continuation becomes a concatenation on the same lines: ("Ar"+<newline>"menian"); a template's becomes ${<newline>""}.
// fixDist rewrites every .js/.mjs under a folder and fails the build if one is left.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** the offsets of the backslashes that start a continuation inside a literal's raw text */
const inRaw = (raw) => { const at = []; for (let i = 0; i < raw.length; i++) if (raw[i] === '\\') { if (raw[i + 1] === '\n') at.push(i); i++; } return at; };
const TEMPLATE = new Set([ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail]);
/** each string or template literal holding a continuation: { node, start, raw, at } */
function literals(code) {
  const sf = ts.createSourceFile('x.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.StringLiteral || TEMPLATE.has(n.kind)) {
      const start = n.getStart(sf), raw = code.slice(start, n.end), at = inRaw(raw);
      if (at.length) found.push({ node: n, start, raw, at });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
/** where the continuations are, as "line:column" (1-based); [] when there are none */
export const findContinuations = (code) => literals(code).flatMap(({ start, at }) => at.map((a) => { const before = code.slice(0, start + a).split('\n'); return `${before.length}:${before.at(-1).length + 1}`; }));

const KEY = new Set([ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.PropertyDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor, ts.SyntaxKind.BindingElement]);
/** the code with every continuation in a literal rewritten; the line count stays the same */
export function splitContinuations(code) {
  let out = code;
  for (const { node, start, raw, at } of literals(code).reverse()) {
    const p = node.parent;
    let to;
    if (TEMPLATE.has(node.kind)) {
      const tag = node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ? p : node.kind === ts.SyntaxKind.TemplateHead ? p.parent : p.parent.parent;
      if (tag.kind === ts.SyntaxKind.TaggedTemplateExpression) throw new Error('a line continuation in a tagged template: its raw text would change');
      to = at.reduceRight((s, a) => `${s.slice(0, a)}\${\n""}${s.slice(a + 2)}`, raw);
    } else {
      const q = raw[0], pieces = [];
      let from = 1;
      for (const a of at) { pieces.push(raw.slice(from, a)); from = a + 2; }
      pieces.push(raw.slice(from, -1));
      const cat = `(${pieces.map(s => q + s + q).join('+\n')})`;
      if ((KEY.has(p.kind) && (p.name === node || p.propertyName === node))) to = `[${cat}]`;
      else if (ts.isExpressionStatement(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isExternalModuleReference(p) || p.kind === ts.SyntaxKind.ImportAttribute) throw new Error(`a line continuation in a string that cannot be an expression (${ts.SyntaxKind[p.kind]})`);
      else to = cat;
    }
    out = out.slice(0, start) + to + out.slice(start + raw.length);
  }
  return out;
}
/** rewrites every .js/.mjs under dir; throws, naming the file and line, if a continuation is left */
export function fixDist(dir) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
  for (const f of walk(dir)) {
    const code = fs.readFileSync(f, 'utf8');
    if (!code.includes('\\\n')) continue;
    const fixed = splitContinuations(code);
    const left = findContinuations(fixed);
    if (left.length) throw new Error(`${f}: a backslash line continuation in a string at ${left.join(', ')}`);
    if (fixed !== code) fs.writeFileSync(f, fixed);
  }
}
