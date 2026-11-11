# Put FinPlan on the web (personal use)

FinPlan is a static site, so hosting is free and simple. Your data never goes to the host; it stays encrypted in your browser.
Recommended: **Cloudflare Pages + Cloudflare Access**, so that *only your email* can even open the site.

## 1. Build
```bash
npm install          # installs patched SheetJS 0.20.3 from cdn.sheetjs.com
npm run build:web    # → dist-web/  (+ _headers, robots.txt, vercel.json, nginx/Caddy configs)
```

## 2a. Cloudflare Pages (recommended)
1. Create a free Cloudflare account and **turn on 2FA**.
2. Workers & Pages → Create → Pages → **Upload assets** → upload the `dist-web` folder (or connect your private GitHub repo with build command `npm run build:web`, output `dist-web`).
3. The `_headers` file is applied automatically (CSP, HSTS, noindex…).
4. **Lock it to you:** Zero Trust → Access → Applications → *Add* → Self-hosted → domain = your `*.pages.dev` (and custom domain) → Policy: *Allow* → *Emails* = your email → Login method: *One-time PIN*.
   Now strangers see a Cloudflare login page; only you get a one-time code by email. FinPlan's own password protects the data on top of that.
5. Optional: add a custom domain (Pages → Custom domains); HTTPS is automatic.

## 2b. Netlify
Drag `dist-web` onto app.netlify.com/drop (or connect the repo, build `npm run build:web`, publish `dist-web`). `_headers` is applied automatically.
To restrict access: Site settings → Access control → *Password protection* (paid) or put Cloudflare in front.

## 2c. Vercel
`npx vercel --prod` from the project folder (`vercel.json` sets the build + headers). Restrict with *Deployment Protection* (Vercel Authentication).

## 2d. Your own VPS
Copy `dist-web` to the server. Use `deploy/Caddyfile` (automatic HTTPS) or add `deploy/nginx-finplan.conf` to an HTTPS `server {}` block. Add basic auth or a VPN (Tailscale) for access control.

> GitHub Pages can't send custom headers; the build still includes the CSP + noindex `<meta>` tags, but prefer one of the hosts above.

## 3. First run
1. Open your URL → **Create your account** (10+ characters; a short sentence is ideal).
2. **Save the recovery code** in your password manager.
3. Settings → Security center → **Protect storage**, then **Back up now**.
4. Install as an app: browser menu → *Install FinPlan* / *Add to Home Screen*.

## Updating
Re-run `npm run build:web` and upload `dist-web` again. Your data is untouched (it lives in your browser, not on the host).
