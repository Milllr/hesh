// sign-in for /admin: Turnstile (the "admin" action on the signup widget), then the password.
// the session cookie is SameSite=Strict, so a link from email lands here signed out; ask first.
fetch('/admin/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace('/admin/'); });

var SITEKEY = '0x4AAAAAAFh67GndN90Cg2WX';
var widgetId = null, token = '', waiting = null;

window.onTurnstile = function () {
  widgetId = turnstile.render('#ts', {
    sitekey: SITEKEY,
    action: 'admin',
    appearance: 'interaction-only',
    'refresh-expired': 'auto',
    callback: function (t) { token = t; if (waiting) { var w = waiting; waiting = null; w(); } },
    'expired-callback': function () { token = ''; },
    'error-callback': function () { token = ''; }
  });
};

function withToken(cb) {
  function take() { var t = token; token = ''; cb(t); }
  if (token) return take();
  waiting = take;
  setTimeout(function () { if (waiting === take) { waiting = null; cb(''); } }, 20000);
}

function fail(msg) {
  var err = document.getElementById('err');
  err.textContent = msg;
  err.hidden = false;
  var go = document.getElementById('go');
  go.disabled = false;
  go.textContent = 'sign in';
  token = '';
  if (widgetId !== null) turnstile.reset(widgetId);
}

document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var pw = document.getElementById('pw').value;
  if (!pw) return;
  var go = document.getElementById('go');
  go.disabled = true;
  go.textContent = 'checking...';
  document.getElementById('err').hidden = true;
  withToken(function (t) {
    if (!t) return fail('couldn\'t check you\'re a person, try again');
    fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pw, token: t })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok) location.replace('/admin/');
        else fail(res.d.error || 'that didn\'t work');
      })
      .catch(function () { fail('no connection, try again'); });
  });
});
