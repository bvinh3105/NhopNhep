// Netlify Function — proxies Overpass API from same origin.
// Client POSTs 'data=<overpass-query>' to /.netlify/functions/overpass
// and gets the JSON back with same-origin headers (no CORS involved).

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

  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
  ];

  for (const url of mirrors) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        console.warn('[overpass proxy]', url, 'returned', res.status);
        continue;
      }
      const text = await res.text();
      return {
        statusCode: 200,
        headers: {
          ...cors,
          'Content-Type': res.headers.get('content-type') || 'application/json',
        },
        body: text,
      };
    } catch (e) {
      console.warn('[overpass proxy]', url, e.message);
    }
  }

  return {
    statusCode: 502,
    headers: cors,
    body: JSON.stringify({ error: 'All Overpass mirrors unavailable' }),
  };
};
