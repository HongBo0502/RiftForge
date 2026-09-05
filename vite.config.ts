/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only the apple-touch icon needs adding by hand; the plugin precaches
      // the manifest's own icons, so PNGs are excluded from globPatterns below
      // to avoid duplicate precache entries.
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Riftforge — Riftbound Cards & Simulator',
        short_name: 'Riftforge',
        description:
          'Riftbound card database and rules-enforced simulator. An unofficial fan project.',
        theme_color: '#0a0d13',
        background_color: '#0a0d13',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        /*
         * The card dataset is precached rather than fetched on demand, so the
         * whole database works offline. cards.json is ~965KB, above workbox's
         * 2MB default only in aggregate, so the cap is raised deliberately.
         */
        additionalManifestEntries: [
          { url: 'data/cards.json', revision: null },
          { url: 'data/sets.json', revision: null },
          { url: 'data/keywords.json', revision: null },
          { url: 'data/meta.json', revision: null },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            /*
             * Card art from Riot's CDN. Cache-first: the images are immutable
             * (the URL carries a content hash) and there are ~1451 of them, so
             * a browsed card stays available offline without a second fetch.
             */
            urlPattern: /^https:\/\/cmsassets\.rgpub\.io\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'riftbound-card-art',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5273 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
