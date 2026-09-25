// Cloudflare Pages Function — gates account creation behind Cloudflare
// Turnstile before forwarding to PocketBase. Registration used to POST
// straight from the browser to PocketBase's /api/collections/users/records
// with zero verification: no CAPTCHA, no email confirmation — anyone could
// script mass fake-account creation in seconds (confirmed exploitable
// 2026-09-11: several throwaway test accounts created this session in
// under a minute). This proxy requires a valid, single-use Turnstile
// token (from the same widget shown on the register form) and passes
// canonical server-side siteverify before the real PocketBase create-user
// call ever runs. Login is untouched — this only gates NEW account
// creation, not signing into an existing one.
//
// The tunnel URL below is the same one js/community.js and
// functions/api/log.js use — must be updated together whenever the
// tunnel rotates. See PROJECT_HANDOFF section 4 for the watchdog that
// normally handles this (patches all three files — Bat-TOAN-BO*.ps1).

const PB_URL = 'https://supports-designs-breaking-performances.trycloudflare.com';
const TURNSTILE_ACTION = 'register';
// The exact hostnames the Turnstile widget was registered for (Cloudflare
// dashboard/widget-create) — not sensitive, unlike TURNSTILE_SECRET, so
// safe to hardcode alongside it rather than needing another env var.
const EXPECTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', 'nhopnhep.pages.dev']);

function jsonError(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const t0  = Date.now();
  const ip  = request.headers.get('CF-Connecting-IP') || '-';
  const cf  = request.cf || {};
  // Compact structured logger — all register events tagged [api] so they
  // can be filtered together in CF Workers Real-time Logs alongside log.js.
  const apiLog = (status, note) => console.log(JSON.stringify({
    ev:'api_call', ep:'register', status, note,
    ip, cc:cf.country, co:cf.colo, ms:Date.now()-t0,
  }));

  let body;
  try {
    body = await request.json();
  } catch (_) {
    apiLog(400, 'bad_json');
    return jsonError(400, 'Yêu cầu không hợp lệ');
  }

  const { email, password, name, turnstileToken, invitedBy } = body || {};
  if (!email || !password) { apiLog(400, 'missing_fields'); return jsonError(400, 'Thiếu email hoặc mật khẩu'); }
  if (typeof turnstileToken !== 'string' || !turnstileToken || turnstileToken.length > 2048) {
    apiLog(403, 'no_token');
    return jsonError(403, 'Xác thực chống bot thất bại, thử lại nhé');
  }
  if (!env.TURNSTILE_SECRET) {
    // Misconfigured deploy (secret not set yet) — fail closed, never skip
    // verification just because the secret is missing.
    apiLog(500, 'no_secret');
    return jsonError(500, 'Server chưa cấu hình xong, thử lại sau');
  }

  // Canonical server-side siteverify — never trust the client's own claim
  // that the widget passed. Fail closed on any network/parse error too.
  let verify;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: turnstileToken,
        remoteip: request.headers.get('CF-Connecting-IP') || '',
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!vr.ok) throw new Error(`siteverify ${vr.status}`);
    verify = await vr.json();
  } catch (_) {
    apiLog(403, 'turnstile_network_err');
    return jsonError(403, 'Không xác thực được, thử lại nhé');
  }

  if (
    !verify.success ||
    verify.action !== TURNSTILE_ACTION ||
    !EXPECTED_HOSTNAMES.has(verify.hostname)
  ) {
    // Log bot-challenge failures — a spike here = bot activity or widget misconfiguration.
    apiLog(403, `turnstile_fail:success=${verify.success},action=${verify.action},host=${verify.hostname}`);
    return jsonError(403, 'Xác thực chống bot thất bại, thử lại nhé');
  }

  // Referral attribution (?ref=<user_id> → invited_by) — best-effort only.
  // A relation field rejects the WHOLE create if the id doesn't resolve to
  // a real record, so a stale/bad/made-up link must never be allowed to
  // break signup. Confirm the id is a real user first; on any doubt, drop
  // it silently and register normally rather than risk a hard failure.
  let invitedById = null;
  if (typeof invitedBy === 'string' && /^[a-z0-9]{15}$/.test(invitedBy)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const checkRes = await fetch(`${PB_URL}/api/collections/users/records/${invitedBy}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (checkRes.ok) invitedById = invitedBy;
    } catch (_) { /* tunnel hiccup — skip attribution, never block signup for it */ }
  }

  // Turnstile passed — forward the real registration to PocketBase.
  // Proxy its exact status/body so client error handling keeps working.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const userBody = { email, password, passwordConfirm: password, name: name || '' };
    if (invitedById) userBody.invited_by = invitedById;
    const upstream = await fetch(`${PB_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userBody),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
    // Log outcome: 200 = new account created, 4xx = email taken / validation fail.
    apiLog(upstream.status, (upstream.ok ? 'registered' : 'pb_rejected') + (invitedBy ? (invitedById ? ':ref_ok' : ':ref_dropped') : ''));
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_) {
    apiLog(502, 'pb_unreachable');
    return jsonError(502, 'Không kết nối được server cộng đồng');
  }
}

// Same-origin app calls don't trigger CORS preflight, but answer OPTIONS
// anyway just in case (same convention as functions/api/log.js).
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
