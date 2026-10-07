# @pagewrightjs/vue

[![npm](https://img.shields.io/npm/v/%40pagewrightjs%2Fvue)](https://www.npmjs.com/package/@pagewrightjs/vue) [![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/MrArun005/pagewright/blob/main/LICENSE) [![Socket](https://socket.dev/api/badge/npm/package/@pagewrightjs/vue)](https://socket.dev/npm/package/@pagewrightjs/vue) [![provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

The Pagewright viewer and designer as Vue 3 components. Vue is a peer dependency; the viewer loads on mount (SSR-safe).

```vue
<script setup>
import { PagewrightViewer, PagewrightDesigner } from '@pagewrightjs/vue';
</script>
<template>
  <PagewrightViewer :options="{ server: 'https://reports.example.com', report: 'invoice', params: { id: '42' } }" />
  <PagewrightDesigner :options="{ server, definition, onSave: save }" @ready="(h) => (designer = h)" />
</template>
```

`options` are those of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`). MIT.
