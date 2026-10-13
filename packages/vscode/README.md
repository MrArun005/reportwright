# ReportWright for VS Code

Write and check [ReportWright](https://github.com/MrArun005/reportwright) reports (`*.pw.json`) in VS Code: autocomplete and errors from the report schema, validation in the Problems panel, a live preview, and render to PDF, Excel, Word or HTML without leaving the editor.

## Features

- **Schema.** `*.pw.json` files get the ReportWright report schema: completion, hover and errors while you type.
- **Validation.** The engine's `validate()` runs 400 ms after you stop typing (and on save). Errors and warnings land in the Problems panel with ranges, including "did you mean" suggestions for misspelled properties.
- **Live preview.** `ReportWright: Open Preview` (editor title button, or the command palette) opens the report beside the editor and re-renders it as you type. The viewer ships inside the extension; nothing is loaded from the network.
- **Render.** `ReportWright: Render to PDF / Excel / Word / HTML` writes `<name>.<ext>` next to the report. A `<name>.data.json` beside the report supplies its data (keyed by data source name, like the viewer's `data` option).
- **Import.** `ReportWright: Import SSRS / JasperReports / BIRT File…` converts a `.rdl`, `.rdlc`, `.rds`, `.jrxml` or `.rptdesign` file into `<name>.pw.json` and writes the import notes (what was mapped, approximated or dropped) to the ReportWright output channel.
- **Snippet.** Type `rw-report` in a JSON file for a blank report.

![Editing with schema completion and validation](images/GIF-PLACEHOLDER-edit.gif)
<!-- GIF placeholder: schema completion and a did-you-mean warning in the Problems panel. Recording pending. -->

![Live preview beside the editor](images/GIF-PLACEHOLDER-preview.gif)
<!-- GIF placeholder: the preview re-rendering after an edit. Recording pending. -->

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `reportwright.baseUrl` | empty | Base URL of a ReportWright server (for example `http://localhost:3000`). Relative data URLs in previews (such as `/api/sample`) resolve against it. Empty: previews run without a server, and data sources that need one show the viewer's message. |

## Limits

- ActiveReports (`.rpx`) is not importable yet; the importer covers SSRS, JasperReports and BIRT.
- Fonts: the extension bundles the Inter family (regular, bold, italic, bold italic). Reports that use other scripts or families fall back to Inter with the engine's warning. CJK text needs `@reportwright/fonts-cjk`, which the extension does not bundle.
- The preview is one viewer per report; editing re-renders the whole report.

## Development

```sh
# from the repository root
npm ci                      # the engine is bundled from this repository's source
cd packages/vscode
npm install
npm run build               # dist/: extension, engine, viewer, fonts, schema, snippet
npm run compile             # type check and compile the tests
npm test                    # headless VS Code (Linux: xvfb-run -a npm test)
npm run package             # reportwright-vscode.vsix
```

Install the package locally:

```sh
code --install-extension reportwright-vscode.vsix
```

CI (`.github/workflows/vscode.yml`) runs the same steps and uploads the `.vsix` as the `reportwright-vscode-vsix` artifact.

## Publishing (not automated)

Publishing needs your publisher accounts, so CI never publishes. Once per publisher:

1. **VS Code Marketplace.** Create the publisher `reportwright` at https://marketplace.visualstudio.com/manage, then create an Azure DevOps personal access token with the **Marketplace (Manage)** scope, for the organization of your choice.
2. **Open VSX.** Create the namespace `reportwright` at https://open-vsx.org and create an access token under your profile settings.

To publish a release (from `packages/vscode`, after `npm run build`):

```sh
npx @vscode/vsce login reportwright        # paste the Marketplace PAT once
npx @vscode/vsce publish --no-dependencies # or: npx @vscode/vsce publish 0.1.0
npx ovsx publish reportwright-vscode.vsix -p <OPEN_VSX_TOKEN>
```

Set `publisher` in `package.json` to the real publisher id first, and add an `icon` (128×128 PNG) before the first Marketplace release. Both stores reject a release whose version already exists, so bump `version` and `CHANGELOG.md` together.

## License

MIT. See [LICENSE](LICENSE).
