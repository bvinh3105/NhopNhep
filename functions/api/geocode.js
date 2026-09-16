// Cloudflare Pages Function — proxies Nominatim (OSM) forward geocode from same origin.
// Path: /api/geocode  (from functions/api/geocode.js)
// Client GETs ?q=<free-text>&viewbox=... OR structured params
// ?housenumber=&street=&district=&city=&viewbox=  (mutually exclusive with q).
//
// Racing pair with Photon (js/geocoder.js): Nominatim is stricter about
// diacritics but far better at exact street+housenumber matches in VN.
// Result is edge-cached 5 min; the same {q|structured, viewbox} within
// TTL collapses to one upstream fetch per CF PoP.
//
// Why proxy instead of calling nominatim.openstreetmap.org direct:
//   1. OSMF policy: identifiable User-Agent required per app; browser fetch()
//      sends the browser's UA which OSMF operators have been known to ban.
//   2. OSMF policy: no client-side autocomplete against the public endpoint.
//      Proxying + edge cache lets us honor "cache aggressively" from one
//      place, and the whole app shares one hit per (query,viewbox).
//   3. OSMF policy: 1 req/s per client IP. From nominatim's side the CF
//      egress IP is one client — the app's entire user base shares that
//      budget. Edge cache is our primary protection; if abuse shows up
//      later we can add the same PocketBase-per-IP counter shape used by
//      gemini-quota.js (TODO: reuse that pattern, don't invent a new one).
//   4. OSMF policy asks the caller to identify: our UA below has app name,
//      version, project URL, and contact.
//
// Response shape mirrors Nominatim's json format (not jsonv2 — the client
// currently reads addressdetails[house_number|road|...] and doesn't need
// place_rank). Errors follow the {error, detail?} shape used by overpass.js.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'NhopNhep/1.0 (+https://nhopnhep.pages.dev; namph@growly.life)';
const UPSTREAM_TIMEOUT_MS = 8000;
const EDGE_CACHE_TTL = 300; // 5 min — matches overpass.js. Nominatim OSM data
                            // changes slowly but repeated typing bursts benefit
                            // most from short-window caching. Bump if abuse hits.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Input caps — hostile-caller shape check, mirrors validateOverpassQuery.
// Every param is either free text (short) or a bounded viewbox rectangle.
// No newline, no NUL, no control chars — kills header/log injection tries.
const MAX_Q_LEN = 200;
const MAX_FIELD_LEN = 100;
const CONTROL_RE = /[\x00-\x1F\x7F]/;
// viewbox = "west,south,east,north" (lon,lat,lon,lat) — up to 6 decimals.
const VIEWBOX_RE = /^-?\d{1,3}(\.\d{1,6})?(,-?\d{1,3}(\.\d{1,6})?){3}$/;

function jsonErr(status, error, detail) {
  const body = detail ? { error, detail } : { error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestGet(context) {
  const { request } = context;
  const t0 = Date.now();
  const cf = request.cf || {};
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const apiLog = (status, note, cache) => console.log(JSON.stringify({
    ev: 'api_call', ep: 'geocode', status, note, cache,
    ip, cc: cf.country, co: cf.colo, ms: Date.now() - t0,
  }));

  const url = new URL(request.url);
  const q          = (url.searchParams.get('q')          || '').trim();
  const housenumber= (url.searchParams.get('housenumber')|| '').trim();
  const street     = (url.searchParams.get('street')     || '').trim();
  const district   = (url.searchParams.get('district')   || '').trim();
  const city       = (url.searchParams.get('city')       || '').trim();
  const viewbox    = (url.searchParams.get('viewbox')    || '').trim();

  // Shape check
  const hasStructured = !!(housenumber || street || district || city);
  if (!q && !hasStructured) {
    apiLog(400, 'missing_query', 'NA');
    return jsonErr(400, 'Missing query — provide q= or structured params');
  }
  // Nominatim rejects q + structured combo; short-circuit here.
  if (q && hasStructured) {
    apiLog(400, 'q_plus_structured', 'NA');
    return jsonErr(400, 'Cannot combine q with structured params');
  }
  if (q.length > MAX_Q_LEN || CONTROL_RE.test(q)) {
    apiLog(400, 'bad_q', 'NA');
    return jsonErr(400, `q must be 1-${MAX_Q_LEN} chars, no control chars`);
  }
  for (const [k, v] of Object.entries({ housenumber, street, district, city })) {
    if (v.length > MAX_FIELD_LEN || CONTROL_RE.test(v)) {
      apiLog(400, `bad_${k}`, 'NA');
      return jsonErr(400, `${k} must be 1-${MAX_FIELD_LEN} chars, no control chars`);
    }
  }
  if (viewbox && !VIEWBOX_RE.test(viewbox)) {
    apiLog(400, 'bad_viewbox', 'NA');
    return jsonErr(400, 'viewbox must be "west,south,east,north" (lon,lat pairs)');
  }

  // Build upstream URL. Nominatim structured search: no housenumber field —
  // combine into street per docs ("10 Phan Chu Trinh"). District → county
  // (OSM tags Vietnamese quận at admin_level 6, which Nominatim indexes as
  // county for VN).
  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    countrycodes: 'vn',
    'accept-language': 'vi,en',
    limit: '8',
    dedupe: '1',
  });
  if (q) {
    params.set('q', q);
  } else {
    const streetCombined = [housenumber, street].filter(Boolean).join(' ');
    if (streetCombined) params.set('street', streetCombined);
    if (district) params.set('county', district);
    if (city)     params.set('city', city);
  }
  if (viewbox) {
    // viewbox is a SOFT bias (bounded=0 default). Callers pass the same
    // bounding box Photon uses so both providers return comparable results.
    params.set('viewbox', viewbox);
  }
  const upstreamUrl = `${NOMINATIM}?${params}`;

  // Edge cache key — normalized on the finalized upstream URL (already
  // canonicalized by URLSearchParams so ordering is stable).
  const cacheKey = new Request(
    `https://cache.local/geocode?h=${await sha1(upstreamUrl)}`,
    { method: 'GET' },
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    apiLog(200, 'ok', 'HIT');
    return new Response(cached.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': cached.headers.get('content-type') || 'application/json',
        'X-Cache': 'HIT',
      },
    });
  }

  // Upstream fetch
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        // OSMF policy: identifiable UA required. A stock UA (or none) is
        // grounds for ban. Send Referer too as a second identity hint.
        'User-Agent': UA,
        'Referer': 'https://nhopnhep.pages.dev',
        'Accept': 'application/json',
        'Accept-Language': 'vi,en;q=0.8',
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    apiLog(502, 'upstream_fetch_err', 'MISS');
    return jsonErr(502, 'Nominatim unreachable', e?.message || String(e));
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    // Nominatim 4xx (bad params) and 5xx (upstream down) both bubble up.
    // 429 from Nominatim = we hit their per-IP throttle: the frontend will
    // silently fall back to Photon-only (js/geocoder.js races both).
    apiLog(upstream.status, 'upstream_bad_status', 'MISS');
    return jsonErr(upstream.status, `Nominatim HTTP ${upstream.status}`);
  }

  const text = await upstream.text();
  // Cheap sanity check — Nominatim always returns a JSON array for /search.
  if (!text.startsWith('[')) {
    apiLog(502, 'upstream_non_json', 'MISS');
    return jsonErr(502, 'Nominatim returned non-JSON');
  }

  const resp = new Response(text, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'X-Cache': 'MISS',
      'Cache-Control': `public, max-age=${EDGE_CACHE_TTL}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  apiLog(200, 'ok', 'MISS');
  return resp;
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
