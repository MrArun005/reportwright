# @pagewrightjs/react

The Pagewright viewer and designer as React components. React is a peer dependency; the viewer loads on mount, so it is safe in server-rendered apps (Next.js, Remix).

```jsx
import { PagewrightViewer, PagewrightDesigner } from '@pagewrightjs/react';

<PagewrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} style={{ height: 720 }} />
<PagewrightDesigner server="https://reports.example.com" definition={def} onSave={(d) => save(d)} toolbox={{ hide: ['map'] }} />
```

Props are the options of `mountViewer` / `mountDesigner` (see `@pagewrightjs/viewer`), plus `className`, `style` and `onReady(handle)`. The viewer remounts when what it shows changes; the designer only for a new `report` or `definition` object, so it keeps its edits. MIT.
