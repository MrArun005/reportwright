# Contributing

Issues and pull requests are welcome at https://github.com/MrArun005/reportwright.

```bash
npm ci
npx vitest run --maxWorkers=4        # unit and engine tests
node bin/pw.mjs test reports         # report snapshot tests
npm run lint:engine && npm run typecheck
npm run build:packages               # builds packages/* (then: npm pack ./packages/engine)
```

Write the test first. One change per commit, with a plain message.

## Formatting

New and changed code is formatted with Prettier (`.prettierrc.json`: 120 columns, single quotes, semicolons).
The existing source predates this config and is **not** reformatted in bulk, so `git blame` keeps its history.

- `npm run format:check` checks only the files changed against `main` (set `FORMAT_BASE` for another base) and the
  untracked ones. It runs Prettier 3.6.2 through `npx`, so nothing extra is installed. Markdown is not checked.
- A new file is formatted from the start. When you change an older file that the check flags, format it in its own
  commit first (`npx prettier@3.6.2 --write <file>`, message "Format <file> with Prettier"), then make your change,
  so the reformat and the real change are separate in history.

## Versioning (semver)

All `@reportwright/*` packages share one version and are released together.

- **Before 1.0**: a **minor** release (0.7 → 0.8) may change the public API; a **patch** release (0.8.0 → 0.8.1)
  only fixes bugs and adds nothing that breaks. Anything removed is first deprecated for one minor release, with a
  console warning that names the replacement (for example the positional `exportPdf(model, fontStore, opt)` form,
  deprecated in 0.8 and removed in 0.9).
- **From 1.0** (now): the usual rules. Breaking changes only in a major release, after at least one minor release of
  deprecation; security fixes may change behaviour in a patch. What is covered: [docs/PUBLIC-API.md](docs/PUBLIC-API.md).
- **The public API** is what `index.d.ts` / `report.d.ts` of each package declare, and the report JSON schema
  (`@reportwright/engine/schema.json`). A report that validates in a release keeps rendering the same in every later
  release of the same major version (older definitions are upgraded on load, `src/engine/schema/upgrade.js`).
- Every release has a CHANGELOG.md entry.
