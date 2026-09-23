// Cloudflare Pages Function — same-origin proxy for PocketBase's
// /api/collections/users/auth-refresh. Companion to login.js; both
// exist so the browser never has to touch *.trycloudflare.com
// directly (see login.js header for the Vietnamese-ISP reachability
// story). Client sends its current PB token in Authorization; PB
// returns a fresh one with a bumped `exp`. Only valid tokens can
// refresh — an already-expired token is rejected by PB as 401 and
// the client has to sign in again.
//
// Tunnel URL patched by the watchdog like every other PB_URL in
// functions/api/. Must be listed in $pagesFunctionsWithPbUrl in both
// Bat-TOAN-BO*.ps1 scripts.

const PB_URL = 'https://finish-disable-seeing-driving.trycloudflare.com';

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
    ev: 'api_call', ep: 'auth-refresh', status, note,
    ip, cc: cf.country, co: cf.colo, ms: Date.now() - t0,
  }));

  const auth = request.headers.get('Authorization');
  if (!auth) {
    apiLog(401, 'no_auth_header');
    return jsonError(401, 'Thiếu token');
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const upstream = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
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
