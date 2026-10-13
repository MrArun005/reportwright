# Start a new app with create-reportwright

Make a working ReportWright app in one command, with a sample report and a viewer. Use it to try the library, or to start a new app from a template.

## In the UI

Not available in the UI.

## From the CLI

```bash
npm create reportwright@latest my-app
```

It asks which template to use. To skip the question:

```bash
npm create reportwright@latest my-app -- --template react --yes
```

- `my-app`: the new folder. It must be new or empty.
- `--template`: `node`, `react`, `vue`, `svelte` or `angular`.
- `--yes`: accept the defaults.

Then run it:

| Template | What you get | Run |
|---|---|---|
| `node` | a script that renders the sample report to PDF and Excel | `npm i && npm start` |
| `react` | React + Vite, the viewer showing the sample report | `npm i && npm run dev` |
| `vue` | Vue 3 + Vite, the viewer | `npm i && npm run dev` |
| `svelte` | Svelte + Vite, the viewer | `npm i && npm run dev` |
| `angular` | Angular (JIT) + Vite, the viewer | `npm i && npm run dev` |

## Through the API

Not available in the API.

## Notes

- Each app has `report.pw.json` (the report) and `data.json` (its data, inline: no server needed).
- The `@reportwright/*` packages are pinned to the version of `create-reportwright`.
- Needs Node 20.16 or later.
- To add the library to an app that exists: `npm i @reportwright/engine @reportwright/fonts` (render and export), or `npm i @reportwright/viewer @reportwright/fonts` (viewer and designer in a page), or `npm i -D @reportwright/cli @reportwright/fonts` (`pw`).
- For the viewer in your own app, see [embedding-the-viewer](embedding-the-viewer.md).
