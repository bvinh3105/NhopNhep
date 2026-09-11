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

const PB_URL = 'https://resolution-appliance-laser-wolf.trycloudflare.com';
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

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError(400, 'Yêu cầu không hợp lệ');
  }

  const { email, password, name, turnstileToken } = body || {};
  if (!email || !password) return jsonError(400, 'Thiếu email hoặc mật khẩu');
  if (typeof turnstileToken !== 'string' || !turnstileToken || turnstileToken.length > 2048) {
    return jsonError(403, 'Xác thực chống bot thất bại, thử lại nhé');
  }
  if (!env.TURNSTILE_SECRET) {
    // Misconfigured deploy (secret not set yet) — fail closed, never skip
    // verification just because the secret is missing.
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
    return jsonError(403, 'Không xác thực được, thử lại nhé');
  }

  if (
    !verify.success ||
    verify.action !== TURNSTILE_ACTION ||
    !EXPECTED_HOSTNAMES.has(verify.hostname)
  ) {
    return jsonError(403, 'Xác thực chống bot thất bại, thử lại nhé');
  }

  // Verified — forward the real registration to PocketBase, proxying its
  // exact status/body through so existing client error handling (reads
  // data.message, e.g. "email đã tồn tại") keeps working unchanged.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const upstream = await fetch(`${PB_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, name: name || '' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_) {
    return jsonError(502, 'Không kết nối được server cộng đồng');
  }
}

// Same-origin app calls don't trigger CORS preflight, but answer OPTIONS
// anyway just in case (same convention as functions/api/log.js).
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
