<script setup>
import { PagewrightViewer } from '@pagewrightjs/vue';
import definition from '../../report.pw.json';
import orders from '../../data.json';
const options = { definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '760px' };
</script>

<template>
  <PagewrightViewer :options="options" @error="(e) => console.error(e)" />
</template>
