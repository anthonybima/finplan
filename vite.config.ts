import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createRequire } from 'node:module';
const { metaCsp } = createRequire(import.meta.url)('./security.config.cjs');

/** Web build only: strict CSP + no-index meta tags (hosts should ALSO send the headers in deploy/). */
const webSecurity = (): Plugin => ({
  name: 'finplan-web-security',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />\n    <meta name="robots" content="noindex, nofollow, noarchive" />\n    <meta name="referrer" content="no-referrer" />`),
});

// Modes: default → dist/ (Electron + Capacitor) · web → dist-web/ (hosting, hardened) · single → one-file preview
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : []), ...(mode === 'web' ? [webSecurity()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'web' ? 'dist-web' : 'dist',
    chunkSizeWarningLimit: 2000,
    sourcemap: false, // don't publish source maps
  },
}));
