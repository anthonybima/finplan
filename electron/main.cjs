// Desktop shell (Windows / macOS / Linux).
const { app, BrowserWindow, ipcMain, net, shell, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, title: 'FinPlan',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // open external links (news, TradingView, Stockbit) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  // The app may only ever show its own bundled files.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternalSafe(url); } });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

const UA = 'Mozilla/5.0 (FinPlan desktop)';
const openExternalSafe = (url) => { try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch { /* ignore */ } };

// Hosts the renderer may call with custom headers (API keys). Anything else is refused,
// so even a compromised page can't turn the main process into an open proxy.
const API_HOSTS = new Set([
  'api.bitget.com', 'openapi.bittime.com', 'api.alpaca.markets', 'paper-api.alpaca.markets', 'data.alpaca.markets', 'mcp.pluang.com', 'api.anthropic.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com',
]);

// Public text fetch (news feeds)
ipcMain.handle('fetch-text', async (_e, url) => {
  if (new URL(url).protocol !== 'https:') throw new Error('Only https feeds');
  const res = await net.fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
});

// Generic HTTP from the main process: no CORS, custom headers (Bitget signed requests, price APIs)
ipcMain.handle('http-request', async (_e, url, opts) => {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https is allowed');
  if (!API_HOSTS.has(u.hostname)) throw new Error('Host not allowed: ' + u.hostname);
  const res = await net.fetch(url, {
    method: opts?.method || 'GET',
    headers: { 'User-Agent': UA, ...(opts?.headers || {}) },
    body: opts?.body,
  });
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, text: await res.text(), headers };
});

// OAuth 2.1 + PKCE sign-in (Pluang MCP): system browser → loopback redirect on 127.0.0.1
const OAUTH_PORT = 47615;
ipcMain.handle('oauth-redirect-uri', () => `http://127.0.0.1:${OAUTH_PORT}/callback`);
ipcMain.handle('oauth-authorize', (_e, authUrl) => new Promise((resolve, reject) => {
  if (!String(authUrl).startsWith('https://')) return reject(new Error('Invalid sign-in URL'));
  let timer;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
    const code = u.searchParams.get('code'), state = u.searchParams.get('state'), err = u.searchParams.get('error_description') || u.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:system-ui;text-align:center;padding:48px"><h2>${code ? 'FinPlan is connected ✓' : 'Sign-in failed'}</h2><p>You can close this tab and go back to FinPlan.</p></body></html>`);
    clearTimeout(timer); srv.close();
    code ? resolve({ code, state }) : reject(new Error(err || 'Sign-in was cancelled'));
  });
  srv.on('error', (e) => reject(new Error('Could not open the sign-in callback port ' + OAUTH_PORT + ': ' + e.message)));
  srv.listen(OAUTH_PORT, '127.0.0.1', () => shell.openExternal(authUrl));
  timer = setTimeout(() => { srv.close(); reject(new Error('Sign-in timed out')); }, 5 * 60 * 1000);
}));

// API secrets encrypted with the OS keychain (DPAPI / Keychain / libsecret)
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
function readSecrets() { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; } }
ipcMain.handle('secret-get', (_e, key) => {
  const v = readSecrets()[key];
  if (!v) return null;
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : null; } catch { return null; }
});
ipcMain.handle('secret-set', (_e, key, value) => {
  const all = readSecrets();
  if (value == null) delete all[key];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
    all[key] = safeStorage.encryptString(value).toString('base64');
  }
  fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
});

app.whenReady().then(() => {
  // Deny camera/mic/location/notifications/etc. FinPlan needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Strict CSP for the bundled app
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    if (!d.url.startsWith('file://')) return cb({ responseHeaders: d.responseHeaders });
    cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self' https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src https://*.tradingview.com https://www.tradingview-widget.com https://ssltvc.investing.com; object-src 'none'; base-uri 'none'; form-action 'none'"] } });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// Single instance: a second launch focuses the existing window (also protects the OAuth callback port).
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
