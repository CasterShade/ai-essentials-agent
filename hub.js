/*
 * Cohort Hub door -- see hub.html. Reads hubs.json and either shows a placeholder (pending/paused)
 * or sends this frame to the hosted hub (active). No dependencies, ES2017, same style as embed.js.
 *
 *   ?hub=<key>            which hub (default: the only/first one in hubs.json)
 *   &space=question-box|this-week|wins|announcements   (default: the hub's defaultSpace)
 *   &course=<course slug>   pre-tags posts in the hub (default: the hub's defaultCourse)
 *   &join=1               top-level link only: open the join screen
 *   &debug=1              show what was resolved and do NOT navigate
 */
(function () {
  'use strict';
  var SPACES = ['question-box', 'this-week', 'wins', 'announcements'];

  function qs() {
    var out = {}; var s = (window.location.search || '').replace(/^\?/, '');
    s.split('&').forEach(function (kv) {
      if (!kv) return; var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)).trim();
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      if (k) out[k] = v;
    });
    return out;
  }
  function slug(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(v) ? v : null; }
  function $(id) { return document.getElementById(id); }
  function show(title, message, tiny, withSpaces) {
    $('hub-title').textContent = title;
    $('hub-message').textContent = message;
    $('hub-tiny').textContent = tiny || '';
    $('hub-spaces').style.display = withSpaces ? '' : 'none';
    $('hub-card').removeAttribute('hidden');
  }
  function debug(obj) {
    var pre = document.createElement('pre'); pre.id = 'hub-debug';
    pre.textContent = JSON.stringify(obj, null, 2); document.body.appendChild(pre);
  }

  var params = qs();
  var framed = false; try { framed = window.top !== window.self; } catch (e) { framed = true; }

  fetch('hubs.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('hubs.json HTTP ' + r.status);
    return r.json();
  }).then(function (cfg) {
    var hubs = (cfg && cfg.hubs) || {};
    var keys = Object.keys(hubs);
    var key = slug(String(params.hub || '').toLowerCase());
    if (!key || !hubs[key]) key = keys.length === 1 || !key ? keys[0] : null;
    var h = key ? hubs[key] : null;
    if (!h) { show('Cohort Hub', 'This link does not point at a cohort yet. Tell your instructor.', '', false); return; }

    var space = SPACES.indexOf(params.space) >= 0 ? params.space : (SPACES.indexOf(h.defaultSpace) >= 0 ? h.defaultSpace : 'question-box');
    var course = slug(String(params.course || '').toLowerCase()) || slug(h.defaultCourse) || '';
    var base = String(h.baseUrl || '').replace(/\/+$/, '');
    var target = null;
    if (h.status === 'active' && /^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(base)) {
      var q = 'cohort=' + encodeURIComponent(h.cohort || key) + (course ? '&course=' + encodeURIComponent(course) : '');
      target = framed ? (base + '/embed?' + q + '&space=' + encodeURIComponent(space))
                      : (base + '/?' + q + (params.join === '1' ? '&join=1' : ''));
    }
    if (params.debug === '1') debug({ hub: key, status: h.status, framed: framed, space: space, course: course, target: target });

    if (target && params.debug !== '1') { window.location.replace(target); return; }
    if (target) { show(h.label || 'Cohort Hub', 'Debug mode: this frame would now open the hub.', target, false); return; }
    if (h.status === 'paused') {
      show(h.label || 'Cohort Hub', h.pausedMessage || 'The Cohort Hub is taking a short break and will be back soon. Bring your questions to TutorBot or to the weekly session.', '', false);
      return;
    }
    show(h.pendingTitle || 'Your Cohort Hub is coming', h.pendingMessage || 'This is where your cohort will talk, ask questions and share wins.', h.label || '', true);
  }).catch(function (err) {
    console.error('[cohort-hub door]', err);
    show('Cohort Hub', 'The Cohort Hub could not be reached right now. Try again in a few minutes, or bring your question to TutorBot.', '', false);
  });
})();
