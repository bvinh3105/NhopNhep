// Cloudflare Pages Function — daily cap check for the app's SHARED Gemini
// key. Called by js/gemini.js right before it uses the built-in key (never
// for a user's own key — that's between them and Google).
//
// Why this can exist when a full Gemini proxy can't: this Function only
// talks to PocketBase (self-hosted, no region block), never to Gemini
// itself. The actual Gemini call still goes straight from the browser —
// see js/gemini.js header for why Cloudflare's HK routing gets Gemini
// requests rejected. This endpoint just answers "has this IP used up
// today's free shared-key searches?", same same-origin-proxy pattern as
// log.js/register.js/error-report.js.
//
// FAIL-OPEN by design: if PocketBase/the tunnel is unreachable or slow,
// this returns {allowed:true, degraded:true} rather than blocking search —
// the tunnel rotates/hiccups often (see PROJECT_HANDOFF), and Google's own
// per-key quota is still the real backstop behind the shared key. A down
// quota-tracker should never be the reason AI search stops working.
//
// HOW TO VIEW LOGS: same as log.js — CF Dashboard → Functions → Real-time
// Logs, filter "[api]".
//
// Tunnel URL — patched by the same watchdog (Bat-TOAN-BO*.ps1) that
// updates log.js/register.js/error-report.js. Keep the constant name
// identical so the watchdog's find/replace still catches this file.

const PB_URL       = 'https://annual-cam-huge-candle.trycloudflare.com';
const COLLECTION   = 'gemini_quota';
const DAILY_LIMIT  = 15;

// Asia/Ho_Chi_Minh has no DST (fixed UTC+7) — plain offset math is enough,
// no need for Intl.DateTimeFormat's heavier timezone plumbing in a Worker.
function todayICT() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// Record id + stored key derived from ip+day, so this Function never has
// to LIST the collection (listRule became superuser-only in migration
// 1790000004 — the public list exposed every tester's IP) and never stores
// the raw IP. Ids must match PocketBase's default ^[a-z0-9]{15}$.
async function quotaKeys(ip, day) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nhopnhep-quota|${ip}|${day}`)));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) id += alphabet[digest[i] % 36];
  const ipHash = Array.from(digest.slice(15, 31), b => b.toString(16).padStart(2, '0')).join('');
  return { id, ipHash };
}

function json(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request } = context;
  const t0  = Date.now();
  const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
  const cf  = request.cf || {};
  const day = todayICT();
  const signal = AbortSignal.timeout(5000);

  try {
    const { id, ipHash } = await quotaKeys(ip, day);
    const getRes = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, { signal });
    if (!getRes.ok && getRes.status !== 404) throw new Error(`view ${getRes.status}`);
    const existing = getRes.ok ? await getRes.json() : null;

    let result;
    if (!existing) {
      // First request today from this IP. A near-simultaneous duplicate
      // could race here (two inserts for the same id) — PocketBase rejects
      // the loser, which is fine: this is a soft cap, not a security boundary.
      await fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ip: ipHash, day, count: 1 }),
        signal,
      });
      result = { allowed: true, remaining: DAILY_LIMIT - 1 };
    } else if (existing.count >= DAILY_LIMIT) {
      result = { allowed: false, remaining: 0 };
    } else {
      await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: existing.count + 1 }),
        signal,
      });
      result = { allowed: true, remaining: DAILY_LIMIT - existing.count - 1 };
    }

    console.log(JSON.stringify({ ev: 'api_call', ep: 'gemini-quota', status: 200, ip, cc: cf.country, co: cf.colo, ms: Date.now() - t0, ...result }));
    return json(result);
  } catch (e) {
    // Fail-open — see file header. Covers PB down, tunnel timeout, and the
    // rare create-race case above.
    console.log(JSON.stringify({ ev: 'api_call', ep: 'gemini-quota', status: 'degraded', ip, cc: cf.country, co: cf.colo, ms: Date.now() - t0, err: e.message }));
    return json({ allowed: true, degraded: true });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
