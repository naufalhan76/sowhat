import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const UI_PORT = Number(process.env.UI_PORT || 5173);
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: UI_PORT,
    proxy: {
      '/api': API_PROXY_TARGET
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'web-dist'),
    emptyOutDir: true,
  },
});

