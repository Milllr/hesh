// turnstile siteverify, fail closed: success, the expected action and one of our hostnames.
// the signup form uses the "signup" action and the admin sign-in uses "admin", on the same widget.

export async function verifyTurnstile(env, token, ip, action) {
  let result;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (!res.ok) return false;
    result = await res.json();
  } catch {
    return false;
  }
  if (!result.success) return false;
  // local dev only (.dev.vars): turnstile's published test keys answer from example.com with no action
  if (env.ALLOW_TEST_KEYS === '1' && result.metadata && result.metadata.result_with_testing_key === true) return true;
  const hosts = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
  return result.action === action && hosts.includes(result.hostname);
}
