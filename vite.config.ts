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

/** Every build gets an id; the web build also writes /version.json so open apps can tell a newer version is live. */
const BUILD = (process.env.GITHUB_SHA || '').slice(0, 12) || `local-${Date.now()}`;
const versionFile = (): Plugin => ({ name: 'finplan-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, at: new Date().toISOString() }) }); } });

// Modes: default → dist/ (Electron + Capacitor) · web → dist-web/ (hosting, hardened) · single → one-file preview
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : []), ...(mode === 'web' ? [webSecurity(), versionFile()] : [])],
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'web' ? 'dist-web' : 'dist',
    chunkSizeWarningLimit: 2000,
    sourcemap: false, // don't publish source maps
  },
}));
