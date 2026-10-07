import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({ plugins: [svelte()], server: { fs: { allow: ['..'] } } }); // the shared report.pw.json and data.json one folder up
