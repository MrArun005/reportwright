# create-reportwright

Not published to npm yet: `npm create reportwright` returns 404, so the command below works only after the first release.

A working ReportWright app in one command:

```bash
npm create reportwright@latest my-app
```

It asks for a template, or pass it: `npm create reportwright@latest my-app -- --template react --yes`.

| Template | What you get | Run |
|---|---|---|
| `node` | a script that renders the sample report to PDF and Excel | `npm i && npm start` |
| `react` | React + Vite, the viewer showing the sample report | `npm i && npm run dev` |
| `vue` | Vue 3 + Vite, the viewer | `npm i && npm run dev` |
| `svelte` | Svelte + Vite, the viewer | `npm i && npm run dev` |
| `angular` | Angular (JIT) + Vite, the viewer | `npm i && npm run dev` |

Each app has `report.pw.json` (the report) and `data.json` (its data, inline: no server). The `@reportwright/*`
packages are pinned to this package's version. The target folder must be new or empty.

Zero dependencies; Node 20.16 or later. MIT.
