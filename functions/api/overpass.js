// Cloudflare Pages Function — proxies Overpass API from same origin.
// Path: /api/overpass  (from functions/api/overpass.js)
// Client POSTs 'data=<overpass-query>' as body (or GET ?data=...).
//
// Races 3 Overpass mirrors in parallel; first success wins.
// Result is cached at the edge for 5 minutes, so nearby scans by
// other users hit the CDN and skip the upstream fetch entirely.

// All three mirrors carry the full planet.osm dataset. Never add
// region-scoped mirrors (e.g. overpass.osm.ch is Switzerland-only —
// it returns "elements": [] for queries outside CH and wins the race
// because it responds fastest). Verified working 2026-08-24:
//   overpass-api.de ~2s · z.overpass-api.de ~2s · mail.ru ~4s
// Known bad right now: kumi.systems (12s+ timeout), private.coffee (dead).
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const PER_MIRROR_TIMEOUT_MS = 12000;
// Overpass mirrors reject requests without a User-Agent (returns 406).
// Cloudflare Workers' fetch() doesn't set one by default.
const UA = 'NhopNhep/1.0 (+https://nhopnhep.pages.dev)';
const EDGE_CACHE_TTL = 300;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  // Grab the query — POST body form-urlencoded OR GET ?data=
  let body = '';
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const data = url.searchParams.get('data');
    if (data) body = 'data=' + encodeURIComponent(data);
  } else {
    body = await request.text();
  }
  if (!body) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Security audit fix (2026-09-08): this endpoint has no auth and CORS is
  // wide open (needed — it's called cross-origin-free same-site, but also
  // means literally anyone can POST here), so without a shape check it's a
  // free anonymous relay for ARBITRARY Overpass QL against 3 real public
  // mirrors under our shared User-Agent — abuse risk is those mirrors
  // throttling/banning that UA, breaking real POI lookups for our actual
  // users. Reject anything that doesn't look like the small bounded-radius
  // query js/poi.js._query() actually generates.
  const rejection = validateOverpassQuery(decodeURIComponent(body.replace(/^data=/, '')));
  if (rejection) {
    return new Response(JSON.stringify({ error: rejection }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Edge cache key — same body → same result within TTL
  const cacheKey = new Request(
    `https://cache.local/overpass?h=${await sha1(body)}`,
    { method: 'GET' },
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': cached.headers.get('content-type') || 'application/json',
        'X-Cache': 'HIT',
      },
    });
  }

  const attempts = MIRRORS.map(url => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_MIRROR_TIMEOUT_MS);
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        // Do NOT send Accept — Overpass serves text/plain and 406s any
        // Accept that doesn't include text/*. */* also works, but the
        // safest option is to omit the header entirely.
      },
      body,
      signal: ctrl.signal,
    }).then(async res => {
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('"elements"')) {
        throw new Error(`${url} → non-JSON response`);
      }
      return { url, text, contentType: res.headers.get('content-type') || 'application/json' };
    }).catch(e => {
      clearTimeout(timer);
      throw e;
    });
  });

  try {
    const winner = await raceForNonEmpty(attempts);
    const resp = new Response(winner.text, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': winner.contentType,
        'X-Overpass-Mirror': winner.url,
        'X-Cache': 'MISS',
        'X-Element-Count': String(countElements(winner.text)),
        'Cache-Control': `public, max-age=${EDGE_CACHE_TTL}`,
      },
    });
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    const reasons = (e.errors || [e]).map(x => x?.message || String(x)).join(' | ');
    return new Response(
      JSON.stringify({ error: 'All Overpass mirrors unavailable', detail: reasons }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
}

// Count top-level elements in an Overpass response. Cheap regex — the
// real parse happens on the client. Just enough to prefer non-empty.
function countElements(text) {
  const idx = text.indexOf('"elements"');
  if (idx < 0) return 0;
  const after = text.slice(idx);
  // { blocks inside the elements array — each element is an object
  const matches = after.match(/\{\s*"type"/g);
  return matches ? matches.length : 0;
}

// Prefer any response with elements. Fall back to the fastest response
// (even if empty) if all mirrors return empty; reject only when every
// mirror errors out. Non-empty short-circuits — we don't wait for the rest.
function raceForNonEmpty(promises) {
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    let fallback = null;
    const errors = [];
    promises.forEach(p => {
      p.then(result => {
        remaining--;
        if (countElements(result.text) > 0) {
          resolve(result);
        } else {
          if (!fallback) fallback = result;
          if (remaining === 0) resolve(fallback);
        }
      }).catch(e => {
        remaining--;
        errors.push(e);
        if (remaining === 0) {
          if (fallback) resolve(fallback);
          else reject({ errors });
        }
      });
    });
  });
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Only accept small, bounded-radius "around" queries shaped like the ones
// js/poi.js._query() actually generates — rejects arbitrary/expensive
// planet-wide Overpass QL relayed through us by someone who isn't the app.
const MAX_QUERY_LEN = 3000;
const MAX_RADIUS_M = 10000; // app's own UI radius chips top out at 5km
function validateOverpassQuery(query) {
  if (!query || query.length > MAX_QUERY_LEN) return 'Query too large or empty';
  if (!/\[out:json\]/.test(query)) return 'Query missing [out:json]';
  const radii = [...query.matchAll(/around:(\d+)/g)].map(m => parseInt(m[1], 10));
  if (!radii.length) return 'Query missing around(radius,...) filter';
  if (radii.some(r => r > MAX_RADIUS_M)) return `Radius exceeds ${MAX_RADIUS_M}m limit`;
  return null; // ok
}
