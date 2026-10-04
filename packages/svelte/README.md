# @pagewright/svelte

Svelte actions for the Pagewright viewer and designer. Plain JavaScript, so no compiler step and any Svelte version.

```svelte
<script>
  import { pagewrightViewer, pagewrightDesigner } from '@pagewright/svelte';
</script>
<div use:pagewrightViewer={{ server: 'https://reports.example.com', report: 'invoice', params: { id } }}></div>
<div use:pagewrightDesigner={{ server, definition, onSave: save }}></div>
```

Options are those of `mountViewer` / `mountDesigner` (see `@pagewright/viewer`). MIT.
