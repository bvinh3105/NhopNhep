// Cloudflare Pages Function — same-origin analytics beacon proxy.
// Client POSTs a JSON event to /api/log (first-party, same domain as
// the app). This edge Function forwards it to the PocketBase
// analytics_events collection over the Cloudflare tunnel.
//
// Why the proxy: cross-origin sendBeacon()/fetch to the trycloudflare
// tunnel with an "analytics_events" URL fragment gets swallowed by
// every ad blocker, Chrome Enhanced Tracking Protection, Brave
// shields, and Firefox strict — verified live 2026-09-10 that browser
// sessions logged 0 events while direct curl worked fine. A same-
// origin POST looks like an ordinary app request and slips past all
// of that without touching a single browser setting.
//
// The tunnel URL below is the same one js/community.js uses — must be
// updated together whenever the tunnel rotates. See PROJECT_HANDOFF
// section 4 for the watchdog that normally handles this.

const PB_URL = 'https://interracial-garage-condo-proposed.trycloudflare.com';
const COLLECTION = 'analytics_events';
const MAX_BODY = 8 * 1024; // 8 KB — a single event is ~500 bytes tops

export async function onRequestPost(context) {
  const { request } = context;
  const t0 = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || '-';
  const cf = request.cf || {};

  // Guard: cheap body-size cap so an anonymous caller can't stream
  // arbitrary payload through us.
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (cl > MAX_BODY) {
    console.log(JSON.stringify({ ev:'api_call', ep:'log', status:413, ip, cc:cf.country, co:cf.colo, ms:Date.now()-t0 }));
    return new Response(JSON.stringify({ error: 'payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.text();
    if (!body || body.length > MAX_BODY) throw new Error('empty or too large');
    JSON.parse(body); // shape check — refuse non-JSON early
  } catch (e) {
    console.log(JSON.stringify({ ev:'api_call', ep:'log', status:400, ip, cc:cf.country, co:cf.colo, ms:Date.now()-t0 }));
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Short timeout — beacons should never hang.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const upstream = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    // Don't leak upstream body/status details back — the client fires
    // and forgets, and PocketBase error bodies aren't safe to expose.
    const status = upstream.ok ? 204 : 502;
    console.log(JSON.stringify({ ev:'api_call', ep:'log', status, ip, cc:cf.country, co:cf.colo, ms:Date.now()-t0 }));
    return new Response(null, { status });
  } catch (_) {
    console.log(JSON.stringify({ ev:'api_call', ep:'log', status:502, ip, cc:cf.country, co:cf.colo, ms:Date.now()-t0 }));
    return new Response(null, { status: 502 });
  }
}

// Beacons and same-origin POSTs don't trigger CORS preflight, but
// answer OPTIONS anyway just in case a browser sends one.
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
