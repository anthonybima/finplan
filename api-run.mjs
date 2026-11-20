// FinPlan Cloud supervisor, runs in the stock node:22-alpine image (see deploy/docker-compose.vps.yml).
// Downloads server.mjs from the repo's `site` branch at an exact commit, runs it, and every 5 minutes checks for a
// newer build; when there is one it restarts the server with the new code. Data lives in /data (a Docker volume).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const REPO = process.env.FINPLAN_REPO || 'anthonybima/finplan';
const BR = process.env.FINPLAN_BRANCH || 'site';
const CODE = '/tmp/finplan-server.mjs';

async function head() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BR}`, { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'finplan-api' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return (await r.text()).trim();
}
async function download(sha) {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/server.mjs`);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const text = await r.text();
  if (!text.includes('FinPlan Cloud')) throw new Error('unexpected server file');
  await fs.writeFile(CODE, text);
}

let child = null; let current = '';
function start() {
  child = spawn(process.execPath, [CODE], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => { console.log(`server exited (${code}); restarting in 3 s`); child = null; setTimeout(start, 3000); });
}

for (;;) {
  try { current = await head(); await download(current); break; }
  catch (e) { console.log(`finplan-api: ${e.message}; retrying in 15 s`); await new Promise((r) => setTimeout(r, 15000)); }
}
console.log(`finplan-api: running ${current.slice(0, 7)}`);
start();

setInterval(async () => {
  try {
    const sha = await head();
    if (sha && sha !== current) {
      await download(sha); current = sha;
      console.log(`finplan-api: updating to ${sha.slice(0, 7)}`);
      if (child) child.kill('SIGTERM'); // exit handler starts the new code
    }
  } catch (e) { console.log(`finplan-api: update check failed: ${e.message}`); }
}, 5 * 60e3);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (child) { child.removeAllListeners('exit'); child.kill(sig); } process.exit(0); });
