<script>
  import { pagewrightViewer } from '@pagewrightjs/svelte';
  import definition from '../../report.pw.json';
  import orders from '../../data.json';
</script>

<div use:pagewrightViewer={{ definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '760px' }}></div>
