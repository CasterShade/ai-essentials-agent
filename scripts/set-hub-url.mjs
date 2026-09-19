#!/usr/bin/env node
// Point a Cohort Hub key at its hosted URL (or park it again) -- the "replace script".
// Courses embed hub.html?hub=<key>, so this one edit moves every course block at once.
//
//   node scripts/set-hub-url.mjs https://cohort-hub.example.azurecontainerapps.io            (hub chah-2026 -> active)
//   node scripts/set-hub-url.mjs https://hub.yu.edu --hub chah-2026                          (moved hosts later)
//   node scripts/set-hub-url.mjs --status paused                                             (maintenance note)
//   node scripts/set-hub-url.mjs --status pending                                            (back to the placeholder)
//   add --skip-check to skip the /healthz probe
//
// Then publish (publish.ps1 or git push). Live within ~10 minutes (GitHub Pages cache).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'hubs.json');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const hubKey = opt('hub', 'chah-2026');
const skip = args.includes('--skip-check');
let url = args.find((a, i) => /^https?:\/\//i.test(a) && !String(args[i - 1] || '').startsWith('--')) || '';
let status = opt('status', url ? 'active' : null);
if (!status) { console.error('Usage: node scripts/set-hub-url.mjs <https://hub-url> [--hub chah-2026] [--status active|pending|paused] [--skip-check]'); process.exit(2); }
if (!['active', 'pending', 'paused'].includes(status)) { console.error('--status must be active, pending or paused'); process.exit(2); }

const cfg = JSON.parse(readFileSync(file, 'utf8'));
const hub = cfg.hubs?.[hubKey];
if (!hub) { console.error(`hubs.json has no hub "${hubKey}". Known: ${Object.keys(cfg.hubs || {}).join(', ')}`); process.exit(1); }

if (status === 'active') {
  url = (url || hub.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) { console.error(`"${url}" is not a bare https://host URL (no path). Example: https://cohort-hub.xyz.eastus.azurecontainerapps.io`); process.exit(1); }
  if (!skip) {
    try {
      const r = await fetch(url + '/healthz', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      console.log(`OK   ${url}/healthz answered ${r.status}`);
      const e = await fetch(`${url}/embed?cohort=${encodeURIComponent(hub.cohort)}`, { signal: AbortSignal.timeout(15000) });
      const csp = e.headers.get('content-security-policy') || '';
      const fa = (csp.match(/frame-ancestors([^;]*)/i) || [])[1] || '';
      if (!fa) console.warn('WARN the hub sent no frame-ancestors policy -- fine for embedding, but check X-Frame-Options is not set.');
      else if (!/thinkific/i.test(fa)) console.warn(`WARN frame-ancestors is "${fa.trim()}" -- it does not mention thinkific, so the block may be blank inside the course. Fix FRAME_ANCESTORS on the hub first.`);
      else console.log(`OK   frame-ancestors allows: ${fa.trim()}`);
    } catch (e) {
      console.error(`The hub did not answer at ${url}/healthz (${e.message}). Nothing was changed. Use --skip-check to set it anyway.`);
      process.exit(1);
    }
  }
  hub.baseUrl = url;
}
hub.status = status;
cfg.updated = new Date().toISOString().slice(0, 10);
writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log(`hubs.json: "${hubKey}" is now ${status}${status === 'active' ? ' -> ' + hub.baseUrl : ''}`);
try { execFileSync(process.execPath, [join(here, 'validate-registry.mjs')], { stdio: 'inherit' }); }
catch { console.error('Validation failed -- fix hubs.json before publishing.'); process.exit(1); }
console.log('Next: run .\\publish.ps1 (or commit + push). Every course block follows within ~10 minutes.');
