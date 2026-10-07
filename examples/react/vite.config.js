import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { fs: { allow: ['..'] } } }); // the shared report.pw.json and data.json one folder up
