#!/usr/bin/env node
// Validates registry.json before it can deploy. Zero dependencies on purpose.
// Run: node scripts/validate-registry.mjs   (exit 1 on any problem)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, '..', 'registry.json');
const KEY = /^[a-z0-9][a-z0-9-]{1,63}$/;
const PROVIDERS = new Set(['elevenlabs', 'gpt-trainer', 'url']);
const CLIENT_TOOLS = new Set(['show_card', 'mark_step', 'celebrate', 'open_resource']);
const CONTEXT_VARS = ['lesson', 'activity', 'opener', 'steps'];
const HUB_STATUS = new Set(['pending', 'active', 'paused']);
const SPACES = new Set(['question-box', 'this-week', 'wins', 'announcements']);
const errors = [];
const err = (m) => errors.push(m);

let reg;
try { reg = JSON.parse(readFileSync(path, 'utf8')); }
catch (e) { console.error('registry.json is not valid JSON: ' + e.message); process.exit(1); }

if (!Number.isInteger(reg.version) || reg.version < 1) err('version must be a positive integer');
if (!reg.agents || typeof reg.agents !== 'object' || !Object.keys(reg.agents).length) err('agents must be a non-empty object');
if (!reg.providers?.elevenlabs?.scriptUrl?.startsWith('https://')) err('providers.elevenlabs.scriptUrl must be https');
if (!reg.providers?.['gpt-trainer']?.widgetBase?.startsWith('https://')) err('providers.gpt-trainer.widgetBase must be https');
if (!reg.providers?.['gpt-trainer']?.bubbleScriptUrl?.startsWith('https://')) err('providers.gpt-trainer.bubbleScriptUrl must be https');

