<script>
  import { reportWrightViewer } from '@reportwright/svelte';
  import definition from '../../report.pw.json';
  import orders from '../../data.json';
</script>

<div use:reportWrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '760px' }}></div>
