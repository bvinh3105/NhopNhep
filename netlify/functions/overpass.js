// Netlify Function — proxies Overpass API from same origin.
// Client POSTs 'data=<overpass-query>' to /.netlify/functions/overpass
// and gets the JSON back with same-origin headers (no CORS involved).
//
// Races 3 Overpass mirrors in parallel and returns the first success.
// Individual fetches capped at 8s so one hung mirror can't stall the
// whole function past Netlify's 10s timeout.

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: 'Method not allowed' };
  }

  // Accept the query either from body (POST) or from ?data= (GET)
  const body = event.httpMethod === 'GET'
    ? (event.queryStringParameters && event.queryStringParameters.data
        ? 'data=' + encodeURIComponent(event.queryStringParameters.data)
        : '')
    : (event.body || '');

  // Security audit fix (2026-09-08): no auth + CORS '*' means anyone can
  // POST here — reject anything that doesn't look like the small bounded-
  // radius query js/poi.js._query() actually generates, so this can't be
  // used as a free anonymous relay for arbitrary/expensive Overpass QL
  // (abuse risk: shared mirrors throttle/ban our UA, breaking real lookups).
  const rejection = validateOverpassQuery(decodeURIComponent(body.replace(/^data=/, '')));
  if (rejection) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: rejection }) };
  }

  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];

  const PER_MIRROR_TIMEOUT = 8000;

  const attempts = mirrors.map(url => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_MIRROR_TIMEOUT);
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
      // Reject empty results — stale mirrors return "elements": []
      const parsed = JSON.parse(text);
      if (!parsed.elements || parsed.elements.length === 0) {
        throw new Error(`${url} → 0 elements (stale mirror)`);
      }
      return { url, text, contentType: res.headers.get('content-type') || 'application/json' };
    }).catch(e => {
      clearTimeout(timer);
      throw e;
    });
  });

  try {
    const winner = await Promise.any(attempts);
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': winner.contentType,
        'X-Overpass-Mirror': winner.url,
      },
      body: winner.text,
    };
  } catch (e) {
    const reasons = (e.errors || [e]).map(x => x?.message || String(x)).join(' | ');
    console.warn('[overpass proxy] all mirrors failed:', reasons);
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({ error: 'All Overpass mirrors unavailable', detail: reasons }),
    };
  }
};

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
