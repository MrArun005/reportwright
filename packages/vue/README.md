# @reportwright/vue

[![npm](https://img.shields.io/npm/v/%40reportwright%2Fvue)](https://www.npmjs.com/package/@reportwright/vue) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/reportwright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@reportwright/vue)](https://socket.dev/npm/package/@reportwright/vue)

The ReportWright viewer and designer as Vue 3 components. Vue is a peer dependency; the viewer loads on mount (SSR-safe).

```vue
<script setup>
import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/vue';
</script>
<template>
  <ReportWrightViewer :options="{ definition, data: { orders }, fontsUrl: '/pw/fonts/' }" />  <!-- no server -->
  <ReportWrightViewer :options="{ server: 'https://reports.example.com', report: 'invoice', params: { id: '42' } }" />
  <ReportWrightDesigner :options="{ server, definition, onSave: save }" @ready="(h) => (designer = h)" />
</template>
```

`options` are those of `mountViewer` / `mountDesigner` (see `@reportwright/viewer`). MIT.

No server needed: pass `definition`, `data` (JSON by data source name) and `fontsUrl` (a copy of `@reportwright/fonts/public/fonts`). `server` (the [self-hosted ReportWright server](https://github.com/MrArun005/reportwright#docker)) is optional: see [what works standalone](https://github.com/MrArun005/reportwright/tree/main/packages/viewer#what-works-standalone-what-needs-the-server).
