# @pagewrightjs/cli

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fcli)](https://www.npmjs.com/package/@pagewrightjs/cli) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/cli)](https://socket.dev/npm/package/@pagewrightjs/cli) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

`pw`: render, test and diff Pagewright reports from the command line (no server). Fonts come from `@pagewrightjs/fonts`.

```bash
npx -p @pagewrightjs/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @pagewrightjs/cli pw test reports        # snapshot tests for reports-as-code
npx -p @pagewrightjs/cli pw import invoice.jrxml   # JasperReports, SSRS (.rdl) or BIRT → invoice.pw.json
```

MIT.
