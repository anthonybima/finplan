// Receives Google's OAuth token response and hands it to the FinPlan tab (same origin), then closes.
(function () {
  var p = new URLSearchParams((location.hash || '').replace(/^#/, '') || location.search.replace(/^\?/, ''));
  history.replaceState(null, '', location.pathname); // drop the token from the address bar / history
  var r = { state: p.get('state'), access_token: p.get('access_token'), expires_in: p.get('expires_in'), error: p.get('error'), at: Date.now() };
  var pending = null;
  try { pending = JSON.parse(localStorage.getItem('finplan.oauth.pending') || 'null'); } catch (e) {}
  try { localStorage.setItem('finplan.oauth.result', JSON.stringify(r)); } catch (e) {}
  try { var bc = new BroadcastChannel('finplan-oauth'); bc.postMessage(r); bc.close(); } catch (e) {}
  var m = document.getElementById('m');
  if (pending && pending.redirect) { m.textContent = 'Signed in. Returning to FinPlan…'; location.replace('./'); return; }
  m.textContent = r.error ? 'Sign-in was not completed. You can close this window.' : 'Signed in. You can close this window.';
  setTimeout(function () { try { window.close(); } catch (e) {} }, 300);
})();
