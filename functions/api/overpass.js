// Cloudflare Pages Function — proxies Overpass API from same origin.
// Path: /api/overpass  (from functions/api/overpass.js)
// Client POSTs 'data=<overpass-query>' as body (or GET ?data=...).
//
// Races 3 Overpass mirrors in parallel; first success wins.
// Result is cached at the edge for 5 minutes, so nearby scans by
// other users hit the CDN and skip the upstream fetch entirely.

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const PER_MIRROR_TIMEOUT_MS = 8000;
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    const winner = await Promise.any(attempts);
    const resp = new Response(winner.text, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': winner.contentType,
        'X-Overpass-Mirror': winner.url,
        'X-Cache': 'MISS',
        'Cache-Control': `public, max-age=${EDGE_CACHE_TTL}`,
      },
    });
    // Store a clone in the edge cache
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

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
