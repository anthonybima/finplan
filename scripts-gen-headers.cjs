// Generates host config files from security.config.cjs → run automatically by `npm run build:web`.
const fs = require('fs');
const path = require('path');
const { headers } = require('./security.config.cjs');
const out = process.argv[2] || 'dist-web';
const lines = Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n');
// Netlify + Cloudflare Pages
fs.writeFileSync(path.join(out, '_headers'), `/*\n${lines}\n\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
// Vercel
fs.writeFileSync('vercel.json', JSON.stringify({ outputDirectory: 'dist-web', buildCommand: 'npm run build:web', headers: [{ source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) }] }, null, 2) + '\n');
// nginx / Caddy for a VPS
fs.writeFileSync('deploy/nginx-finplan.conf', `# Put inside your server { } block (HTTPS only), root pointing at dist-web/\n` + Object.entries(headers).map(([k, v]) => `add_header ${k} "${v}" always;`).join('\n') + `\nlocation / { try_files $uri $uri/ /index.html; }\nlocation = /sw.js { add_header Cache-Control "no-cache"; }\nserver_tokens off;\n`);
fs.writeFileSync('deploy/Caddyfile', `finplan.example.com {\n  root * /srv/finplan/dist-web\n  file_server\n  header {\n${Object.entries(headers).map(([k, v]) => `    ${k} "${v}"`).join('\n')}\n    -Server\n  }\n}\n`);
// Docker image (Caddy, automatic HTTPS): the site address comes from $SITE_ADDRESS at run time
fs.writeFileSync('deploy/Caddyfile.docker', `{$SITE_ADDRESS:localhost} {\n  root * /srv/finplan\n  encode zstd gzip\n  header {\n${Object.entries(headers).map(([k, v]) => `    ${k} "${v}"`).join('\n')}\n    -Server\n  }\n  @immutable path /assets/*\n  header @immutable Cache-Control "public, max-age=31536000, immutable"\n  @nocache path /sw.js /index.html /\n  header @nocache Cache-Control "no-cache"\n  handle /api/* {\n    request_body {\n      max_size 30MB\n    }\n    reverse_proxy {$API_UPSTREAM:finplan-api:8080}\n  }\n  handle {\n    try_files {path} /index.html\n    file_server\n  }\n}\n`);
console.log('Security headers written: _headers, robots.txt, vercel.json, deploy/nginx-finplan.conf, deploy/Caddyfile, deploy/Caddyfile.docker');
