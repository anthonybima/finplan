# FinPlan security model

FinPlan is a **personal** finance app with **no server and no database**. Hosting it on the web only serves static files; every user's data lives in their own browser/app, encrypted.

## What is protected, and how

| Layer | Protection |
|---|---|
| **Data at rest** | Each user's data is one AES-256-GCM ciphertext. The 256-bit data key is random, wrapped with a key derived from the password (PBKDF2-HMAC-SHA256, **600,000** iterations, OWASP 2023+) and separately with a 120-bit recovery code. Wrapped keys and the vault are bound to their user and purpose with AES-GCM associated data (no blob swapping; any modification is detected). |
| **Keys in memory** | The data key is imported as **non-extractable** WebCrypto key: page script can use it while unlocked but cannot read its bytes. Raw key bytes are wiped right after use. Nothing is kept after Lock / Sign out / reload. |
| **Passwords** | Never stored, not even as a hash. A wrong password simply fails AES-GCM authentication. Minimum 10 chars, common-password and repetition checks. Older/weaker key derivation is upgraded automatically at next sign-in. |
| **Brute force** | 5 consecutive failures → lock 30 s, doubling up to 15 min. Every attempt is logged with the **Browser ID**. |
| **Recovery** | One-time 24-character code (shown once). Using it sets a new password and issues a new code; the old code stops working. |
| **API keys / tokens** (Bitget, Bittime, Alpaca, Pluang, Claude API for Smart scan) | Encrypted with the user's vault key (and additionally by the OS keychain on desktop). Never in backups, never sent through proxies, unreadable while signed out. All connections request **read-only** access; Pluang is asked for `market:read portfolio:read` only. Inside Claude, the page is granted only Pluang's read tools (quotes, candles, holdings, wallet balances), never order tools. |
| **Smart scan files** | Inside Claude: sent to Claude on your own account. Apps: sent only to `api.anthropic.com` with your key (allow-listed in CSP and the desktop shell). On-device reader: nothing leaves the device. FinPlan stores only the rows you approve, not the images. |
| **Backups** | Encrypted by default (`.fpbak`, AES-256-GCM + PBKDF2 600k). Plain JSON export only on explicit choice, with a warning. |
| **Session** | Auto-lock after idle (default 15 min) and when returning from background after that time. Manual Lock / Sign out. |
| **Multiple users** | Separate vaults and API keys per user on the same device; one user cannot decrypt another's data. |
| **Browser ID** | Random per-install ID (`FP-XXXX-XXXX`) + environment fingerprint, shown on the login screen and in Settings → This device, and recorded in sign-in history. |

## Account numbers
Full account numbers are stored only inside the user's encrypted vault (AES-256-GCM) and the end-to-end encrypted sync copy; exports you make (Excel/CSV) contain them in plain text, so treat those files as private. Security is at sign-in: once unlocked, Wealth shows full numbers (you can switch **Hide numbers** on, e.g. for screen sharing). Ask Claude's snapshot never includes account numbers (tested).

## Web hosting hardening (`npm run build:web`)
- **Strict Content-Security-Policy**: scripts only from FinPlan itself (+ TradingView widgets), network only to the listed APIs, no plugins, no `<base>` hijack, no form posts, no framing.
- **Headers** (generated from `security.config.cjs`): HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, COOP/CORP same-origin, `X-Robots-Tag: noindex`.
- `robots.txt` disallows everything; no source maps are published.
- Privacy mode (Settings → Security center) disables the public CORS relays used for news feeds on the web.

## Desktop app hardening (Electron)
Context isolation, **sandboxed** renderer, no Node in the page, DevTools off in packaged builds, navigation and new windows blocked (external links → system browser, https only), all permission requests denied, CSP on the bundled page, API calls allowed **only** to an allow-list of hosts, single-instance lock.

## Threats that remain (be aware)
1. **Whoever controls your hosting can change the code.** Use a host account with 2FA, and deploy only from your own machine/repo. This is the main risk of any web app.
2. **Malware on your device** (keylogger, malicious browser extension) can see what you see while unlocked. Use a clean browser profile for FinPlan with no extensions.
3. **Forgetting both password and recovery code = data is unrecoverable.** That is the price of real encryption. Keep encrypted backups.
4. Clearing browser data deletes your vault: click **Protect storage** in Security center, install it as an app, and back up monthly.

## Dependency hygiene
Run `npm run audit`. SheetJS (`xlsx`) is installed from the official SheetJS CDN build (0.20.3) because the npm registry version has known advisories; spreadsheet imports are size-limited and only parse files you choose.

## Dependency note: SheetJS (Excel import)
`package.json` installs the patched SheetJS **0.20.3** from the official CDN (`cdn.sheetjs.com`); the npm-registry `xlsx` package stops at 0.18.5, which has known advisories (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9). Build on your own machine with `npm install` so you get 0.20.3; check with `npm ls xlsx`. It only parses files you choose to import (max 15 MB).

## Google Drive sync
- Scope `drive.appdata` only (non-sensitive; FinPlan's hidden app folder). OAuth token flow in a popup returning to `/oauth-google.html` on your own origin; the token is handed over via same-origin storage, removed from the URL, kept in memory/sessionStorage for ≤1 h, never persisted.
- Payload is encrypted on the device: PBKDF2-SHA256 (600,000) from the sync password → AES-256-GCM with AAD `finplan-sync-v1`. Google stores ciphertext + a revision number and device name. Tampering or a wrong password fails decryption.
- The derived sync key is stored per device inside the user's vault secrets (encrypted with the vault key). API keys are never in the sync payload. CSP adds `connect-src https://www.googleapis.com` only.

### Sync inside Claude
Inside Claude, the same end-to-end encrypted copy is kept in the artifact's database under `data/users/<Claude user id>/` — the platform's private per-person area (not readable by other viewers or the artifact owner); the root of the database is owner-only and unused. Only ciphertext is stored (AES-256-GCM, key from the sync password), in pieces of ≤180 KB, written as a new generation before the old one is deleted.

### Devices and approval
Each account keeps a list of its devices (Browser ID, platform, first/last seen, status) inside its encrypted data. *Remove* makes that device erase the account locally on its next sync; *New devices need approval* holds a new device on a waiting screen until an allowed device approves it. Both are enforced by the app on each device; the cryptographic protection is still the password.

### One account on several devices
Each FinPlan account syncs to its own Drive file. The file's only readable labels are the account id (random) and account name; everything else is AES-256-GCM ciphertext. Opening the account on a new device needs the Google sign-in **and** the account's sync password; the password is checked by decrypting on the device, never sent anywhere. The new device gets its own local vault key and recovery code. If the device already has a user with that name, its own password must match, and the two copies are combined on the first sync.

## Ask Claude
- Sends a summary of your FinPlan data to Claude when you ask a question: inside Claude via your Claude account; elsewhere to `api.anthropic.com` with your own key. Switches remove names and transactions; the exact payload is viewable before sending. Chats are not stored.
