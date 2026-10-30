import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@backend': fileURLToPath(new URL('./src/backend', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
  },
});
