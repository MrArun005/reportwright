# @reportwright/svelte

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fsvelte)](https://www.npmjs.com/package/@reportwright/svelte) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/svelte)](https://socket.dev/npm/package/@reportwright/svelte)

Svelte actions for the ReportWright viewer and designer. Plain JavaScript, so no compiler step and any Svelte version.

```svelte
<script>
  import { reportWrightViewer, reportWrightDesigner } from '@reportwright/svelte';
</script>
<div use:reportWrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/' }}></div>  <!-- no server -->
<div use:reportWrightViewer={{ server: 'https://reports.example.com', report: 'invoice', params: { id } }}></div>
<div use:reportWrightDesigner={{ server, definition, onSave: save }}></div>
```

Options are those of `mountViewer` / `mountDesigner` (see `@reportwright/viewer`). MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
