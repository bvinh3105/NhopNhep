// Netlify Function — server-side Gemini proxy.
// Client POSTs { model, contents, generationConfig, tools } to /api/gemini.
// The GEMINI_API_KEY env var signs the request; the client never sees it.
//
// Set the key in Netlify dashboard: Site Settings → Environment Variables →
// Add variable: GEMINI_API_KEY = <your Google AI Studio key>

const ALLOWED_MODELS = new Set([
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
]);

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };
  }

  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return {
      statusCode: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Body must be JSON' }),
    };
  }

  const model = String(payload.model || 'gemini-flash-latest');
  if (!ALLOWED_MODELS.has(model)) {
    return {
      statusCode: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Model "${model}" not allowed` }),
    };
  }

  const upstreamBody = {
    contents: payload.contents,
    generationConfig: payload.generationConfig,
  };
  if (Array.isArray(payload.tools)) upstreamBody.tools = payload.tools;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    });

    const text = await upstream.text();

    if (upstream.status === 400 && /location is not supported/i.test(text)) {
      return {
        statusCode: 451,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'GEMINI_REGION_BLOCKED',
          detail: 'Server region not supported by Gemini free tier. Falling back to OSM.',
        }),
      };
    }

    return {
      statusCode: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed', detail: e.message }),
    };
  }
};
