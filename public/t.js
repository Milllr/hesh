// hesh.ca's own tracking. Batches go to /api/t (functions/api/t.js) and show up in /admin.
// recorded: the page view and where it came from, sections read and for how long, scroll depth,
// clicks, video plays and watch time, photos opened, the snow gun, copied text, the signup form's
// steps (never what's typed), script errors, and the time someone was actually on the page.
// the visitor id is a cookie the server sets, so nothing here names anyone.
(function () {
  if (window.heshTrack) return;

  var EP = '/api/t';
  var path = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  var queue = [];
  var active = 0, lastTick = Date.now(), lastInput = Date.now(), lastSent = 0, began = Date.now();
  var maxScroll = 0, sentScroll = 0, interacted = false, sentInteracted = false, metaSent = false;
  var playing = [];

  function rnd() {
    var a = new Uint8Array(12), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s;
  }

  // a visit ends after 30 minutes with nothing happening; other tabs join the one going.
  // events are timed from when the visit started, which the server keeps them by
  function session() {
    var s = null, now = Date.now();
    try { s = JSON.parse(localStorage.getItem('hesh_s')); } catch (x) {}
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9]{8,32}$/.test(s.id) || !(now - s.at < 1800000) || !(s.st <= now)) s = { id: rnd(), st: now };
    began = s.st;
    keepAlive(s.id);
    return s.id;
  }
  function keepAlive(id) {
    try { localStorage.setItem('hesh_s', JSON.stringify({ id: id, at: Date.now(), st: began })); } catch (x) {}
  }
  var sid = session();
  // the old Apps Script tracker's keys
  try { localStorage.removeItem('hesh_vid'); localStorage.removeItem('hesh_visits'); } catch (x) {}

  function clean(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 160); }

  function track(type, label, value) {
    queue.push({ t: type, l: label == null ? undefined : clean(label), v: typeof value === 'number' ? Math.round(value) : undefined, at: Date.now() });
    if (queue.length >= 30) flush(false);
  }

  // engaged time: the tab is visible and they did something in the last 30 seconds, or a video
  // is playing (for up to 10 minutes untouched: a looping video left on a screen isn't a person)
  function tick(now) {
    var dt = now - lastTick;
    lastTick = now;
    var idle = now - lastInput;
    if (dt < 5000 && document.visibilityState === 'visible' && (idle < 30000 || (playing.length && idle < 600000))) active += dt;
  }

  function meta() {
    var q = new URLSearchParams(location.search), c = [];
    ['src', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
      var v = q.get(k);
      if (v) c.push(k + '=' + clean(v, 40));
    });
    ['fbclid', 'igsh', 'igshid', 'gclid', 'ttclid'].forEach(function (k) { if (q.get(k)) c.push(k); });
    return {
      r: document.referrer || '',
      c: c.join('&'),
      sc: screen.width + 'x' + screen.height,
      lg: navigator.language || '',
      tp: navigator.maxTouchPoints || 0,
      wd: navigator.webdriver ? 1 : 0
    };
  }

  // every batch is a database write, so they're kept few: new events go every 20 seconds,
  // engaged time alone once a minute, and everything when the tab goes away
  function flush(hiding) {
    var now = Date.now();
    tick(now);
    var e = queue.splice(0, 40).map(function (x) { return { t: x.t, l: x.l, v: x.v, k: x.at - began }; });
    var news = e.length || maxScroll > sentScroll || (interacted && !sentInteracted);
    if (!news && (active < 1000 || (!hiding && now - lastSent < 60000))) return;
    var body = { s: sid, p: path, k: now - began, e: e, a: Math.round(active), x: maxScroll, i: interacted ? 1 : 0 };
    if (!metaSent) { body.m = meta(); metaSent = true; }
    active = 0;
    sentScroll = maxScroll;
    if (interacted) sentInteracted = true;
    lastSent = now;
    keepAlive(sid);
    var json = JSON.stringify(body);
    // the page details make the visit; if they didn't get there, send them again next time
    function lost() { if (body.m) metaSent = false; }
    try {
      if (hiding && navigator.sendBeacon) { if (!navigator.sendBeacon(EP, new Blob([json], { type: 'application/json' }))) lost(); }
      else fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true, credentials: 'same-origin' })
        .then(function (r) { if (r.status >= 500) lost(); }, lost);
    } catch (x) { lost(); }
    if (queue.length) setTimeout(function () { flush(hiding); }, 0);
  }

  // where they came from, as the view's label
  var from = '';
  try {
    if (document.referrer) {
      var r = new URL(document.referrer);
      from = r.origin === location.origin ? 'from ' + (r.pathname.replace(/\.html$/, '') || '/') : 'from ' + r.host;
    }
  } catch (x) {}
  track('view', from);
  flush(false);

  // INPUT: any of these means a person is here
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'].forEach(function (ev) {
    addEventListener(ev, function () { lastInput = Date.now(); interacted = true; }, { passive: true, capture: true });
  });
  setInterval(function () { tick(Date.now()); }, 1000);
  setInterval(function () { flush(false); }, 20000);

  // SCROLL DEPTH: how much of the page they've seen
  var marks = [25, 50, 75, 100], scrollQueued = false;
  function measure() {
    scrollQueued = false;
    var full = document.documentElement.scrollHeight;
    var pct = full ? Math.min(100, Math.round((scrollY + innerHeight) / full * 100)) : 100;
    if (pct <= maxScroll) return;
    maxScroll = pct;
    while (marks.length && pct >= marks[0]) track('scroll', null, marks.shift());
  }
  addEventListener('scroll', function () { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(measure); } }, { passive: true });
  setTimeout(measure, 1000);

  // SECTIONS: which section sits across the middle of the screen, and for how long
  var open = {}, paused = [];
  function closeSection(id) {
    if (!open[id]) return;
    var s = Math.round((Date.now() - open[id]) / 1000);
    delete open[id];
    if (s >= 2) track('section', id, s);
  }
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { if (document.visibilityState === 'visible') open[en.target.id] = Date.now(); }
        else closeSection(en.target.id);
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('section[id]').forEach(function (el) { io.observe(el); });
  }

  // CLICKS: links and buttons, with where a link goes
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('a, button, [role="button"], summary');
    if (!el) return;
    var img = el.querySelector('img');
    var text = clean(el.getAttribute('aria-label') || el.textContent || (img && img.alt) || el.id, 60);
    var href = el.getAttribute('href'), to = '';
    if (href) {
      try {
        var u = new URL(href, location.href);
        to = u.origin === location.origin ? (u.pathname.replace(/\.html$/, '') || '/') + u.hash : u.host + u.pathname.replace(/\/$/, '');
      } catch (x) {}
    }
    track('click', to ? text + ' → ' + to : text);
  }, true);

  // PHOTOS: every photo shown in the lightbox
  var lbImg = document.getElementById('lb-img');
  if (lbImg && window.MutationObserver) {
    new MutationObserver(function () {
      var s = lbImg.getAttribute('src');
      if (s) track('photo', s.replace(/^.*\/img\//, ''));
    }).observe(lbImg, { attributes: true, attributeFilter: ['src'] });
  }

  // VIDEO: plays, pauses, how far in, sound, fullscreen, and seconds actually watched
  function mmss(t) { t = Math.floor(t || 0); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  var watchers = [];
  document.querySelectorAll('video').forEach(function (v) {
    var sec = v.closest('section'), h = sec && sec.querySelector('h2');
    var name = clean(h ? h.textContent : v.id || 'video', 40);
    var watched = 0, last = null, reached = 0, sound = false;
    function report() { if (watched >= 1) track('watch', name, watched); watched = 0; }
    function stop() { var i = playing.indexOf(v); if (i >= 0) playing.splice(i, 1); }
    watchers.push(report);
    v.addEventListener('play', function () { if (playing.indexOf(v) < 0) playing.push(v); last = v.currentTime; track('video', name + ': play'); });
    v.addEventListener('pause', function () { stop(); track('video', name + ': pause at ' + mmss(v.currentTime)); report(); });
    v.addEventListener('ended', function () { stop(); track('video', name + ': to the end'); report(); });
    v.addEventListener('timeupdate', function () {
      var t = v.currentTime;
      if (last != null && t > last && t - last < 2) watched += t - last;
      // looping videos never end; going back to the start after the last quarter counts as the end
      if (last != null && v.duration && last - t > v.duration / 2) { track('video', name + ': to the end'); reached = 0; }
      last = t;
      if (v.duration) {
        var q = Math.floor(t / v.duration * 4) * 25;
        if (q > reached && q < 100) { reached = q; track('video', name + ': ' + q + '%'); }
      }
    });
    v.addEventListener('volumechange', function () {
      if (!sound && !v.muted && v.volume > 0 && !v.paused) { sound = true; track('video', name + ': sound on'); }
    });
    v.addEventListener('webkitbeginfullscreen', function () { track('video', name + ': fullscreen'); });
  });
  document.addEventListener('fullscreenchange', function () {
    var el = document.fullscreenElement;
    if (el && el.tagName === 'VIDEO') {
      var sec = el.closest('section'), h = sec && sec.querySelector('h2');
      track('video', clean(h ? h.textContent : 'video', 40) + ': fullscreen');
    }
  });

  // SNOW GUN: how long they held it (the frost starts at 2.2 s)
  var gun = document.getElementById('heroTitle'), held = 0;
  if (gun) {
    var start = function () { if (!held) held = Date.now(); };
    var end = function () { if (held) { var ms = Date.now() - held; held = 0; if (ms >= 300) track('snow', 'snow gun', ms); } };
    gun.addEventListener('mouseenter', start);
    gun.addEventListener('touchstart', start, { passive: true });
    gun.addEventListener('mouseleave', end);
    gun.addEventListener('touchend', end);
  }

  // FORM: which fields they started (only the field, never the text)
  var started = {};
  document.addEventListener('focusin', function (ev) {
    var el = ev.target;
    if (!el.matches || !el.matches('input, textarea, select') || el.closest('.hp')) return;
    var f = el.getAttribute('autocomplete') || el.name || el.id || el.type;
    if (started[f]) return;
    started[f] = true;
    track('form', 'started ' + f);
  });

  // COPY: what they copied off the page
  document.addEventListener('copy', function () {
    var s = clean(window.getSelection ? window.getSelection() : '', 80);
    if (s) track('copy', s);
  });

  // ERRORS: so a broken page shows up
  var errors = 0;
  addEventListener('error', function (e) {
    if (errors++ < 5) track('error', (e.message || 'error') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  });

  // LEAVING: close what's open and send it while the page can still talk
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      Object.keys(open).forEach(function (id) { closeSection(id); paused.push(id); });
      watchers.forEach(function (w) { w(); });
      flush(true);
    } else {
      lastTick = lastInput = Date.now();
      paused.forEach(function (id) { open[id] = Date.now(); });
      paused = [];
    }
  });
  addEventListener('pagehide', function () { flush(true); });
  addEventListener('pageshow', function (e) { if (e.persisted) { sid = session(); metaSent = false; track('view', 'back'); flush(false); } });

  // for page code: heshTrack('signup', 'booth-qr')
  window.heshTrack = function (type, label, value) { track(type, label, value); flush(false); };
})();
