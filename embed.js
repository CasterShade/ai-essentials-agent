/*
 * Agent embed middle layer -- https://castershade.github.io/ai-essentials-agent/
 *
 * Courses embed THIS page (by agent KEY). This file resolves the key through
 * registry.json and mounts the right provider widget. Nothing provider-specific
 * ever lives inside a course.
 *
 *   URL contract (all optional):
 *     ?agent=<key|alias>      which agent (default: registry.default)
 *     &mode=full|bubble       full = fills the block (iframe use); bubble = provider's floating launcher
 *     &course_id=&course_name=&module=&lang=&user=   context variables (merged over the entry's defaults)
 *     &module=<context key>   ALSO selects a lesson context from the entry's `contexts` map: the agent
 *                             is told which lesson/activity it is sitting in (dynamic variables lesson,
 *                             activity, opener, steps) and the activity bar shows the steps. Unknown or
 *                             missing module -> the entry's "default" context. One agent, many pages.
 *     &stage=0                hide the activity bar (the context variables are still sent)
 *     &debug=1                show the resolved config in an overlay
 *
 *   Resolution order: URL agent -> alias map -> redirect chain (max 5) -> status check
 *                     -> fallback (registry.fallback) with a visible notice, never a blank block.
 *
 * No build step, no dependencies, ES2017. Keep it that way: the fewer moving parts,
 * the less that can rot over a two-year program.
 */
