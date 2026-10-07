# @reportwright/cli

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fcli)](https://www.npmjs.com/package/@reportwright/cli) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/cli)](https://socket.dev/npm/package/@reportwright/cli) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

`pw`: render, test and diff ReportWright reports from the command line (no server). Fonts come from `@reportwright/fonts`.

```bash
npx -p @reportwright/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @reportwright/cli pw test reports        # snapshot tests for reports-as-code
npx -p @reportwright/cli pw import invoice.jrxml   # JasperReports, SSRS (.rdl) or BIRT → invoice.pw.json
```

The package is the report commands only (render, test, diff, import): no server code, no child processes, and it
reads no environment variables. `pw audit` and `pw migrate-storage` work on a ReportWright server's storage, so they run
from the app folder (`node bin/pw.mjs audit verify`).

MIT.
