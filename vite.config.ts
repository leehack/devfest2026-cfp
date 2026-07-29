import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

import { robotsTxt } from './shared/seo';

/**
 * Emits `robots.txt` as a file rather than serving it from `cfpPage`.
 *
 * It cannot come from the function: the Cloud Functions runtime answers
 * `/robots.txt` and `/favicon.ico` itself, with an empty 404, before any
 * handler runs — in the emulator and in production alike. Generated here rather
 * than checked in so the rules stay in `shared/seo.ts` with their test.
 */
const robots = (): Plugin => ({
  name: 'emit-robots-txt',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt() });
  },
});

export default defineConfig({
  plugins: [react(), robots()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // Hosting free tier is 360 MB/day of transfer (§2). Splitting the Firebase
    // SDK out keeps the app chunk small on repeat visits.
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
        },
      },
    },
  },
});
