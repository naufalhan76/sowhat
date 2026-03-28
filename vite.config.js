import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: path.resolve(__dirname, 'web-dist'),
    emptyOutDir: true,
  },
});
