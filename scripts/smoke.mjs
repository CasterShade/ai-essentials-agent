#!/usr/bin/env node
// Browser smoke test for the resolver. Serves this folder locally, opens index.html
// with different params in headless Chromium, and checks what got mounted.
// External provider scripts are blocked so the test is deterministic and offline.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  try { await stat(f); res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); }
  catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const ctx = await browser.newContext();
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort()); // no external network
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); if (!ok) failures++; };
const open = async (query) => { const page = await ctx.newPage(); await page.goto(base + 'index.html' + query, { waitUntil: 'load' }); await page.waitForTimeout(300); return page; };
const dbg = async (page) => JSON.parse(await page.locator('#agent-debug').textContent());

// 1. default -> ElevenLabs HS agent, full mode
{
  const page = await open('?debug=1');
  const d = await dbg(page);
  check('default resolves to ai-essentials-hs', d.resolved === 'ai-essentials-hs' && d.provider === 'elevenlabs' && d.mode === 'full');
  const w = page.locator('elevenlabs-convai');
  check('elevenlabs-convai mounted with agent-id', (await w.getAttribute('agent-id')) === 'agent_4001m269sgbaekjsmned83s8fy3d');
  check('full mode forces always-expanded', (await w.getAttribute('always-expanded')) === 'true');
  const dv = JSON.parse(await w.getAttribute('dynamic-variables'));
  check('dynamic-variables carry entry defaults', dv.course_id === 'AI-ESS-HS');
  check('no override attributes unless allowed', (await w.getAttribute('override-language')) === null);
  await page.close();
}
// 2. alias + URL context + language override stays off
{
  const page = await open('?agent=hs&course_id=X1&course_name=Course%20X&lang=es&debug=1');
  const d = await dbg(page);
  check('alias "hs" resolves', d.resolved === 'ai-essentials-hs');
  check('URL context merges over defaults', d.variables.course_id === 'X1' && d.variables.course_name === 'Course X' && d.variables.lang === 'es');
  check('override-language not sent when entry.overrides.language=false', (await page.locator('elevenlabs-convai').getAttribute('override-language')) === null);
  await page.close();
}
// 3. GPT-Trainer full mode: iframe + postMessage handshake
{
  const page = await open('?agent=tutorbot-onla&course_id=MAR%202501&course_name=Buyer%20Behavior&debug=1');
  const d = await dbg(page);
  check('tutorbot-onla resolves to gpt-trainer', d.provider === 'gpt-trainer' && d.mode === 'full');
  const src = await page.locator('#chatbot-widget-window-iframe').getAttribute('src');
  check('gpt-trainer iframe points at bot uuid', src === 'https://app.gpt-trainer.com/widget/67bad6076c0c4f36bed95eeee5ea6ce9', src);
  const got = await page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('message', (e) => { if (e.data && e.data.type === 'gpt_initial_messages_variables') resolve(e.data.variables); });
    window.postMessage({ type: 'gpt_chatbot_state', payload: { ready: true } }, '*');
    setTimeout(() => resolve(null), 1500);
  }));
  check('variables are posted after the ready signal', !!got && got.course_id === 'MAR 2501' && got.course_name === 'Buyer Behavior', JSON.stringify(got));
  await page.close();
}
// 4. GPT-Trainer bubble mode sets GPTTConfig
{
  const page = await open('?agent=tutorbot&mode=bubble&course_id=C9&debug=1');
  const cfg = await page.evaluate(() => window.GPTTConfig);
  check('bubble mode sets window.GPTTConfig', cfg && cfg.uuid === '67bad6076c0c4f36bed95eeee5ea6ce9' && cfg.initial_messages_variables.course_id === 'C9');
  await page.close();
}
// 5. unknown key -> fallback with a visible notice, never blank
{
  const page = await open('?agent=does-not-exist&debug=1');
  const d = await dbg(page);
  check('unknown key falls back', d.fellBack === true && d.resolved === 'ai-essentials-hs');
  check('fallback shows a notice', await page.locator('#agent-notice').isVisible());
  check('fallback still mounts a widget', (await page.locator('elevenlabs-convai').count()) === 1);
  await page.close();
}
// 6. registry unreachable -> emergency config
{
  const page = await ctx.newPage();
  await page.route(/registry\.json/, (r) => r.abort());
  await page.goto(base + 'index.html?debug=1', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  check('registry outage still mounts the default agent', (await page.locator('elevenlabs-convai').count()) === 1);
  check('registry outage shows a notice', await page.locator('#agent-notice').isVisible());
  await page.close();
}
// 7. hostile input is ignored
{
  const page = await open('?agent=%3Cscript%3E&debug=1');
  const d = await dbg(page);
  check('invalid key characters are ignored (default used, no fallback notice)', d.resolved === 'ai-essentials-hs' && d.fellBack === false);
  await page.close();
}
// 8. builder page lists the registry
{
  const page = await ctx.newPage();
  await page.goto(base + 'builder.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const out = await page.locator('#out').textContent();
  check('builder produces an iframe snippet with allow=microphone', out.includes('<iframe') && out.includes('allow="microphone'));
  check('builder table lists both agents', (await page.locator('#regtable tbody tr').count()) >= 2);
  await page.locator('#module_sel').selectOption('types-of-ai');
  await page.waitForTimeout(100);
  const out2 = await page.locator('#out').textContent();
  check('builder offers the lesson activities and puts module= in the snippet', out2.includes('module=types-of-ai') && (await page.locator('#module_sel option').count()) >= 10 && (await page.locator('#ctxinfo').textContent()).includes('four levels'));
  const hubout = await page.locator('#hubout').textContent();
  check('builder produces the Cohort Hub snippet through hub.html', hubout.includes('hub.html?hub=chah-2026') && hubout.includes('space=question-box') && (await page.locator('#hubinfo').textContent()).includes('pending'));
  await page.close();
}

// 9. lesson context: ?module=<key> tells the agent where it is and draws the activity bar
{
  const page = await open('?agent=ai-essentials-hs&module=types-of-ai&debug=1');
  const d = await dbg(page);
  check('module selects the lesson context', d.context === 'types-of-ai' && d.contextMatched === true && d.stage === true);
  const dv = JSON.parse(await page.locator('elevenlabs-convai').getAttribute('dynamic-variables'));
  check('context variables reach the widget (lesson, activity, opener, steps)', dv.lesson === 'AI Basics: Different Types of AI' && dv.activity.length > 50 && dv.opener.length > 20 && dv.steps.startsWith('1) '), JSON.stringify(Object.keys(dv)));
  check('activity bar shows the title and 3 step dots', (await page.locator('.stage-name').textContent()).includes('level of AI') && (await page.locator('.stage-dots .dot').count()) === 3);
  check('activity bar height is handed to the widget', (await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('elevenlabs-convai')).getPropertyValue('--agent-stage-h'), 10))) >= 40);
  await page.close();
}
// 10. unknown / missing module -> default context, and no referenced variable is ever empty
{
  const page = await open('?module=no-such-lesson&debug=1');
  const d = await dbg(page);
  check('unknown module falls back to the default context', d.context === 'default' && d.contextMatched === false);
  const dv = JSON.parse(await page.locator('elevenlabs-convai').getAttribute('dynamic-variables'));
  check('no dynamic variable is empty', Object.values(dv).every((v) => String(v).trim().length > 0), JSON.stringify(dv));
  await page.close();
}
// 11. client tools: registered on the widget's call event, safe against hostile model output
{
  const page = await open('?module=wrap-up&debug=1');
  const names = await page.evaluate(() => {
    const w = document.querySelector('elevenlabs-convai');
    const ev = new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: { clientTools: { keepMe: () => 'x' } } } });
    w.dispatchEvent(ev);
    window.__tools = ev.detail.config.clientTools;
    return Object.keys(window.__tools).sort();
  });
  check('call event gets the four tools and keeps existing ones', JSON.stringify(names) === JSON.stringify(['celebrate', 'keepMe', 'mark_step', 'open_resource', 'show_card']), names.join(','));
  const r1 = await page.evaluate(() => window.__tools.show_card({ title: 'My prompt', body: '<img src=x onerror="window.__pwned=1"> Write 5 posts' }));
  check('show_card pins a note as plain text (no markup injection)', /pinned/.test(r1) && (await page.locator('.note-body').textContent()).includes('<img') && (await page.locator('.stage-notes img').count()) === 0 && !(await page.evaluate(() => window.__pwned)));
  check('a new note raises the badge while the drawer is closed', await page.locator('.stage-badge').isVisible());
  const r2 = await page.evaluate(() => [window.__tools.mark_step({ step: 2 }), window.__tools.mark_step({ step: 99 }), window.__tools.mark_step({ step: 'x' })]);
  check('mark_step ticks a valid step and rejects others', /1 of 4/.test(r2[0]) && /Invalid/.test(r2[1]) && /Invalid/.test(r2[2]) && (await page.locator('.stage-dots .dot.done').count()) === 1, JSON.stringify(r2));
  const r3 = await page.evaluate(() => [window.__tools.open_resource({ key: 'cohort-hub' }), window.__tools.open_resource({ key: 'https://evil.example' }), window.__tools.open_resource({ key: 'nope' })]);
  const hrefs = await page.locator('.stage-link').evaluateAll((els) => els.map((a) => a.getAttribute('href') + '|' + a.getAttribute('rel') + '|' + a.getAttribute('target')));
  check('open_resource only offers allowlisted links', /now on screen/.test(r3[0]) && /Unknown resource/.test(r3[1]) && /Unknown resource/.test(r3[2]) && hrefs.length === 1 && hrefs[0].startsWith('https://castershade.github.io/ai-essentials-agent/hub.html') && hrefs[0].includes('noopener') && hrefs[0].endsWith('_blank'), JSON.stringify(hrefs));
  const r4 = await page.evaluate(() => [window.__tools.celebrate({}), window.__tools.celebrate({})]);
  check('celebrate runs once and is rate-limited', /shown/.test(r4[0]) && /Already/.test(r4[1]), JSON.stringify(r4));
  const st = await page.evaluate(() => window.__agentEmbed.stage._state());
  check('stage state reflects tool calls', st.notes === 1 && st.links === 1 && st.done[1] === true && st.done[0] === false);
  check('open_resource opened the drawer, which lists the steps', (await page.locator('#agent-stage-panel li').count()) === 4 && await page.locator('#agent-stage-panel').isVisible());
  await page.locator('.stage-toggle').click();
  check('the Steps button toggles the drawer closed', !(await page.locator('#agent-stage-panel').isVisible()) && (await page.locator('.stage-toggle').getAttribute('aria-expanded')) === 'false');
  await page.locator('.stage-toggle').click();
  await page.locator('#agent-stage-panel li input').first().check();
  check('a student can tick a step by hand', (await page.evaluate(() => window.__agentEmbed.stage._state().done[0])) === true);
  await page.close();
}
// 12. stage can be switched off per embed; other providers never get one
{
  const page = await open('?module=types-of-ai&stage=0&debug=1');
  const d = await dbg(page);
  check('stage=0 hides the bar but still sends the context', d.stage === false && d.variables.lesson === 'AI Basics: Different Types of AI' && (await page.locator('.stage-bar').count()) === 0);
  await page.close();
  const p2 = await open('?agent=tutorbot-onla&module=types-of-ai&debug=1');
  check('gpt-trainer entries get no activity bar', (await dbg(p2)).stage === false && (await p2.locator('.stage-bar').count()) === 0);
  await p2.close();
}
// 13. registry outage: the emergency config still carries every variable the prompt references
{
  const page = await ctx.newPage();
  await page.route(/registry\.json/, (r) => r.abort());
  await page.goto(base + 'index.html?debug=1', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const dv = JSON.parse(await page.locator('elevenlabs-convai').getAttribute('dynamic-variables'));
  check('emergency config has lesson/activity/opener/steps', ['lesson', 'activity', 'opener', 'steps', 'course_name'].every((k) => String(dv[k] || '').trim().length > 0), JSON.stringify(Object.keys(dv)));
  await page.close();
}
// 14. Cohort Hub door: pending -> placeholder, active -> the frame is sent to the hosted hub
{
  const page = await ctx.newPage();
  await page.goto(base + 'hub.html?hub=chah-2026&space=question-box', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  check('pending hub shows the placeholder and stays put', (await page.locator('#hub-card').isVisible()) && (await page.locator('#hub-title').textContent()).length > 5 && page.url().includes('hub.html'));
  await page.close();

  const activeCfg = JSON.stringify({ version: 1, hubs: { 'chah-2026': { label: 'Hub', status: 'active', baseUrl: 'https://hub.example.test', cohort: 'chah-2026', defaultCourse: 'ai-essentials-hs', defaultSpace: 'question-box' } } });
  const seen = [];
  const p2 = await ctx.newPage();
  p2.on('request', (r) => { if (r.url().startsWith('https://hub.example.test')) seen.push(r.url()); });
  await p2.route(/hubs\.json/, (r) => r.fulfill({ contentType: 'application/json', body: activeCfg }));
  await p2.goto(base + 'hub.html?hub=chah-2026&space=wins&course=ai-essentials-hs', { waitUntil: 'load' }).catch(() => {});
  await p2.waitForTimeout(500);
  check('active hub, opened directly, goes to the full hub URL', seen[0] === 'https://hub.example.test/?cohort=chah-2026&course=ai-essentials-hs', seen[0]);
  await p2.close();

  const seen2 = [];
  const p3 = await ctx.newPage();
  p3.on('request', (r) => { if (r.url().startsWith('https://hub.example.test')) seen2.push(r.url()); });
  await p3.route(/hubs\.json/, (r) => r.fulfill({ contentType: 'application/json', body: activeCfg }));
  await p3.setContent(`<iframe src="${base}hub.html?hub=chah-2026&space=wins&space2=x" width="600" height="400"></iframe>`);
  await p3.waitForTimeout(800);
  check('active hub, inside an iframe, goes to /embed with cohort, course and space', seen2[0] === 'https://hub.example.test/embed?cohort=chah-2026&course=ai-essentials-hs&space=wins', seen2[0]);
  await p3.close();

  const p4 = await ctx.newPage();
  await p4.route(/hubs\.json/, (r) => r.fulfill({ contentType: 'application/json', body: activeCfg }));
  await p4.goto(base + 'hub.html?hub=chah-2026&space=%3Cscript%3E&debug=1', { waitUntil: 'load' });
  await p4.waitForTimeout(300);
  const hd = JSON.parse(await p4.locator('#hub-debug').textContent());
  check('hub door ignores a hostile space value and debug mode does not navigate', hd.space === 'question-box' && p4.url().includes('hub.html'));
  await p4.close();

  const p5 = await ctx.newPage();
  await p5.route(/hubs\.json/, (r) => r.abort());
  await p5.goto(base + 'hub.html', { waitUntil: 'load' });
  await p5.waitForTimeout(300);
  check('hubs.json outage shows a message, never a blank block', await p5.locator('#hub-card').isVisible());
  await p5.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
