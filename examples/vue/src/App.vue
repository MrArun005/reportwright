<script setup>
import { ReportWrightViewer } from '@reportwright/vue';
import definition from '../../report.pw.json';
import orders from '../../data.json';
const options = { definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '760px' };
</script>

<template>
  <ReportWrightViewer :options="options" @error="(e) => console.error(e)" />
</template>
