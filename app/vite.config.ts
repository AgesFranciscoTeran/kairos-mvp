import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * CSP solo en el build (en desarrollo React inyecta un script inline). `connect-src 'self'`
 * hace que el navegador rechace cualquier fetch/XHR/WebSocket a otro origen: la frontera de
 * privacidad no depende solo de que el código "no lo haga".
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'kairos-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// HTTPS local (`npm run dev:https`, modo "https") para probar DeviceMotion desde el teléfono
// en la misma red: DeviceMotion exige un contexto seguro.
export default defineConfig(({ mode }) => ({
  // rutas relativas: el mismo build sirve en la raíz (Netlify) o en /kairos-mvp/ (GitHub Pages)
  base: './',
  plugins: [
    react(),
    cspPlugin(),
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kairos MVP',
        short_name: 'Kairos',
        description: 'Ciclo de detección, intervención y recuperación de la activación fisiológica. Todo ocurre en el teléfono.',
        lang: 'es-EC',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a1410',
        theme_color: '#0a1410',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        navigateFallback: 'index.html',
        // sin caché de terceros: no hay requests fuera del origen
        runtimeCaching: [],
      },
    }),
  ],
  worker: { format: 'es' },
  server: { host: true, fs: { allow: ['..'] } },
  build: { target: 'es2022', sourcemap: true },
}));
