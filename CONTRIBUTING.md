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

## Versioning (semver)

All `@reportwright/*` packages share one version and are released together.

- **Before 1.0** (now): a **minor** release (0.7 → 0.8) may change the public API; a **patch** release (0.8.0 → 0.8.1)
  only fixes bugs and adds nothing that breaks. Anything removed is first deprecated for one minor release, with a
  console warning that names the replacement (for example the positional `exportPdf(model, fontStore, opt)` form,
  deprecated in 0.8 and removed in 0.9).
- **From 1.0**: the usual rules. Breaking changes only in a major release.
- **The public API** is what `index.d.ts` / `report.d.ts` of each package declare, and the report JSON schema
  (`@reportwright/engine/schema.json`). A report that validates in a release keeps rendering the same in every later
  release of the same major version (older definitions are upgraded on load, `src/engine/schema/upgrade.js`).
- Every release has a CHANGELOG.md entry.
