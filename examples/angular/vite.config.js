import { defineConfig } from 'vite';
export default defineConfig({ server: { fs: { allow: ['..'] } } }); // the shared report.pw.json and data.json one folder up
