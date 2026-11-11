import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';
import './styles.css';
import { initClaudeStore } from './lib/claudeCloud';

initClaudeStore(); // inside Claude: sync through the Claude account's private storage

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate /></React.StrictMode>);

// Installable/offline on web (not needed inside Electron or Capacitor shells)
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.finplanNative) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
