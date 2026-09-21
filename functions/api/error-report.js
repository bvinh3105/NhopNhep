// Cloudflare Pages Function — receives frontend crash/error reports.
//
// HOW TO VIEW LOGS:
//   Cloudflare Dashboard → Workers & Pages → nhopnhep
//   → Deployments → (any deployment) → Functions tab → Real-time Logs
//   Filter string: [crash]   ← JS errors from users' devices
//   Filter string: [api]     ← call-count / latency from other functions
//
// PocketBase SETUP (one-time, optional — logs work without it):
//   Create collection 'error_logs' with fields:
//   kind(text), msg(text), src(text), line(number), col(number),
//   ver(text), href(text), ip(text), country(text), colo(text), t(text)
//   All optional. Function silently skips PB if tunnel is down.
//
// Tunnel URL — patched by the same watchdog (Bat-TOAN-BO*.ps1) that
// updates log.js and register.js. Keep the constant name identical.

const PB_URL     = 'https://interracial-garage-condo-proposed.trycloudflare.com';
const COLLECTION = 'error_logs';
const MAX_BODY   = 2 * 1024; // 2 KB — a crash report is < 400 bytes

export async function onRequestPost(context) {
  const { request } = context;

  // Size guard — same pattern as functions/api/log.js.
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (cl > MAX_BODY) return new Response(null, { status: 413 });

  let report;
  try {
    const text = await request.text();
    if (!text || text.length > MAX_BODY) throw new Error('bad body');
    report = JSON.parse(text);
    if (typeof report !== 'object' || report === null) throw new Error('not object');
  } catch (_) {
    return new Response(null, { status: 400 });
  }

  const ip    = request.headers.get('CF-Connecting-IP') || '-';
  const cf    = request.cf || {};
  const entry = {
    kind:    String(report.kind || 'unknown').slice(0, 30),
    msg:     String(report.msg  || '').slice(0, 200),
    src:     String(report.src  || '').slice(0, 100),
    line:    Number(report.line) || 0,
    col:     Number(report.col)  || 0,
    ver:     String(report.ver  || '').slice(0, 10),
    href:    String(report.href || '').slice(0, 100),
    ip,
    country: cf.country || '-',
    colo:    cf.colo    || '-',
    t:       new Date().toISOString(),
  };

  // Always log to CF Workers — visible immediately in Real-time Logs.
  console.error('[crash]', JSON.stringify(entry));

  // Best-effort: forward to PocketBase. Fire-and-forget via waitUntil so
  // the 204 response is not held up by PB availability (tunnel rotates).
  context.waitUntil(
    fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
      signal:  AbortSignal.timeout(6000),
    }).catch(() => { /* silently skip — PB is best-effort for error logs */ }),
  );

  return new Response(null, { status: 204 });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
