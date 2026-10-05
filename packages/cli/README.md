# @pagewrightjs/cli

`pw`: render, test and diff Pagewright reports from the command line (no server). Fonts come from `@pagewrightjs/fonts`.

```bash
npx -p @pagewrightjs/cli pw render statement.pw.json -p accountId=LN-1 -d loans=data.json -f pdf -o statement.pdf
npx -p @pagewrightjs/cli pw test reports        # snapshot tests for reports-as-code
```

MIT.
