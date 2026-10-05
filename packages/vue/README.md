# @pagewrightjs/vue

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
