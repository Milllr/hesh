// the /admin portal. Every number comes from /admin/api/*. Anything a visitor could have made up
// (names, clicked text, referrers, user agents) goes into the page as text through h(), never as
// html, and the portal's CSP allows no inline script on top of that.
(function () {
  'use strict';

  const view = document.getElementById('view');

  // ---------- dom ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => add(el, x));
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // view.append() would print a null as the word "null"; this skips them
  const put = (...kids) => add(view, kids);
  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, text) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  // ---------- api ----------
  async function api(path, opts = {}) {
    const res = await fetch('/admin/api/' + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      location.replace('/admin/login');
      throw new Error('signed out');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'that didn\'t work (' + res.status + ')');
    return data;
  }

  function pref(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('admin_' + k);
      localStorage.setItem('admin_' + k, v);
    } catch (x) {}
    return null;
  }

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat();
  const n = (x) => nf.format(x || 0);
  const compact = (x) => (x >= 10000 ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(x) : n(x));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
  function dur(ms) {
    const sec = Math.round((ms || 0) / 1000);
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm ' + (sec % 60) + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayName = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  function when(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const ago = (Date.now() - d) / 1000;
    if (ago < 60) return 'just now';
    if (ago < 3600) return Math.floor(ago / 60) + ' min ago';
    if (d.toDateString() === new Date().toDateString()) return 'today ' + clock(iso);
    if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'yesterday ' + clock(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  let regions = null;
  try { regions = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (x) {}
  function country(code) {
    if (!code) return null;
    try { return (regions && regions.of(code)) || code; } catch (x) { return code; }
  }
  function where(r) {
    const parts = [r.city, r.region && r.region !== r.city ? r.region : null, country(r.country)].filter(Boolean);
    return parts.length ? parts.join(', ') : 'unknown place';
  }
  const what = (r) => [r.device, r.browser && r.browser !== 'other' ? r.browser : null, r.os && r.os !== 'other' ? r.os : null].filter(Boolean).join(' · ') || 'unknown device';
  function who(r) {
    if (r.signup_name) return r.signup_name + (r.signups > 1 ? ' + ' + (r.signups - 1) + ' more on this device' : '');
    if (r.link_label) return r.link_label;
    return 'someone in ' + (r.city || country(r.country) || 'an unknown place');
  }
  function flags(r) {
    return [r.link_label && r.signup_name ? h('span', { class: 'flag' }, 'via ' + r.link_label) : null,
      r.bot ? h('span', { class: 'flag' }, 'bot') : null,
      r.me ? h('span', { class: 'flag' }, 'you') : null];
  }
  function uaShort(ua) {
    if (!ua) return 'no browser info';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    const b = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return b && os ? b + ' on ' + os : ua.slice(0, 48);
  }

  // where a visit came from, in a word; the server works it out when the visit starts (lib/visitor.js)
  const source = (r) => (r.link_code ? 'outreach link' : r.source || 'direct or unknown');

  // a visit's events are stored packed in one row, [ms after it started, type, label, value, path];
  // this unpacks them, oldest first. `extra` rides along on each (who it was, for the live feed).
  function expand(sess, extra) {
    let list = [];
    try { list = JSON.parse('[' + (sess.log || '') + ']'); } catch (x) {}
    const t0 = Date.parse(sess.started_at);
    return list.sort((a, b) => a[0] - b[0]).map((e) => ({ ...extra, at: new Date(t0 + e[0]).toISOString(), type: e[1],
      label: e[2], value: e[3], path: e[4] || '/', session_id: sess.id, visitor_id: sess.visitor_id }));
  }

  // ---------- what happened, in words ----------
  const SECTIONS = {
    hero: 'the top', manifesto: 'info', 'era-roots': 'roots', 'era-build': 'the build', 'era-jam1': 'jams',
    'era-allseason': 'all season', 'era-redbull': 'snow day', video: 'the edit', 'clip-4thakids': '4 tha kids',
    signup: 'the signup section', footer: 'the footer',
  };
  const page = (p) => (p === '/' || !p ? 'the home page' : p === '/signup' ? 'the signup page' : p);
  function describe(e) {
    const l = e.label || '';
    switch (e.type) {
      case 'view': return 'opened ' + page(e.path) + (l ? ' (' + l + ')' : '');
      case 'section': return 'read ' + (SECTIONS[l] || l) + ' for ' + dur(e.value * 1000);
      case 'scroll': return 'scrolled ' + e.value + '% down ' + page(e.path);
      case 'click': return 'clicked ' + l;
      case 'video': return l;
      case 'watch': return 'watched ' + l + ' for ' + dur(e.value * 1000);
      case 'photo': return 'looked at the photo ' + l;
      case 'snow': return 'held the snow gun for ' + dur(e.value) + (e.value >= 2200 ? ', long enough for the frost' : '');
      case 'form': return 'signup form: ' + l;
      case 'copy': return 'copied "' + l + '"';
      case 'error': return 'hit a page error: ' + l;
      case 'signup': return 'signed up' + (l ? ' (' + l + ')' : '');
      case 'instagram': return 'tapped follow @backyardrail' + (l ? ', ' + l : '');
      case 'open': return 'opened the outreach link' + (e.scanner ? ' (looked like a mail scanner)' : '');
      default: return e.type + ' ' + l;
    }
  }
  const BIG = new Set(['signup', 'instagram', 'watch', 'open']);
  // the last thing a visit did, for the live list: a section event on era-build -> "reading the build"
  function lastEvent(r) {
    try { const e = JSON.parse(r.last); return { type: e[1], label: e[2] || '', value: e[3], path: e[4] || '/' }; } catch (x) { return null; }
  }
  function doing(e) {
    if (!e) return null;
    if (e.type === 'section') return 'reading ' + (SECTIONS[e.label] || e.label);
    if (e.type === 'scroll') return 'scrolling';
    if (e.type === 'watch') return 'watching ' + e.label;
    if (e.type === 'view') return 'just arrived';
    return describe(e);
  }
  function eventList(events) {
    return h('ul', { class: 'events' }, events.map((e) =>
      h('li', null, h('time', { datetime: e.at, title: new Date(e.at).toLocaleString() }, clock(e.at)),
        h('span', { class: BIG.has(e.type) ? 'key' : null }, describe(e)))));
  }

  // ---------- pieces ----------
  function tile(label, value, sub, hero) {
    return h('div', { class: 'tile' + (hero ? ' hero' : '') }, h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  }
  function card(title, ...kids) {
    return h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...kids);
  }
  // ranked bars, one series: the name and its number in text, the bar beside them
  function ranks(items, opts = {}) {
    // opts.order keeps the given order and its zeros (the funnel); otherwise biggest first
    const list = opts.order ? items : items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).slice(0, opts.max || 10);
    if (!list.length || !list.some((i) => i.value > 0)) return h('p', { class: 'empty' }, opts.empty || 'nothing yet');
    const top = Math.max(...list.map((i) => i.value));
    return h('div', { class: 'ranks' }, list.map((i) =>
      h('div', { class: 'rank', title: i.name + ': ' + (i.text || n(i.value)) },
        h('span', { class: 'name' }, i.name), h('span', { class: 'val' }, i.text || n(i.value)),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: 'width:' + (i.value ? Math.max(1, (i.value / top) * 100) : 0) + '%' })))));
  }
  function table(cols, data, opts = {}) {
    if (!data.length) return h('p', { class: 'empty' }, opts.empty || 'nothing yet');
    return h('div', { class: 'scroll-x' }, h('table', null,
      h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : null }, c.title)))),
      h('tbody', null, data.map((r) => h('tr', { class: opts.go ? 'go' : null, onclick: opts.go ? (ev) => { if (!ev.target.closest('button, a')) opts.go(r); } : null },
        cols.map((c) => h('td', { class: c.num ? 'num' : null }, c.cell(r))))))));
  }
  const two = (a, b) => [a, b ? h('span', { class: 'two' }, b) : null];
  function pill(status) {
    const words = { engaged: 'engaged', visited: 'visited', clicked: 'clicked, no page', scanned: 'scanner only', unopened: 'not opened' };
    return h('span', { class: 'pill ' + status }, words[status] || status);
  }
  function copyButton(text, label) {
    const b = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; } catch (x) { b.textContent = 'copy failed'; }
      setTimeout(() => { b.textContent = label || 'copy'; }, 1500);
    } }, label || 'copy');
    return b;
  }
  // a button that asks again before doing something you can't undo
  function confirmButton(label, action) {
    let armed = null;
    const b = h('button', { class: 'btn small danger', type: 'button', onclick: async (ev) => {
      ev.stopPropagation();
      if (!armed) {
        b.textContent = 'sure? tap again';
        armed = setTimeout(() => { armed = null; b.textContent = label; }, 3000);
        return;
      }
      clearTimeout(armed);
      b.disabled = true;
      try { await action(); } catch (e) { b.disabled = false; b.textContent = e.message; }
    } }, label);
    return b;
  }

  // column chart, one series. Bars are the hover and focus targets; a table of the same numbers sits under it.
  function columns(points, opts) {
    const wrap = h('div', { class: 'chart' });
    const tip = h('div', { class: 'tip', hidden: true });
    const H = 190, L = 36, B = 24, T = 10;
    function show(p, x, y) {
      tip.replaceChildren(h('strong', null, p.valueText), p.title, ...(p.rows || []).map((r) => h('div', null, r)));
      tip.hidden = false;
      const w = tip.offsetWidth, W = wrap.clientWidth;
      tip.style.left = Math.min(W - w / 2, Math.max(w / 2, x)) + 'px';
      tip.style.top = y + 'px';
    }
    function draw() {
      const W = Math.max(260, wrap.clientWidth || 600);
      const top = niceMax(Math.max(1, ...points.map((p) => p.value)));
      const plotW = W - L, plotH = H - T - B;
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label });
      const ticks = top % 2 === 0 || top > 2 ? [0, top / 2, top] : [0, top];
      ticks.forEach((v) => {
        const y = T + plotH - (v / top) * plotH;
        svg.append(s('line', { class: v ? 'gridline' : 'base', x1: L, x2: W, y1: y, y2: y }));
        svg.append(s('text', { class: 'axis', x: L - 8, y: y + 4, 'text-anchor': 'end' }, compact(v)));
      });
      const band = plotW / points.length;
      const bw = Math.max(2, Math.min(24, band - 2));
      const every = Math.max(1, Math.ceil((points.length * 52) / plotW));
      const last = points.length - 1;
      points.forEach((p, i) => {
        const x = L + i * band + (band - bw) / 2;
        const hgt = (p.value / top) * plotH;
        const y = T + plotH - hgt;
        const hit = s('rect', { class: 'hit', x: L + i * band, y: T, width: band, height: plotH, tabindex: 0, 'aria-label': p.title + ', ' + p.valueText });
        const on = () => show(p, x + bw / 2, Math.min(y, T + plotH - 4));
        const off = () => { tip.hidden = true; };
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('focus', on);
        hit.addEventListener('pointerleave', off);
        hit.addEventListener('blur', off);
        svg.append(hit);
        if (hgt > 0) {
          const r = Math.min(4, bw / 2, hgt);
          svg.append(s('path', { class: 'col', d: `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + hgt}Z` }));
        }
        if ((last - i) % every === 0) { // counted back from the newest, so today always has its label
          svg.append(s('text', { class: 'axis', x: L + i * band + band / 2, y: H - 6, 'text-anchor': 'middle' }, p.axis));
        }
      });
      wrap.replaceChildren(svg, tip);
    }
    let queued = false;
    new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } }).observe(wrap);
    const rowsTable = h('table', null, h('tbody', null, points.map((p) => h('tr', null, h('td', null, p.title), h('td', { class: 'num' }, p.valueText)))));
    return h('div', null, wrap, h('details', { class: 'table-view' }, h('summary', null, 'as a table'), rowsTable));
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // ---------- overview ----------
  const RANGES = [[1, 'today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'year']];

  async function overview() {
    let days = Number(pref('days')) || 30;
    const body = h('div');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' }, RANGES.map(([d, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(d === days), onclick: () => {
        days = d;
        pref('days', d);
        seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(RANGES[i][0] === d)));
        load();
      } }, label)));
    put(h('h1', { class: 'page mark' }, 'over', h('b', null, 'view')), h('div', { class: 'row' }, seg), body);
    async function load() {
      body.classList.add('loading');
      const d = await api('overview?days=' + days);
      body.replaceChildren(...renderOverview(d));
      body.classList.remove('loading');
    }
    await load();
  }

  // every day (or hour) in the range, so quiet ones show as zero. Days are Ontario's, from the server.
  function buckets(d) {
    return d.buckets.map((key) => {
      const local = d.hourly ? new Date(2000, 0, 1, Number(key)) : new Date(...key.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
      return { key, local };
    });
  }

  function renderOverview(d) {
    const t = d.totals;
    const by = (list, k) => Object.fromEntries(list.map((r) => [r.bucket, r[k]]));
    const series = Object.fromEntries(d.series.map((r) => [r.bucket, r]));
    const signupsBy = by(d.signupSeries, 'signups');
    const range = buckets(d);
    const label = (b) => (d.hourly ? b.local.toLocaleTimeString(undefined, { hour: 'numeric' }) : b.local.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const title = (b) => (d.hourly ? label(b) : b.local.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    const visitorPoints = range.map((b) => {
      const r = series[b.key] || {};
      return { axis: label(b), title: title(b), value: r.visitors || 0, valueText: n(r.visitors) + ' visitors',
        rows: [n(r.visits) + ' visits · ' + n(r.pageviews) + ' page views', dur(r.engaged) + ' on the site'] };
    });
    const signupPoints = range.map((b) => ({ axis: label(b), title: title(b), value: signupsBy[b.key] || 0, valueText: n(signupsBy[b.key]) + ' signups' }));

    // events, by type
    const ev = (type) => d.events.filter((e) => e.type === type);
    const sections = ev('section').map((e) => ({ name: SECTIONS[e.label] || e.label, value: e.total, text: dur(e.total * 1000) + ' · ' + n(e.visits) + ' visits' }));
    const videoNames = [...new Set(ev('video').map((e) => (e.label || '').split(':')[0]).concat(ev('watch').map((e) => e.label)))].filter(Boolean);
    const videos = videoNames.map((name) => {
      const plays = ev('video').filter((e) => e.label === name + ': play').reduce((a, e) => a + e.n, 0);
      const ends = ev('video').filter((e) => e.label === name + ': to the end').reduce((a, e) => a + e.n, 0);
      const secs = ev('watch').filter((e) => e.label === name).reduce((a, e) => a + e.total, 0);
      return { name, value: secs, text: n(plays) + ' plays · ' + dur(secs * 1000) + ' watched · ' + n(ends) + ' to the end' };
    });
    const snow = ev('snow').reduce((a, e) => ({ n: a.n + e.n, visits: a.visits + e.visits, total: a.total + e.total }), { n: 0, visits: 0, total: 0 });
    const tally = (k) => {
      const m = {};
      for (const r of d.devices) m[r[k] || 'unknown'] = (m[r[k] || 'unknown'] || 0) + r.visits;
      return Object.entries(m).map(([name, value]) => ({ name, value, text: n(value) + ' visits' }));
    };
    const f = d.funnel;
    const step = (name, v) => ({ name, value: v, text: n(v) + ' · ' + pct(v, f.visits) });

    return [
      h('div', { class: 'tiles' },
        tile('visitors', n(t.visitors), n(t.new_visitors) + ' new · ' + n(d.online) + ' on the site now', true),
        tile('visits', n(t.visits), n(t.pageviews) + ' page views'),
        tile('time on site a visit', dur(t.visits ? t.engaged / t.visits : 0), dur(t.engaged) + ' in all'),
        tile('visits that did something', pct(t.interacted, t.visits), 'scrolled, tapped or clicked'),
        tile('signups', n(d.signups.in_range), n(d.signups.total) + ' all time · ' + n(d.signups.instagram) + ' tapped follow'),
        tile('outreach links visited', n(d.outreach.visited) + ' of ' + n(d.outreach.links), h('a', { href: '#/outreach' }, 'see who'))),
      h('div', { class: 'grid two stack' },
        card(d.hourly ? 'visitors by hour, today' : 'visitors a day', columns(visitorPoints, { label: 'Visitors over time' })),
        card(d.hourly ? 'signups by hour, today' : 'signups a day', columns(signupPoints, { label: 'Signups over time' }))),
      h('div', { class: 'grid three stack' },
        card('from visit to signup', ranks([step('visits', f.visits), step('scrolled halfway', f.halfway), step('reached the signup section', f.saw_signup),
          step('opened the signup page', f.opened_signup), step('signed up', f.signed_up)], { order: true, empty: 'no visits yet' })),
        card('where visits came from', ranks(d.sources.map((r) => ({ name: r.name, value: r.visits, text: n(r.visits) + ' visits' })))),
        card('where they are', ranks(d.places.map((r) => ({ name: where(r), value: r.visits, text: n(r.visits) + ' visits' })))),
        card('what they read', ranks(sections, { max: 11 })),
        card('video', ranks(videos, { empty: 'no plays yet' })),
        card('what they clicked', ranks(ev('click').map((e) => ({ name: e.label, value: e.n, text: n(e.n) + ' · ' + n(e.visits) + ' visits' })), { max: 12 })),
        card('photos opened', ranks(ev('photo').map((e) => ({ name: e.label, value: e.n })), { max: 8, empty: 'no photos opened yet' })),
        card('devices', ranks(tally('device')), h('div', { style: 'height:14px' }), ranks(tally('browser'), { max: 6 })),
        card('the snow gun', snow.n ? h('div', { class: 'dl' },
          h('span', { class: 'muted' }, 'holds'), h('span', null, n(snow.n) + ' by ' + n(snow.visits) + ' visits'),
          h('span', { class: 'muted' }, 'average hold'), h('span', null, dur(snow.total / snow.n))) : h('p', { class: 'empty' }, 'nobody yet'),
        h('div', { style: 'height:14px' }),
        h('h2', null, 'signup form'), ranks(ev('form').map((e) => ({ name: e.label, value: e.n })), { empty: 'no form use yet' })),
        ev('copy').length ? card('copied off the page', ranks(ev('copy').map((e) => ({ name: e.label, value: e.n })), { max: 8 })) : null),
    ];
  }

  // ---------- outreach ----------
  async function outreach() {
    const out = h('div');
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const result = h('div');
    const f = {
      label: h('input', { type: 'text', required: true, maxlength: 80, placeholder: 'Jane at Acme' }),
      org: h('input', { type: 'text', maxlength: 80, placeholder: 'Red Bull Canada' }),
      email: h('input', { type: 'email', maxlength: 120, placeholder: 'name@company.com' }),
      dest: h('select', null, h('option', { value: '/' }, 'the home page'), h('option', { value: '/#video' }, 'the edit (video)'),
        h('option', { value: '/#era-redbull' }, 'snow day'), h('option', { value: '/signup' }, 'the signup page')),
      code: h('input', { type: 'text', maxlength: 40, placeholder: 'random', pattern: '[a-zA-Z0-9-]{3,40}' }),
      note: h('textarea', { maxlength: 500, placeholder: 'what you pitched, follow-up date...' }),
    };
    const go = h('button', { class: 'btn', type: 'submit' }, 'make the link');
    const form = h('form', { class: 'card', onsubmit: async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      go.disabled = true;
      try {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
        const { code } = await api('links', { method: 'POST', body });
        const url = location.origin + '/r/' + code;
        result.replaceChildren(h('div', { class: 'copyline' }, h('code', null, url), copyButton(url, 'copy link'),
          h('a', { href: '#/outreach/' + code, class: 'note' }, 'its page')),
        h('p', { class: 'note', style: 'margin-top:8px' }, 'put this link in the email to ' + body.label + '. When they open it, it shows up here.'));
        form.reset();
        await list();
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
      go.disabled = false;
    } },
    h('h2', null, 'new outreach link'),
    h('div', { class: 'grid three' },
      h('label', { class: 'field' }, 'who it\'s for', f.label), h('label', { class: 'field' }, 'company', f.org),
      h('label', { class: 'field' }, 'their email (for you)', f.email), h('label', { class: 'field' }, 'lands on', f.dest),
      h('label', { class: 'field' }, 'link code (optional)', f.code)),
    h('label', { class: 'field', style: 'margin-top:12px' }, 'note', f.note),
    h('div', { class: 'row', style: 'margin:12px 0 0' }, go, err), result);

    let showArchived = false;
    async function list() {
      const { links } = await api('links');
      const shown = links.filter((l) => showArchived || !l.archived);
      const archived = links.filter((l) => l.archived).length;
      out.replaceChildren(card('your links',
        table([
          { title: 'who', cell: (l) => two(l.label + (l.archived ? ' (archived)' : ''), [l.org, l.email].filter(Boolean).join(' · ')) },
          { title: 'status', cell: (l) => two(pill(l.status), l.opens ? n(l.opens) + ' opens' + (l.scanner_opens ? ', ' + n(l.scanner_opens) + ' by scanners' : '') : null) },
          { title: 'first opened', cell: (l) => h('span', { class: 'nowrap' }, when(l.first_open)) },
          { title: 'visits', num: true, cell: (l) => n(l.visits) },
          { title: 'time on site', num: true, cell: (l) => (l.engaged ? dur(l.engaged) : '-') },
          { title: 'what they did', cell: (l) => highlightText(l) || h('span', { class: 'faint' }, '-') },
          { title: 'last seen', cell: (l) => h('span', { class: 'nowrap' }, when(l.last_visit)) },
          { title: '', cell: (l) => copyButton(location.origin + '/r/' + l.code, 'copy link') },
        ], shown, { go: (l) => { location.hash = '#/outreach/' + l.code; }, empty: 'no links yet. Make one above for each email you send.' }),
        archived ? h('button', { class: 'btn small ghost', type: 'button', style: 'margin-top:12px', onclick: () => { showArchived = !showArchived; list(); } },
          showArchived ? 'hide archived' : 'show archived (' + archived + ')') : null));
    }

    put(h('h1', { class: 'page mark' }, 'out', h('b', null, 'reach')), h('div', { class: 'stack' }, form, out),
      h('p', { class: 'note' }, 'engaged: they scrolled, tapped or stayed 10 seconds or more. visited: the page loaded and nothing else. ',
        'scanner only: a company\'s mail scanner opened it, not a person yet. clicked, no page: opened, but the page never reported back (blocked scripts). ',
        'Your own browsers are left out.'));
    await list();
  }

  function highlightText(l) {
    const words = { saw_signup: 'saw signup', signed_up: 'signed up', instagram: 'tapped instagram', snow: 'played with the snow gun' };
    const parts = (l.highlights || []).map((x) => (x.kind === 'watch' ? 'watched ' + dur(x.seconds * 1000) : words[x.kind]));
    if (l.max_scroll) parts.unshift('scrolled ' + l.max_scroll + '%');
    return parts.join(' · ');
  }

  async function linkPage(code) {
    const d = await api('links/' + encodeURIComponent(code));
    const l = d.link;
    const url = location.origin + '/r/' + l.code;
    const actions = h('div', { class: 'row' },
      h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
        await api('links/' + l.code, { method: 'PATCH', body: { archived: !l.archived } });
        route();
      } }, l.archived ? 'unarchive' : 'archive'),
      confirmButton('delete link', async () => { await api('links/' + l.code, { method: 'DELETE' }); location.hash = '#/outreach'; }));

    // what the browsers that came in on it did, newest visit first
    const events = d.sessions.flatMap((x) => expand(x));
    const opens = d.opens.map((o) => ({ at: o.at, type: 'open', scanner: o.scanner }));

    put(
      h('p', null, h('a', { href: '#/outreach', class: 'note' }, '← outreach')),
      h('h1', { class: 'page mark' }, l.label),
      h('p', { class: 'muted' }, [l.org, l.email, 'made ' + when(l.created_at), 'lands on ' + l.dest].filter(Boolean).join(' · ')),
      l.note ? h('p', { class: 'note', style: 'margin-top:6px' }, l.note) : null,
      h('div', { class: 'copyline', style: 'margin-bottom:16px' }, h('code', null, url), copyButton(url, 'copy link')),
      h('div', { class: 'tiles' },
        tile('status', pill(l.status), l.first_visit ? 'first visit ' + when(l.first_visit) : null),
        tile('opens', n(l.opens), l.scanner_opens ? n(l.scanner_opens) + ' looked like mail scanners' : null),
        tile('visits', n(l.visits), n(l.visitors) + (l.visitors === 1 ? ' browser' : ' browsers') + ' · ' + n(l.pageviews) + ' pages'),
        tile('time on site', dur(l.engaged), l.last_visit ? 'last seen ' + when(l.last_visit) : null),
        tile('deepest scroll', l.max_scroll ? l.max_scroll + '%' : '-', highlightText({ highlights: l.highlights }) || null)),
      h('div', { class: 'stack' },
        card('who opened it', d.visitors.length ? table([
          { title: 'where', cell: (v) => two(where(v), v.as_org) },
          { title: 'device', cell: (v) => two(what(v), v.bot ? 'looks automated' : null) },
          { title: 'visits', num: true, cell: (v) => n(v.visits) },
          { title: 'time on site', num: true, cell: (v) => dur(v.engaged) },
          { title: 'scroll', num: true, cell: (v) => (v.max_scroll || 0) + '%' },
          { title: 'last seen', cell: (v) => when(v.last_visit) },
        ], d.visitors, { go: (v) => { location.hash = '#/visitor/' + v.id; } }) : h('p', { class: 'empty' }, 'nobody has loaded the page from this link yet')),
        card('every open of the link', table([
          { title: 'when', cell: (o) => h('span', { class: 'nowrap', title: new Date(o.at).toLocaleString() }, when(o.at)) },
          { title: 'where', cell: (o) => two(where(o), o.as_org) },
          { title: 'browser', cell: (o) => h('span', { title: o.ua || '' }, uaShort(o.ua)) },
          { title: '', cell: (o) => (o.scanner ? h('span', { class: 'flag' }, 'likely a scanner') : h('span', { class: 'flag' }, 'likely a person')) },
        ], d.opens, { empty: 'not opened yet' })),
        card('what they did', events.length || opens.length ? timeline([...events, ...opens]) : h('p', { class: 'empty' }, 'nothing yet')),
        actions));
  }

  // events grouped by day, newest day first, oldest event first within it
  function timeline(events) {
    const days = {};
    for (const e of events) (days[new Date(e.at).toDateString()] = days[new Date(e.at).toDateString()] || []).push(e);
    return Object.values(days).sort((a, b) => (a[0].at < b[0].at ? 1 : -1)).map((list) => {
      list.sort((a, b) => (a.at < b.at ? -1 : 1));
      return h('div', { class: 'visit' }, h('div', { class: 'visit-head' }, h('strong', null, dayName(list[0].at))), eventList(list));
    });
  }

  // ---------- signups ----------
  async function signups() {
    const { signups: all } = await api('signups');
    const search = h('input', { type: 'search', placeholder: 'search names, emails, phones', style: 'max-width:320px' });
    const count = h('span', { class: 'muted' });
    const box = h('div');
    function render() {
      const q = search.value.trim().toLowerCase();
      const shown = q ? all.filter((r) => [r.name, r.email, r.phone, r.source].some((x) => (x || '').toLowerCase().includes(q))) : all;
      count.textContent = n(shown.length) + (shown.length === 1 ? ' person' : ' people');
      box.replaceChildren(card(null, table([
        { title: 'name', cell: (r) => two(r.name, r.link_label ? 'came from outreach: ' + r.link_label : null) },
        { title: 'email', cell: (r) => r.email },
        { title: 'phone', cell: (r) => r.phone || h('span', { class: 'faint' }, '-') },
        { title: 'source', cell: (r) => r.source },
        { title: 'follow', cell: (r) => (r.instagram ? 'tapped' : h('span', { class: 'faint' }, '-')) },
        { title: 'signed up', cell: (r) => two(h('span', { class: 'nowrap' }, when(r.created_at)), r.updated_at !== r.created_at ? 'again ' + when(r.updated_at) : null) },
        { title: 'device', cell: (r) => (r.visitor_id ? two(what(r), where(r) + (r.same_device > 1 ? ' · shared with ' + (r.same_device - 1) + ' more' : '')) : h('span', { class: 'faint' }, '-')) },
        { title: 'time on site', num: true, cell: (r) => (r.visitor_id ? dur(r.engaged) : '-') },
        { title: '', cell: (r) => confirmButton('remove', async () => { await api('signups/' + r.id, { method: 'DELETE' }); all.splice(all.indexOf(r), 1); render(); }) },
      ], shown, { go: (r) => { if (r.visitor_id) location.hash = '#/visitor/' + r.visitor_id; }, empty: q ? 'nobody matches' : 'no signups yet' })));
    }
    search.addEventListener('input', render);
    put(h('h1', { class: 'page mark' }, 'sign', h('b', null, 'ups')),
      h('div', { class: 'row' }, search, count, h('button', { class: 'btn ghost', type: 'button', onclick: () => downloadCsv(all) }, 'download csv')), box);
    render();
  }

  // a spreadsheet would run anything starting = + - @ as a formula, so those cells get a leading '
  function csvCell(v) {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = '\'' + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }
  function downloadCsv(list) {
    const cols = ['name', 'email', 'phone', 'source', 'instagram', 'created_at', 'updated_at'];
    const lines = [cols.join(',')].concat(list.map((r) => cols.map((c) => csvCell(c === 'instagram' ? (r[c] ? 'yes' : 'no') : r[c])).join(',')));
    const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })), download: 'hesh-signups-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- visitors ----------
  const SHOWS = [['people', 'people'], ['outreach', 'from outreach'], ['signups', 'signed up'], ['all', 'everything, bots and you too']];

  async function visitors() {
    let show = pref('show') || 'people';
    const box = h('div');
    const more = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'load more');
    let rows = [];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Which visitors' }, SHOWS.map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === show), onclick: () => {
        show = k;
        pref('show', k);
        seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(SHOWS[i][0] === k)));
        rows = [];
        load();
      } }, label)));
    async function load() {
      box.classList.add('loading');
      const before = rows.length ? rows[rows.length - 1].last_seen : '';
      const d = await api('visitors?show=' + show + (before ? '&before=' + encodeURIComponent(before) : ''));
      rows = rows.concat(d.visitors);
      more.hidden = d.visitors.length < 100;
      box.replaceChildren(card(null, table([
        { title: 'who', cell: (v) => two([who(v), flags(v)], what(v)) },
        { title: 'where', cell: (v) => two(where(v), v.as_org) },
        { title: 'came from', cell: (v) => source({ link_code: v.link_code, source: v.first_source }) },
        { title: 'visits', num: true, cell: (v) => n(v.visits) },
        { title: 'pages', num: true, cell: (v) => n(v.pageviews) },
        { title: 'time on site', num: true, cell: (v) => dur(v.engaged) },
        { title: 'scroll', num: true, cell: (v) => (v.max_scroll || 0) + '%' },
        { title: 'last seen', cell: (v) => h('span', { class: 'nowrap' }, when(v.last_at || v.last_seen)) },
      ], rows, { go: (v) => { location.hash = '#/visitor/' + v.id; }, empty: 'nobody yet' })));
      box.classList.remove('loading');
    }
    more.addEventListener('click', load);
    put(h('h1', { class: 'page mark' }, 'visit', h('b', null, 'ors')), h('div', { class: 'row' }, seg), box, h('div', { class: 'row', style: 'margin-top:14px' }, more));
    await load();
  }

  async function visitorPage(id) {
    const d = await api('visitors/' + id);
    const v = d.visitor;
    const toggle = (k, onText, offText) => h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      await api('visitors/' + id, { method: 'PATCH', body: { [k]: !v[k] } });
      route();
    } }, v[k] ? offText : onText);
    const first = { link_code: v.link_code, source: v.first_source };

    put(
      h('p', null, h('a', { href: '#/visitors', class: 'note' }, '← visitors')),
      h('h1', { class: 'page mark' }, who(v)),
      h('p', { class: 'muted' }, where(v), ' · ', what(v), flags(v)),
      h('div', { class: 'row', style: 'margin-top:12px' }, toggle('me', 'this is me', 'not me'), toggle('bot', 'mark as a bot', 'not a bot')),
      h('div', { class: 'grid two stack' },
        card('this browser', h('dl', { class: 'dl' },
          h('dt', null, 'first seen'), h('dd', null, when(v.first_seen)),
          h('dt', null, 'last seen'), h('dd', null, when(v.last_seen)),
          h('dt', null, 'came from'), h('dd', null, source(first), v.first_referrer ? h('span', { class: 'two' }, v.first_referrer) : null),
          v.first_campaign ? [h('dt', null, 'tags'), h('dd', null, v.first_campaign)] : null,
          h('dt', null, 'first page'), h('dd', null, page(v.first_landing)),
          v.link_code ? [h('dt', null, 'outreach link'), h('dd', null, h('a', { href: '#/outreach/' + v.link_code }, v.link_label || v.link_code))] : null,
          h('dt', null, 'where'), h('dd', null, where(v), v.timezone ? h('span', { class: 'two' }, v.timezone) : null),
          h('dt', null, 'network'), h('dd', null, v.as_org || '-', v.asn ? h('span', { class: 'two' }, 'AS' + v.asn) : null),
          h('dt', null, 'device'), h('dd', null, what(v), h('span', { class: 'two' }, [v.screen && 'screen ' + v.screen, v.lang].filter(Boolean).join(' · '))),
          h('dt', null, 'browser'), h('dd', null, h('span', { class: 'two' }, v.ua || '-')))),
        h('div', { class: 'stack', style: 'margin:0' },
          d.signups.length ? card('signed up', table([
            { title: 'name', cell: (r) => r.name }, { title: 'email', cell: (r) => r.email },
            { title: 'phone', cell: (r) => r.phone || '-' }, { title: 'when', cell: (r) => when(r.created_at) },
          ], d.signups)) : null,
          d.opens.length ? card('outreach link opens', table([
            { title: 'link', cell: (o) => h('a', { href: '#/outreach/' + o.code }, o.label || o.code) },
            { title: 'when', cell: (o) => when(o.at) },
            { title: '', cell: (o) => h('span', { class: 'flag' }, o.scanner ? 'likely a scanner' : 'likely a person') },
          ], d.opens)) : null,
          card('in all', h('dl', { class: 'dl' },
            h('dt', null, 'visits'), h('dd', null, n(d.sessions.length)),
            h('dt', null, 'pages'), h('dd', null, n(d.sessions.reduce((a, x) => a + x.pageviews, 0))),
            h('dt', null, 'time on site'), h('dd', null, dur(d.sessions.reduce((a, x) => a + x.engaged_ms, 0))),
            h('dt', null, 'deepest scroll'), h('dd', null, Math.max(0, ...d.sessions.map((x) => x.max_scroll)) + '%'))))),
      card('every visit', d.sessions.length ? d.sessions.map((x) => {
        const list = expand(x);
        return h('div', { class: 'visit' },
          h('div', { class: 'visit-head' }, h('strong', null, dayName(x.started_at) + ', ' + clock(x.started_at)),
            h('span', { class: 'muted' }, [dur(x.engaged_ms) + ' on the page', n(x.pageviews) + (x.pageviews === 1 ? ' page' : ' pages'),
              'scrolled ' + x.max_scroll + '%', 'from ' + (x.link_code ? 'their outreach link' : source(x)), x.city || null].filter(Boolean).join(' · '))),
          list.length ? eventList(list) : h('p', { class: 'empty' }, 'no events'));
      }) : h('p', { class: 'empty' }, 'no visits')));
  }

  // ---------- live ----------
  async function live() {
    const onlineBox = h('div');
    const feed = h('ul', { class: 'events' });
    // after: the server's clock at the last poll; shown: events already in the feed, per visit
    let after = 0, hit = 0, all = false, shown = {};
    const label = h('label', { class: 'note' }, h('input', { type: 'checkbox', onchange: (e) => { all = e.target.checked; after = hit = 0; shown = {}; feed.replaceChildren(); poll(); } }), ' include bots');
    put(h('h1', { class: 'page mark' }, 'li', h('b', null, 've')), h('div', { class: 'row' }, label),
      h('div', { class: 'grid two stack' }, onlineBox, card('what\'s happening', feed)));
    async function poll() {
      // 15 seconds of overlap, so a batch saved while the last poll ran isn't missed; `shown` drops repeats
      const d = await api('live?after=' + (after ? after - 15000 : 0) + '&hit=' + hit + (all ? '&all=1' : ''));
      const first = !after;
      after = d.now;
      const online = d.sessions.filter((r) => Date.parse(r.last_at) >= d.now - 120000).map((r) => ({ ...r, now: lastEvent(r) }));
      onlineBox.replaceChildren(card(null, h('h2', null, h('span', { class: 'live-dot' }), n(online.length) + ' on the site now'),
        table([
          { title: 'who', cell: (r) => two([who(r), flags(r)], where(r) + ' · ' + what(r)) },
          { title: 'on', cell: (r) => two(page(r.now && r.now.path), doing(r.now)) },
          { title: 'time', num: true, cell: (r) => dur(r.engaged_ms) },
        ], online, { go: (r) => { location.hash = '#/visitor/' + r.visitor_id; }, empty: 'nobody right now' })));
      let items = [];
      for (const r of d.sessions) {
        if (r.log == null) continue;
        const { log, last, ...info } = r;
        const list = expand(r, info);
        items = items.concat(list.slice(shown[r.id] || 0));
        shown[r.id] = list.length;
      }
      items = items.concat(d.opens.map((o) => ({ at: o.at, type: 'open', scanner: o.scanner, link_label: o.label, code: o.code, city: o.city, country: o.country })))
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      if (first) items = items.slice(0, 150);
      if (d.opens.length) hit = Math.max(hit, ...d.opens.map((o) => o.id));
      const fresh = items.map((e) => {
        return h('li', null, h('time', { datetime: e.at }, clock(e.at)),
          h('span', null, h('a', { href: e.type === 'open' ? '#/outreach/' + e.code : '#/visitor/' + e.visitor_id, class: 'key' }, who(e)), ' ', h('span', { class: BIG.has(e.type) ? 'key' : null }, describe(e)),
            h('span', { class: 'faint' }, ' · ' + where(e))));
      });
      feed.prepend(...fresh);
      while (feed.children.length > 300) feed.lastChild.remove();
      if (!feed.children.length) feed.append(h('li', { class: 'empty' }, 'waiting for something to happen'));
      else feed.querySelectorAll('li.empty').forEach((x) => x.remove());
    }
    await poll();
    // every poll reads the last two hours of visits, so it only runs while the tab is in view
    const timer = setInterval(() => { if (!document.hidden) poll().catch(() => {}); }, 6000);
    stop = () => clearInterval(timer);
  }

  // ---------- routing ----------
  const ROUTES = [
    [/^#\/overview$/, overview], [/^#\/outreach$/, outreach], [/^#\/outreach\/([a-z0-9-]+)$/, linkPage],
    [/^#\/signups$/, signups], [/^#\/visitors$/, visitors], [/^#\/visitor\/([0-9a-f-]{36})$/, visitorPage], [/^#\/live$/, live],
  ];
  let stop = null;
  function route() {
    if (stop) { stop(); stop = null; }
    const hash = location.hash || '#/overview';
    const found = ROUTES.find(([re]) => re.test(hash));
    if (!found) return location.replace('#/overview');
    const tab = hash.split('/')[1];
    document.querySelectorAll('.tabs a').forEach((a) => {
      const t = a.getAttribute('href').split('/')[1];
      if (t === tab || (t === 'visitors' && tab === 'visitor')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    view.replaceChildren();
    window.scrollTo(0, 0);
    found[1](...found[0].exec(hash).slice(1)).catch((e) => {
      if (e.message !== 'signed out') put(h('p', { class: 'err' }, e.message));
    });
  }
  addEventListener('hashchange', route);
  document.getElementById('out').addEventListener('click', async () => {
    await fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.replace('/admin/login');
  });
  route();
})();