(function () {
  'use strict';

  var REGISTRY_URL = 'registry.json';
  var MAX_REDIRECTS = 5;

  // Baked-in last resort if registry.json itself cannot be fetched (CDN hiccup, offline).
  // Keep this identical to the registry's fallback entry.
  var EMERGENCY = {
    key: 'ai-essentials-hs',
    entry: {
      label: 'AI Essentials: Helping Local Businesses (High School Edition)',
      provider: 'elevenlabs',
      agentId: 'agent_4001m269sgbaekjsmned83s8fy3d',
      status: 'active',
      mode: 'full',
      variables: { course_id: 'AI-ESS-HS', course_name: 'AI Essentials: Helping Local Businesses (High School Edition)', module: 'default', lang: 'en',
        // Every variable the agent prompt / first message references MUST have a value here too,
        // or a registry outage would also break the conversation. Keep in sync with registry.json.
        lesson: 'AI Essentials (general help)',
        activity: 'Open conversation. Help the student with anything from the course.',
        opener: 'Hi, I am TutorBot, your AI study partner for this course. What are you working on?',
        steps: 'No fixed steps for this chat.' },
      options: { variant: 'full', placement: 'bottom', 'always-expanded': 'true', 'show-resize-button': 'false', transcript: 'true', 'text-input': 'true' },
      overrides: {}
    },
    providers: {
      elevenlabs: { scriptUrl: 'https://unpkg.com/@elevenlabs/convai-widget-embed' },
      'gpt-trainer': { widgetBase: 'https://app.gpt-trainer.com/widget/', bubbleScriptUrl: 'https://app.gpt-trainer.com/widget-asset.min.js' }
    }
  };

  // ---------- helpers ----------
  function qs() {
    var out = {};
    var s = (window.location.search || '').replace(/^\?/, '');
    if (!s) return out;
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)).trim();
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      if (k) out[k] = v;
    });
    return out;
  }
  function el(tag, attrs, parent) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      e.setAttribute(k, String(attrs[k]));
    });
    if (parent) parent.appendChild(e);
    return e;
  }
  function safeKey(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(v) ? v : null; }
  function clean(v, max) { v = (v == null ? '' : String(v)); return v.length > (max || 200) ? v.slice(0, max || 200) : v; }
  function notice(text, kind) {
    var n = document.getElementById('agent-notice');
    if (!n) return;
    n.textContent = text;
    n.className = 'notice ' + (kind || 'info');
    n.style.display = text ? 'block' : 'none';
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-provider-script="' + src + '"]');
      if (existing) return resolve();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.type = 'text/javascript';
      s.setAttribute('data-provider-script', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ---------- registry ----------
  function fetchRegistry() {
    // no-cache = revalidate with the CDN each load. GitHub Pages still serves
    // max-age=600 at the edge, so a registry edit is live within ~10 minutes.
    return fetch(REGISTRY_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('registry HTTP ' + r.status);
      return r.json();
    });
  }

  function resolve(reg, wantedKey) {
    var agents = reg.agents || {};
    var aliases = {};
    Object.keys(agents).forEach(function (k) {
      (agents[k].aliases || []).forEach(function (a) { if (!aliases[a]) aliases[a] = k; });
    });
    var key = wantedKey || reg['default'];
    var trail = [];
    var reason = null;

    for (var hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!agents[key] && aliases[key]) key = aliases[key];
      var entry = agents[key];
      if (!entry) { reason = 'Unknown agent key "' + (wantedKey || key) + '"'; break; }
      trail.push(key);
      if (entry.status === 'retired' || entry.redirect) {
        if (entry.redirect && hop < MAX_REDIRECTS) { key = entry.redirect; continue; }
        if (entry.status === 'retired') { reason = 'Agent "' + key + '" is retired'; break; }
      }
      return { key: key, entry: entry, trail: trail, fellBack: false, reason: null };
    }
    // fallback path
    var fb = reg.fallback && agents[reg.fallback] && agents[reg.fallback].status === 'active' ? reg.fallback : null;
    if (!fb) {
      var firstActive = Object.keys(agents).filter(function (k) { return agents[k].status === 'active'; })[0];
      fb = firstActive || null;
    }
    if (!fb) throw new Error((reason || 'No agent') + ' and no active fallback');
    return { key: fb, entry: agents[fb], trail: trail.concat([fb]), fellBack: true, reason: reason || 'redirect loop' };
  }

  // Lesson context: ?module=<key> picks entry.contexts[key]; anything else -> entry.contexts.default.
  // A context is { lesson, activity, opener, steps[] } -- plain text, edited in registry.json,
  // so what the agent knows about a page changes without touching the course.
  function pickContext(entry, params) {
    var all = entry.contexts || {};
    var k = safeKey(String(params.module || '').toLowerCase());
    if (k && all[k] && typeof all[k] === 'object') return { key: k, ctx: all[k], matched: true };
    if (all['default'] && typeof all['default'] === 'object') return { key: 'default', ctx: all['default'], matched: !k };
    return { key: null, ctx: null, matched: !k };
  }

  function buildVariables(entry, params, picked) {
    var vars = {};
    var defaults = entry.variables || {};
    Object.keys(defaults).forEach(function (k) { vars[k] = String(defaults[k]); });
    ['course_id', 'course_name', 'module', 'lang', 'user'].forEach(function (k) {
      if (params[k] !== undefined && params[k] !== '') vars[k] = clean(params[k], 200);
    });
    var c = picked && picked.ctx;
    if (c) {
      if (c.lesson) vars.lesson = clean(c.lesson, 200);
      if (c.activity) vars.activity = clean(c.activity, 1200);
      if (c.opener) vars.opener = clean(c.opener, 400);
      if (Array.isArray(c.steps) && c.steps.length) {
        vars.steps = clean(c.steps.map(function (t, i) { return (i + 1) + ') ' + t; }).join(' '), 1200);
      }
      vars.module = picked.key;
    }
    // A dynamic variable the agent prompt references must never arrive empty (the conversation
    // fails to start). Anything still blank gets a harmless literal.
    Object.keys(vars).forEach(function (k) { if (vars[k] === '') vars[k] = 'not set'; });
    return vars;
  }

  // ---------- provider adapters ----------
  var adapters = {

    /* ElevenLabs Agents widget.
       Attribute names below are the ones the widget bundle actually reads
       (@elevenlabs/convai-widget-embed 0.18.2: agent-id, variant[tiny|compact|full],
       placement[top-left|top|top-right|bottom-left|bottom|bottom-right], always-expanded,
       default-expanded, dismissible, show-resize-button, transcript, text-input, mic-muting,
       dynamic-variables, override-language/-prompt/-first-message/-voice-id, avatar-*, user-id).
       Overrides only work if enabled in the agent's Security tab -- so they are opt-in per entry. */
    elevenlabs: function (ctx) {
      var entry = ctx.entry, mode = ctx.mode, vars = ctx.vars, mount = ctx.mount;
      var allowedOpts = ['variant', 'placement', 'always-expanded', 'default-expanded', 'dismissible',
        'show-resize-button', 'transcript', 'text-input', 'mic-muting', 'avatar-image-url',
        'avatar-orb-color-1', 'avatar-orb-color-2', 'language', 'server-location',
        'action-text', 'start-call-text', 'end-call-text', 'expand-text', 'listening-text', 'speaking-text'];
      var attrs = { 'agent-id': entry.agentId };
      var opts = entry.options || {};
      allowedOpts.forEach(function (k) { if (opts[k] !== undefined) attrs[k] = opts[k]; });

      if (mode === 'full') {
        attrs['always-expanded'] = 'true';
        attrs['variant'] = attrs['variant'] || 'full';
        attrs['placement'] = attrs['placement'] || 'bottom';
        attrs['show-resize-button'] = attrs['show-resize-button'] || 'false';
      } else {
        delete attrs['always-expanded'];
        attrs['placement'] = attrs['placement'] || 'bottom-right';
        attrs['variant'] = attrs['variant'] || 'compact';
      }

      attrs['dynamic-variables'] = JSON.stringify(vars);
      if (vars.user) attrs['user-id'] = vars.user;

      var ov = entry.overrides || {};
      if (ov.language && vars.lang) attrs['override-language'] = vars.lang;
      if (ov['first-message'] && opts['first-message']) attrs['override-first-message'] = opts['first-message'];

      var widget = el('elevenlabs-convai', attrs, mount);
      if (ctx.stage) {
        // Client tools: the widget fires this event right before a conversation starts and reads
        // config.clientTools back. Tool NAMES must match the client tools defined on the agent;
        // a tool the agent does not know about is simply never called, so this is safe to ship first.
        widget.addEventListener('elevenlabs-convai:call', function (event) {
          try {
            var cfg = event && event.detail && event.detail.config;
            if (!cfg) return;
            cfg.clientTools = Object.assign({}, cfg.clientTools || {}, ctx.stage.tools);
          } catch (e) { console.warn('[agent-embed] could not register client tools:', e); }
        });
        ctx.stage.attach(widget);
      }
      if (mode === 'full') fillBlockElevenLabs(widget);
      return loadScript((ctx.providers.elevenlabs || EMERGENCY.providers.elevenlabs).scriptUrl);
    },

    /* GPT-Trainer. Full mode = hosted widget page in an iframe + the postMessage
       handshake their dashboard emits (gpt_chatbot_state ready -> gpt_initial_messages_variables).
       Bubble mode = their floating widget script with window.GPTTConfig.
       The variables passed must exist in the bot under Customizations > User Data Collection. */
    'gpt-trainer': function (ctx) {
      var entry = ctx.entry, mode = ctx.mode, vars = ctx.vars, mount = ctx.mount;
      var prov = ctx.providers['gpt-trainer'] || EMERGENCY.providers['gpt-trainer'];
      var variables = { course_id: vars.course_id || '', course_name: vars.course_name || '' };
      Object.keys(vars).forEach(function (k) { if (variables[k] === undefined) variables[k] = vars[k]; });

      if (mode === 'bubble') {
        window.GPTTConfig = { uuid: entry.botUuid, initial_messages_variables: variables };
        return loadScript(prov.bubbleScriptUrl);
      }
      var frame = el('iframe', {
        id: 'chatbot-widget-window-iframe',
        src: prov.widgetBase + entry.botUuid,
        title: entry.label,
        allow: 'clipboard-write',
        style: 'border:0;width:100%;height:100%;display:block;background:transparent'
      }, mount);
      var payload = { type: 'gpt_initial_messages_variables', variables: variables };
      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (msg && msg.type === 'gpt_chatbot_state' && msg.payload && msg.payload.ready) {
          if (event.source && event.source.postMessage) event.source.postMessage(payload, '*');
        }
      });
      return Promise.resolve(frame);
    },

    /* Generic hosted page (any future provider that gives us a URL).
       {course_id} {course_name} {module} {lang} {user} placeholders are filled in. */
    url: function (ctx) {
      var u = String(ctx.entry.url || '');
      Object.keys(ctx.vars).forEach(function (k) {
        u = u.split('{' + k + '}').join(encodeURIComponent(ctx.vars[k]));
      });
      el('iframe', { src: u, title: ctx.entry.label, allow: 'microphone; clipboard-write',
        style: 'border:0;width:100%;height:100%;display:block' }, ctx.mount);
      return Promise.resolve();
    }
  };

  // The ElevenLabs sheet floats at ~400x550 by default; in an iframe block we want it to fill.
  // The widget renders into an OPEN shadow root, so we drop an override stylesheet in there.
  // If their internal class names change, this silently does nothing and the widget still works.
  function fillBlockElevenLabs(widget) {
    var CSS = [
      ':host{--el-overlay-padding:8px !important;}',
      '.overlay{inset:8px !important;top:calc(var(--agent-stage-h, 0px) + 8px) !important;}',
      '.sheet[data-variant]{width:100% !important;max-width:none !important;',
      '  height:100% !important;max-height:none !important;margin:0 !important;}'
    ].join('\n');
    function inject() {
      var root = widget.shadowRoot;
      if (!root) return false;
      if (root.querySelector('style[data-fill-block]')) return true;
      var s = document.createElement('style');
      s.setAttribute('data-fill-block', '');
      s.textContent = CSS;
      root.appendChild(s);
      return true;
    }
    function start() {
      if (inject()) return;
      var tries = 0;
      var t = setInterval(function () { if (inject() || ++tries > 200) clearInterval(t); }, 100);
    }
    if (window.customElements && customElements.whenDefined) {
      customElements.whenDefined('elevenlabs-convai').then(start, start);
    } else { start(); }
  }

  // ---------- activity bar ("stage") + client tools ----------
  // A thin bar above the widget: which activity this chat box is for, its steps, and a drawer
  // where the agent can pin notes and approved links. Everything the agent sends is rendered
  // with textContent (never innerHTML), length-capped, and links come ONLY from the registry's
  // `resources` allowlist -- the model cannot put an arbitrary URL or markup on a student's screen.
  function createStage(entry, picked) {
    var c = (picked && picked.ctx) || {};
    var steps = Array.isArray(c.steps) ? c.steps.slice(0, 6).map(function (t) { return clean(t, 160); }) : [];
    var enabled = Array.isArray(entry.clientTools) ? entry.clientTools : [];
    var resources = entry.resources && typeof entry.resources === 'object' ? entry.resources : {};
    if (!c.lesson && !steps.length && !enabled.length) return null;

    var host = document.getElementById('agent-stage');
    if (!host) { host = el('div', { id: 'agent-stage' }); document.body.insertBefore(host, document.body.firstChild); }
    host.className = 'stage';
    host.textContent = '';

    var bar = el('div', { 'class': 'stage-bar' }, host);
    var titleBox = el('div', { 'class': 'stage-title' }, bar);
    var kicker = el('span', { 'class': 'stage-kicker' }, titleBox); kicker.textContent = c.kicker ? clean(c.kicker, 40) : 'Activity';
    var name = el('span', { 'class': 'stage-name' }, titleBox); name.textContent = clean(c.title || c.lesson || entry.label, 90);
    var dots = el('div', { 'class': 'stage-dots', role: 'img' }, bar);
    var toggle = el('button', { 'class': 'stage-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'agent-stage-panel' }, bar);
    var toggleLabel = el('span', null, toggle); toggleLabel.textContent = steps.length ? 'Steps' : 'Notes';
    var badge = el('span', { 'class': 'stage-badge', hidden: 'hidden' }, toggle);

    var panel = el('div', { id: 'agent-stage-panel', 'class': 'stage-panel', hidden: 'hidden' }, host);
    var stepList = el('ol', { 'class': 'stage-steps' }, panel);
    var notesBox = el('div', { 'class': 'stage-notes', 'aria-live': 'polite' }, panel);
    var linksBox = el('div', { 'class': 'stage-links' }, panel);
    var toast = el('div', { 'class': 'stage-toast', role: 'status', 'aria-live': 'polite', hidden: 'hidden' }, host);

    var done = steps.map(function () { return false; });
    var unseen = 0, widgetRef = null;

    function renderDots() {
      dots.textContent = '';
      done.forEach(function (d) { var s = el('span', { 'class': 'dot' + (d ? ' done' : '') }, dots); s.textContent = ''; });
      var n = done.filter(Boolean).length;
      dots.setAttribute('aria-label', steps.length ? (n + ' of ' + steps.length + ' steps done') : '');
      dots.style.display = steps.length ? '' : 'none';
    }
    function setStep(i, val) {
      if (i < 0 || i >= steps.length) return false;
      done[i] = !!val;
      var li = stepList.children[i];
      if (li) { li.className = val ? 'done' : ''; var cb = li.querySelector('input'); if (cb) cb.checked = !!val; }
      renderDots();
      return true;
    }
    steps.forEach(function (t, i) {
      var li = el('li', null, stepList);
      var lab = el('label', null, li);
      var cb = el('input', { type: 'checkbox' }, lab);
      var span = el('span', null, lab); span.textContent = t;
      cb.addEventListener('change', function () { setStep(i, cb.checked); });
    });
    if (!steps.length) stepList.style.display = 'none';
    renderDots();

    function syncHeight() {
      var h = bar.offsetHeight || 0;
      document.documentElement.style.setProperty('--agent-stage-h', h + 'px');
      if (widgetRef) widgetRef.style.setProperty('--agent-stage-h', h + 'px');
    }
    function openPanel(open) {
      if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', 'hidden');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { unseen = 0; badge.setAttribute('hidden', 'hidden'); toast.setAttribute('hidden', 'hidden'); }
    }
    toggle.addEventListener('click', function () { openPanel(panel.hasAttribute('hidden')); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openPanel(false); });
    function bump() {
      if (!panel.hasAttribute('hidden')) return;
      unseen++; badge.textContent = String(unseen); badge.removeAttribute('hidden');
    }
    function say(text) {
      if (!panel.hasAttribute('hidden')) return;   // the drawer already shows the change
      toast.textContent = text; toast.removeAttribute('hidden');
      clearTimeout(say._t); say._t = setTimeout(function () { toast.setAttribute('hidden', 'hidden'); }, 2600);
    }
    function copyText(text, btn) {
      function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); }
      function legacy() {
        try {
          var ta = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' }, document.body);
          ta.value = text; ta.select(); var good = document.execCommand('copy'); document.body.removeChild(ta);
          if (good) ok(); else btn.textContent = 'Select the text to copy';
        } catch (e) { btn.textContent = 'Select the text to copy'; }
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, legacy);
        else legacy();
      } catch (e) { legacy(); }
    }

    var tools = {};
    var impl = {
      // Pin a short note (a finished prompt, a key takeaway) the student can copy.
      show_card: function (p) {
        p = p || {};
        var title = clean(p.title, 80) || 'Note', body = clean(p.body, 700);
        if (!body) return 'Nothing shown: body was empty.';
        if (notesBox.children.length >= 8) notesBox.removeChild(notesBox.firstChild);
        var card = el('div', { 'class': 'note' }, notesBox);
        var h = el('div', { 'class': 'note-title' }, card); h.textContent = title;
        var b = el('div', { 'class': 'note-body' }, card); b.textContent = body;
        var cp = el('button', { 'class': 'note-copy', type: 'button' }, card); cp.textContent = 'Copy';
        cp.addEventListener('click', function () { copyText(body, cp); });
        bump(); say('New note: ' + title);
        return 'The note "' + title + '" is now pinned on the student\'s screen (Notes drawer).';
      },
      // Tick a step of this activity. step is 1-based.
      mark_step: function (p) {
        var n = parseInt(p && p.step, 10);
        if (!steps.length) return 'This activity has no step list.';
        if (!(n >= 1 && n <= steps.length)) return 'Invalid step. This activity has steps 1 to ' + steps.length + '.';
        setStep(n - 1, true);
        var count = done.filter(Boolean).length;
        say('Step ' + n + ' done');
        return count === steps.length ? 'All ' + steps.length + ' steps are done.' : ('Step ' + n + ' marked done. ' + count + ' of ' + steps.length + ' complete.');
      },
      // A short burst of confetti. Rate-limited so it stays special.
      celebrate: function () {
        var now = Date.now();
        if (impl.celebrate._last && now - impl.celebrate._last < 60000) return 'Already celebrated a moment ago.';
        impl.celebrate._last = now;
        confetti(host); say('Nice work!');
        return 'Celebration shown.';
      },
      // Offer a button for an APPROVED link (registry `resources`). Never opens anything by itself.
      open_resource: function (p) {
        var key = safeKey(String((p && p.key) || '').toLowerCase());
        var r = key && resources[key];
        if (!r || !/^https:\/\//.test(r.url || '')) return 'Unknown resource. Available keys: ' + (Object.keys(resources).join(', ') || 'none') + '.';
        var exists = linksBox.querySelector('a[data-key="' + key + '"]');
        if (!exists) {
          var a = el('a', { 'class': 'stage-link', href: r.url, target: '_blank', rel: 'noopener noreferrer', 'data-key': key }, linksBox);
          a.textContent = 'Open: ' + clean(r.label || key, 60);
        }
        openPanel(true);
        return 'A button labelled "' + clean(r.label || key, 60) + '" is now on screen. Ask the student to click it; it opens in a new tab.';
      }
    };
    enabled.forEach(function (n) {
      if (!impl[n]) return;
      tools[n] = function (params) {
        try { return impl[n](params || {}); }
        catch (e) { console.warn('[agent-embed] tool ' + n + ' failed:', e); return 'The on-screen helper failed; carry on without it.'; }
      };
    });

    document.body.setAttribute('data-stage', '1');
    if (window.ResizeObserver) { try { new ResizeObserver(syncHeight).observe(bar); } catch (e) { /* ignore */ } }
    window.addEventListener('resize', syncHeight);
    setTimeout(syncHeight, 0);

    return {
      tools: tools,
      attach: function (widget) { widgetRef = widget; syncHeight(); },
      // exposed for the smoke test and for debugging from the console
      _state: function () { return { steps: steps.slice(), done: done.slice(), notes: notesBox.children.length, links: linksBox.children.length }; }
    };
  }

  function confetti(host) {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var cv = el('canvas', { 'class': 'stage-confetti', 'aria-hidden': 'true' }, document.body);
      var w = cv.width = window.innerWidth, h = cv.height = window.innerHeight;
      var g = cv.getContext('2d'); if (!g) { document.body.removeChild(cv); return; }
      var colors = ['#1f3a5f', '#2792dc', '#f0b429', '#e4572e', '#17b890', '#9c6ade'];
      var parts = []; for (var i = 0; i < 90; i++) parts.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.4, y: h * 0.25, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 2, s: 4 + Math.random() * 5, c: colors[i % colors.length], r: Math.random() * 6 });
      var t0 = Date.now();
      (function frame() {
        var t = Date.now() - t0; g.clearRect(0, 0, w, h);
        parts.forEach(function (p) { p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.r += 0.2; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.globalAlpha = Math.max(0, 1 - t / 2200); g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); g.restore(); });
        if (t < 2200) requestAnimationFrame(frame); else if (cv.parentNode) cv.parentNode.removeChild(cv);
      })();
    } catch (e) { /* decoration only */ }
  }

  // ---------- main ----------
  function main() {
    var params = qs();
    var mount = document.getElementById('agent-mount');
    var wanted = safeKey((params.agent || '').toLowerCase());
    var modeParam = params.mode === 'bubble' ? 'bubble' : (params.mode === 'full' ? 'full' : null);

    fetchRegistry().catch(function (err) {
      console.warn('[agent-embed] registry unavailable, using emergency config:', err);
      notice('Agent directory unavailable; loaded the default assistant.', 'warn');
      var reg = { 'default': EMERGENCY.key, fallback: EMERGENCY.key, providers: EMERGENCY.providers, agents: {} };
      reg.agents[EMERGENCY.key] = EMERGENCY.entry;
      return reg;
    }).then(function (reg) {
      var r = resolve(reg, wanted);
      var entry = r.entry;
      var mode = modeParam || entry.mode || 'full';
      var picked = pickContext(entry, params);
      var vars = buildVariables(entry, params, picked);
      var stage = (mode === 'full' && params.stage !== '0' && entry.provider === 'elevenlabs' && entry.stage !== false)
        ? createStage(entry, picked) : null;
      if (params.debug === '1') window.__agentEmbed = { stage: stage, picked: picked };
      var ctx = { key: r.key, entry: entry, mode: mode, vars: vars, mount: mount, providers: reg.providers || {}, stage: stage, picked: picked };

      document.title = entry.label + ' -- Talk to the assistant';
      document.body.setAttribute('data-provider', entry.provider);
      document.body.setAttribute('data-mode', mode);
      if (r.fellBack) notice('This course is pointed at "' + (wanted || '?') + '", which is not available (' + r.reason + '). Showing "' + r.key + '" instead. Tell the course owner.', 'warn');

      if (params.debug === '1') {
        var dbg = el('pre', { id: 'agent-debug' }, document.body);
        dbg.textContent = JSON.stringify({ resolved: r.key, trail: r.trail, fellBack: r.fellBack, provider: entry.provider, mode: mode, context: picked.key, contextMatched: picked.matched, stage: !!stage, clientTools: stage ? Object.keys(stage.tools) : [], variables: vars, options: entry.options || {} }, null, 2);
      }

      var adapter = adapters[entry.provider];
      if (!adapter) throw new Error('No adapter for provider "' + entry.provider + '"');
      return adapter(ctx);
    }).catch(function (err) {
      console.error('[agent-embed]', err);
      notice('The assistant could not be loaded. ' + (err && err.message ? err.message : ''), 'error');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
