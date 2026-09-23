// Cloudflare Pages Function — same-origin proxy for PocketBase's
// /api/collections/users/auth-with-password. Before this existed the
// browser did that POST directly to the Cloudflare Quick Tunnel URL,
// which failed hard for users whose network can't reach
// *.trycloudflare.com (Vietnamese ISPs are the confirmed culprit —
// user 2026-09-22 stuck on nhopnhep.pages.dev, "Không kết nối được
// server" toast on every sign-in attempt, while the same tunnel URL
// returned HTTP 200 from other networks). Routing login through the
// app's own origin bypasses that class of failure entirely — the
// browser only talks to pages.dev, and Cloudflare's Worker relay
// takes it from there.
//
// Turnstile is INTENTIONALLY not applied here (unlike register.js).
// Login isn't a create-account vector — an attacker who guesses a
// real user's password already has bigger problems than being rate
// limited, and adding Turnstile to every login mid-session would make
// the "session expired, sign back in" path way worse. If we see real
// brute-force patterns we'll add per-email throttling on the PB side.
//
// Tunnel URL is patched by the watchdog (Bat-TOAN-BO*.ps1) alongside
// every other function's PB_URL. This file MUST be added to
// $pagesFunctionsWithPbUrl in both scripts or it will drift to a
// dead tunnel on the next rotation.

const PB_URL = 'https://ambassador-annotation-messages-flyer.trycloudflare.com';

function jsonError(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request } = context;
  const t0 = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || '-';
  const cf = request.cf || {};
  const apiLog = (status, note) => console.log(JSON.stringify({
    ev: 'api_call', ep: 'login', status, note,
    ip, cc: cf.country, co: cf.colo, ms: Date.now() - t0,
  }));

  let body;
  try {
    body = await request.json();
  } catch (_) {
    apiLog(400, 'bad_json');
    return jsonError(400, 'Yêu cầu không hợp lệ');
  }

  const { identity, password } = body || {};
  if (!identity || !password) {
    apiLog(400, 'missing_fields');
    return jsonError(400, 'Thiếu email hoặc mật khẩu');
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const upstream = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
    // 200 = signed in, 400 = wrong password / user not found.
    apiLog(upstream.status, upstream.ok ? 'ok' : 'pb_rejected');
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_) {
    apiLog(502, 'pb_unreachable');
    return jsonError(502, 'Không kết nối được server cộng đồng');
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
