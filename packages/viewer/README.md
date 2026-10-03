# @pagewright/viewer

The Pagewright report viewer in any web app (React is bundled inside, in a shadow root, so your styles do not leak in):

```js
import { mountViewer } from '@pagewright/viewer';
mountViewer('#report', { server: 'https://reports.example.com', report: 'loan-statement', params: { accountId: 'LN-1' } });
```

The Pagewright server must allow your site's origin (`PW_EMBED_ORIGINS`). PDF export and barcodes load only when used. MIT.
