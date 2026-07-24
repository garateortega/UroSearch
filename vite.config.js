import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // ── PWA / offline (app-shell) ─────────────────────────────────────────────
    // Genera un service worker en la RAÍZ (scope "/") que precachea el build,
    // de modo que la app ABRE sin conexión. Es independiente del SW de push
    // (public/push/sw.js, scope "/push/"): distinto scope y distinta ruta, no
    // chocan, y las notificaciones siguen igual.
    VitePWA({
      registerType: 'autoUpdate',   // trae la versión nueva y recarga solo
      injectRegister: 'auto',       // inyecta el registro del SW en index.html
      manifest: false,              // NO tocar tu manifest actual (APK/TWA)
      workbox: {
        // Precachea el app-shell. Se excluye la carpeta /push para no
        // interferir con el service worker de notificaciones.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,ttf}'],
        globIgnores: ['**/push/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/push\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // Mascota / imágenes de /uros/ e /icons/ que se sirvan en runtime.
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              (url.pathname.startsWith('/uros/') || url.pathname.startsWith('/icons/')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'uro-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      // El proxy de Supabase/IA NO se cachea aquí: los datos offline los
      // maneja la app con offlineCache.js (más preciso que cachear HTTP crudo).
      devOptions: { enabled: false }, // ponlo en true si quieres probar en `npm run dev`
    }),
  ],
})
