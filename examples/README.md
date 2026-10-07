# Examples

Tiny apps that use the published packages (0.8.0) with no ReportWright server. Each shows `report.pw.json` with `data.json`.

| Folder | Run |
|---|---|
| `node` | `npm i && npm start` → orders.pdf, orders.xlsx |
| `react` | `npm i && npm run dev` (Vite) |
| `vue` | `npm i && npm run dev` (Vite) |
| `svelte` | `npm i && npm run dev` (Vite) |
| `angular` | `npm i && npm run dev` (Vite, Angular in JIT mode: no Angular CLI needed) |

The browser examples copy `@reportwright/fonts/public` to `public/pw` before they start (`predev`), and pass
`fontsUrl: '/pw/fonts/'`.
