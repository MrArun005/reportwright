# @pagewrightjs/svelte

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fsvelte)](https://www.npmjs.com/package/@pagewrightjs/svelte) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/svelte)](https://socket.dev/npm/package/@pagewrightjs/svelte) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

Svelte actions for the Pagewright viewer and designer. Plain JavaScript, so no compiler step and any Svelte version.

```svelte
<script>
  import { pagewrightViewer, pagewrightDesigner } from '@pagewrightjs/svelte';
</script>
<div use:pagewrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/' }}></div>  <!-- no server -->
<div use:pagewrightViewer={{ server: 'https://reports.example.com', report: 'invoice', params: { id } }}></div>
<div use:pagewrightDesigner={{ server, definition, onSave: save }}></div>
```

Options are those of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`). MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@pagewrightjs/fonts/public/fonts`). `server` (the [self-hosted Pagewright server](https://github.com/MrArun005/pagewright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/pagewright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
