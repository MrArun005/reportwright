#!/usr/bin/env node
// npm create reportwright@latest [dir] -- [--template <name>] [--yes]
import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, DESCRIPTIONS, USAGE, parseArgs, pickTemplate, create, nextSteps } from './create.mjs';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const templatesDir = fileURLToPath(new URL('../templates/', import.meta.url));
try {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(USAGE); process.exit(0); }
  const ask = !o.yes && process.stdin.isTTY;
  const rl = ask ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  let dir = o.dir;
  if (!dir) dir = (rl ? (await rl.question('Folder (my-reports): ')).trim() : '') || 'my-reports';
  let template = o.template;
  while (!template) {
    if (!rl) { template = TEMPLATES[0]; break; }
    template = pickTemplate(await rl.question(`Template:\n${TEMPLATES.map((t, i) => `  ${i + 1}. ${t.padEnd(8)} ${DESCRIPTIONS[t]}`).join('\n')}\nPick 1-${TEMPLATES.length} (1): `));
  }
  rl?.close();
  create({ dir, template, version, templatesDir });
  console.log(`Created ${dir} (${template}, @reportwright/* ${version})${nextSteps(dir, template)}`);
} catch (e) {
  console.error(`create-reportwright: ${e.message}`);
  process.exit(1);
}
