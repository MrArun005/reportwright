# QA suite

One command runs the whole QA suite on GitHub Actions and prints the results in your terminal:

```bash
npm run qa -- all                                  # every suite, quick tier, on the default branch
npm run qa -- correctness,compat --tier full       # some suites, full tier
npm run qa -- all --ref my-branch                  # test another branch (qa.yml must exist on it)
npm run qa -- all --no-wait                        # dispatch, print the run URL, return
```

`scripts/qa.mjs` (no dependencies; needs an authenticated `gh`) dispatches `.github/workflows/qa.yml`, prints one
progress line per suite every 30 s, downloads the `qa-report` artifact, prints each suite's table and exits 1 when any
check FAILed. The same report is in the run's summary page and in the artifact as `summary.md`, `results.json` and a
self-contained `report.html`.

## Suites

| Suite | Workflow | What it checks |
|---|---|---|
| correctness | `qa-correctness.yml` | vitest (the two invocations of ci.yml, with Postgres/MySQL/SQL Server), report snapshots (`pw test reports`), typecheck, the full writer parity gate (`scripts/writer-parity.mjs --baseline pdflib --corpus scripts/parity-corpus.mjs`) on poppler pinned to `scripts/parity-tolerance.json` (conda-forge via micromamba), every repository report exported to pdf/xlsx/docx/pptx/html/csv and validated (`qpdf --check`, `unzip -t`) |
| conformance | `qa-conformance.yml` | veraPDF (container) on PDF/A-2b, PDF/A-2a and PDF/UA-1 of every report; a signed PDF verified by `pdfsig` and pyHanko; encrypted PDFs open in qpdf with their password and refuse without; Factur-X XSD (SKIP while the repo has no Factur-X output) |
| compat | `qa-compat.yml` | the packed engine/fonts/cli installed into a fresh app on ubuntu/macos/windows x Node 22 (quick) or 20/22/24 (full, and on push), rendering PDF and xlsx; Vite (`tests/e2e/vite-build.mjs`), React wrapper, webpack 5 and Next.js builds; Chromium, Firefox and WebKit open the viewer and export a PDF (`tests/e2e/browsers.mjs`), plus the server-less standalone viewer in Chromium |
| pdf-libs, engines, rival-best | `qa-pdf-libs.yml`, `qa-engines.yml`, `qa-rival-best.yml` | comparisons against other PDF libraries and report engines (owned separately) |
| stress, load, security | `qa-stress.yml`, `qa-load.yml`, `qa-security.yml` | stress, load and security (owned separately) |

The sample data the repository's reports read (`/api/sample/*`) is served without the app by
`node scripts/qa.mjs sample-server 3999`; render with `--base http://127.0.0.1:3999 --allow-internal`.

## The contract (every `qa-<suite>.yml` follows it)

1. **Triggers:** `workflow_call` and `workflow_dispatch`, both with inputs `ref` (string, default `''` = the run's
   commit) and `tier` (string, default `quick`; `full` may add matrix cells or bigger inputs), plus `push` to the
   suite's own branch so it can be tested before `qa.yml` calls it. Check out with `ref: ${{ inputs.ref }}`.
2. **Checks:** run each check through `node scripts/qa.mjs check <suite> "<check>" "<expected>" "<shell command>"`
   (exit 0 = PASS, else FAIL; `--warn` turns a failure into WARN) or record `node scripts/qa.mjs skip <suite> "<check>" "<reason>"`.
   Each appends a row `{suite, check, command, expected, actual, result, ms}` to `qa-out/<suite>-<QA_SHARD>.jsonl`
   (`mb` may be added by suites that measure memory). Set `QA_SHARD` per matrix cell.
3. **Job summary:** each job ends with `node scripts/qa.mjs summarize <suite>` (`if: always()`), which writes the table
   `Check | Command | Expected | Actual (trimmed) | Result` and the line `SUITE <name>: x PASS, y FAIL, z WARN, w SKIP`
   to `$GITHUB_STEP_SUMMARY` and fails the job on any FAIL.
4. **Artifacts:** shard jobs upload `qa-out/*.jsonl` as `qa-<suite>-part-<shard>`; a final `results` job
   (`needs` all shards, `if: always()`) downloads `qa-<suite>-part-*` (merge-multiple), runs
   `node scripts/qa.mjs summarize <suite> parts` and uploads `qa-out/results.json` + `qa-out/summary.md` as
   **`qa-<suite>-results`** (one artifact per suite; `qa.yml` downloads `qa-*-results`).
5. **Speed:** shard with matrices (`fail-fast: false`), cache toolchains (`setup-node` `cache: npm`, `setup-python`
   `cache: pip`, `setup-micromamba` `cache-environment`).

## Adding a suite

1. Write `.github/workflows/qa-<name>.yml` to the contract above; push it to its branch and get it green (or reporting
   real FAILs).
2. Add a job to `qa.yml` (`uses: ./.github/workflows/qa-<name>.yml`, the same `if:` pattern), add it to `aggregate.needs`,
   and add the name to `SUITES` in `scripts/qa.mjs`.

`qa.yml` references every suite file by path; a `uses:` of a file missing on the branch fails the whole run, so
`qa.yml` is merged after the suite workflows it calls.