const agents = reg.agents || {};
const seen = new Map(); // alias/key -> owner key
for (const [key, e] of Object.entries(agents)) {
  if (!KEY.test(key)) err(`agent key "${key}" must match ${KEY}`);
  if (seen.has(key)) err(`key "${key}" collides with alias of "${seen.get(key)}"`); seen.set(key, key);
  if (!e || typeof e !== 'object') { err(`agent "${key}" must be an object`); continue; }
  if (!e.label) err(`agent "${key}": label is required`);
  if (!PROVIDERS.has(e.provider)) err(`agent "${key}": provider must be one of ${[...PROVIDERS].join(', ')}`);
  if (!['active', 'retired'].includes(e.status)) err(`agent "${key}": status must be active|retired`);
  if (e.mode && !['full', 'bubble'].includes(e.mode)) err(`agent "${key}": mode must be full|bubble`);
  if (e.status === 'active') {
    if (e.provider === 'elevenlabs' && !/^agent_[A-Za-z0-9]+$/.test(e.agentId || '')) err(`agent "${key}": agentId must look like agent_xxx`);
    if (e.provider === 'gpt-trainer' && !/^[0-9a-f]{32}$/.test(e.botUuid || '')) err(`agent "${key}": botUuid must be 32 hex chars`);
    if (e.provider === 'url' && !/^https:\/\//.test(e.url || '')) err(`agent "${key}": url must be https`);
  }
  if (e.redirect !== undefined) {
    if (!agents[e.redirect]) err(`agent "${key}": redirect target "${e.redirect}" does not exist`);
    if (e.redirect === key) err(`agent "${key}": redirects to itself`);
  }
  for (const a of e.aliases || []) {
    if (!KEY.test(a)) err(`agent "${key}": alias "${a}" must match ${KEY}`);
    if (agents[a]) err(`agent "${key}": alias "${a}" is also a real key`);
    if (seen.has(a) && seen.get(a) !== key) err(`alias "${a}" is claimed by both "${seen.get(a)}" and "${key}"`);
    seen.set(a, key);
  }
  if (e.variables) for (const [vk, vv] of Object.entries(e.variables)) {
    if (!['string', 'number', 'boolean'].includes(typeof vv)) err(`agent "${key}": variable "${vk}" must be string/number/boolean`);
  }
  // --- v3: lesson contexts, client tools, approved links ---
  if (e.clientTools !== undefined) {
    if (!Array.isArray(e.clientTools)) err(`agent "${key}": clientTools must be an array`);
    else for (const t of e.clientTools) if (!CLIENT_TOOLS.has(t)) err(`agent "${key}": unknown client tool "${t}" (embed.js implements: ${[...CLIENT_TOOLS].join(', ')})`);
  }
  if (e.resources !== undefined) {
    if (!e.resources || typeof e.resources !== 'object') err(`agent "${key}": resources must be an object`);
    else for (const [rk, r] of Object.entries(e.resources)) {
      if (!KEY.test(rk)) err(`agent "${key}": resource key "${rk}" must match ${KEY}`);
      if (!r || !/^https:\/\//.test(r.url || '')) err(`agent "${key}": resource "${rk}" needs an https url`);
      if (!r || !r.label) err(`agent "${key}": resource "${rk}" needs a label`);
    }
  }
  if (e.contexts !== undefined) {
    if (!e.contexts || typeof e.contexts !== 'object') err(`agent "${key}": contexts must be an object`);
    else {
      if (!e.contexts.default) err(`agent "${key}": contexts needs a "default" entry (used when ?module= is missing or unknown)`);
      for (const [ck, c] of Object.entries(e.contexts)) {
        if (!KEY.test(ck)) err(`agent "${key}": context key "${ck}" must match ${KEY}`);
        for (const f of ['lesson', 'activity', 'opener']) {
          if (typeof c?.[f] !== 'string' || !c[f].trim()) err(`agent "${key}": context "${ck}" needs a non-empty "${f}"`);
        }
        if ((c?.activity || '').length > 1200) err(`agent "${key}": context "${ck}" activity is over 1200 characters (embed.js would cut it)`);
        if ((c?.opener || '').length > 400) err(`agent "${key}": context "${ck}" opener is over 400 characters (embed.js would cut it)`);
        if (/[{}]/.test((c?.activity || '') + (c?.opener || '') + (c?.lesson || ''))) err(`agent "${key}": context "${ck}" must not contain { or } (it is injected into a {{variable}})`);
        if (c?.steps !== undefined && (!Array.isArray(c.steps) || c.steps.length > 6 || c.steps.some((t) => typeof t !== 'string' || !t.trim() || t.length > 160))) err(`agent "${key}": context "${ck}" steps must be 0-6 short strings (<=160 chars)`);
      }
      // The agent prompt / first message reference these; a missing one fails the conversation.
      for (const v of CONTEXT_VARS) {
        if (typeof e.variables?.[v] !== 'string' || !e.variables[v].trim()) err(`agent "${key}": variables.${v} must have a non-empty default because contexts are in use`);
      }
    }
  }
}
// redirect chains must terminate in an active agent within 5 hops
for (const key of Object.keys(agents)) {
  let k = key, hops = 0;
  while (agents[k]?.redirect && hops < 6) { k = agents[k].redirect; hops++; }
  if (hops >= 6) err(`agent "${key}": redirect chain longer than 5 hops (loop?)`);
  else if (agents[key]?.status === 'retired' && agents[k]?.status !== 'active') err(`agent "${key}" is retired but its redirect chain does not end at an active agent`);
}
for (const f of ['default', 'fallback']) {
  if (!agents[reg[f]]) err(`${f} "${reg[f]}" is not an agent key`);
  else if (agents[reg[f]].status !== 'active') err(`${f} "${reg[f]}" must be active`);
}

// --- hubs.json (Cohort Hub door, hub.html) ---
let hubCount = 0;
try {
  const hubs = JSON.parse(readFileSync(join(here, '..', 'hubs.json'), 'utf8'));
  if (!hubs.hubs || typeof hubs.hubs !== 'object' || !Object.keys(hubs.hubs).length) err('hubs.json: hubs must be a non-empty object');
  for (const [hk, h] of Object.entries(hubs.hubs || {})) {
    hubCount++;
    if (!KEY.test(hk)) err(`hubs.json: hub key "${hk}" must match ${KEY}`);
    if (!HUB_STATUS.has(h?.status)) err(`hubs.json: hub "${hk}" status must be pending|active|paused`);
    if (!KEY.test(h?.cohort || '')) err(`hubs.json: hub "${hk}" needs a cohort slug`);
    if (h?.defaultSpace && !SPACES.has(h.defaultSpace)) err(`hubs.json: hub "${hk}" defaultSpace must be one of ${[...SPACES].join(', ')}`);
    if (h?.status === 'active') {
      if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(h.baseUrl || '')) err(`hubs.json: hub "${hk}" is active, so baseUrl must be https://host with no path and no trailing slash`);
    } else if (!h?.pendingMessage && h?.status === 'pending') err(`hubs.json: hub "${hk}" is pending, so it needs a pendingMessage`);
  }
} catch (e) { err('hubs.json could not be read or parsed: ' + e.message); }

if (errors.length) { console.error('registry.json / hubs.json have ' + errors.length + ' problem(s):\n - ' + errors.join('\n - ')); process.exit(1); }
const ctxCount = Object.values(agents).reduce((n, a) => n + Object.keys(a.contexts || {}).length, 0);
console.log(`registry.json OK: ${Object.keys(agents).length} agent(s), ${ctxCount} lesson context(s), default="${reg.default}", fallback="${reg.fallback}"; hubs.json OK: ${hubCount} hub(s)`);
