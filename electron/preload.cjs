const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('finplanNative', {
  platform: 'electron',
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  request: (url, opts) => ipcRenderer.invoke('http-request', url, opts),
  secretGet: (key) => ipcRenderer.invoke('secret-get', key),
  secretSet: (key, value) => ipcRenderer.invoke('secret-set', key, value),
  oauthRedirectUri: () => ipcRenderer.invoke('oauth-redirect-uri'),
  oauthAuthorize: (url) => ipcRenderer.invoke('oauth-authorize', url),
});
