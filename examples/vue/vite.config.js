import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: { fs: { allow: ['..'] } } }); // the shared report.pw.json and data.json one folder up
