/*
 * Host-page chat bubble (provider-independent).
 *
 *   <script src="https://castershade.github.io/ai-essentials-agent/loader.js"
 *           data-agent="tutorbot-onla" data-course-id="MAR 2501" data-course-name="Buyer Behavior"
 *           data-position="bottom-right" data-label="Ask the Tutorbot" async></script>
 *
 * Injects a launcher button and a hidden iframe pointing at index.html (mode=full) for the
 * given agent key. The provider widget lives inside our iframe, so swapping providers in
 * registry.json changes the bubble everywhere without touching any host page.
 * Use this on Thinkific "Site footer code" or any page where a floating bubble is wanted.
 * For an in-lesson block (Rise), embed index.html directly in an iframe instead.
 */
(function () {
  'use strict';
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  if (!script) return;
  var ds = script.dataset || {};
  var base = script.src.replace(/loader\.js.*$/, '');
  var key = (ds.agent || '').toLowerCase();
  var q = [];
  if (key) q.push('agent=' + encodeURIComponent(key));
  q.push('mode=full');
  ['courseId', 'courseName', 'module', 'lang', 'user'].forEach(function (k) {
    if (ds[k]) q.push(k.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }) + '=' + encodeURIComponent(ds[k]));
  });
  var src = base + 'index.html?' + q.join('&');
  var pos = ds.position === 'bottom-left' ? 'left' : 'right';
  var label = ds.label || 'Ask the assistant';
  var width = parseInt(ds.width || '400', 10), height = parseInt(ds.height || '600', 10);
  if (document.getElementById('agent-bubble-root')) return;

  var root = document.createElement('div');
  root.id = 'agent-bubble-root';
  root.innerHTML =
    '<style>' +
    '#agent-bubble-root{position:fixed;bottom:20px;' + pos + ':20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '#agent-bubble-btn{display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;font-size:15px;font-weight:600;color:#fff;background:#1f3a5f;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}' +
    '#agent-bubble-btn:hover{background:#2b5285}' +
    '#agent-bubble-panel{display:none;position:absolute;bottom:64px;' + pos + ':0;width:min(' + width + 'px,calc(100vw - 32px));height:min(' + height + 'px,calc(100vh - 100px));border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#fff}' +
    '#agent-bubble-panel.open{display:block}' +
    '#agent-bubble-panel iframe{width:100%;height:100%;border:0;display:block}' +
    '</style>' +
    '<div id="agent-bubble-panel" role="dialog" aria-label="' + label.replace(/"/g, '&quot;') + '"></div>' +
    '<button id="agent-bubble-btn" type="button" aria-expanded="false">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>' +
    '<span>' + label.replace(/</g, '&lt;') + '</span></button>';
  document.body.appendChild(root);

  var btn = document.getElementById('agent-bubble-btn');
  var panel = document.getElementById('agent-bubble-panel');
  var loaded = false;
  btn.addEventListener('click', function () {
    var open = !panel.classList.contains('open');
    if (open && !loaded) {
      var f = document.createElement('iframe');
      f.src = src; f.title = label;
      f.setAttribute('allow', 'microphone; clipboard-write');
      panel.appendChild(f); loaded = true;
    }
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('span').textContent = open ? 'Close' : label;
  });
})();
