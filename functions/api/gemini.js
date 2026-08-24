// Cloudflare Pages Function — server-side Gemini proxy.
// The API key never touches the client. Set it once in the Cloudflare
// dashboard (or via `wrangler pages secret put GEMINI_API_KEY`).
//
// Client body: { model, contents, generationConfig, tools }
// Client never sends a key. Server signs the request server-side.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_MODELS = new Set([
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // Trim — Wrangler CLI 'secret put' occasionally captures a trailing
  // newline from stdin piping, and Google rejects the key as invalid
  // once encodeURIComponent turns that \n into %0A.
  const key = (env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return json({ error: 'GEMINI_API_KEY not configured on server' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const model = String(payload.model || 'gemini-flash-latest');
  if (!ALLOWED_MODELS.has(model)) {
    return json({ error: `Model "${model}" not allowed` }, 400);
  }

  // Rebuild the upstream body — drop any client-supplied fields we
  // don't want forwarded (safety settings we can't audit, etc.).
  const upstreamBody = {
    contents: payload.contents,
    generationConfig: payload.generationConfig,
  };
  if (Array.isArray(payload.tools)) upstreamBody.tools = payload.tools;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'NhopNhep/1.0 (+https://nhopnhep.pages.dev)',
    },
    body: JSON.stringify(upstreamBody),
  });

  const text = await upstream.text();
  // Surface a clearer message when Google refuses the request because
  // the Cloudflare edge IP resolved to a region Gemini free tier does
  // not serve. This is Google's rule, not something we can bypass; the
  // client should fall back to OSM-only results.
  if (upstream.status === 400 && /location is not supported/i.test(text)) {
    return json({
      error: 'GEMINI_REGION_BLOCKED',
      detail: 'Cloudflare edge region is not supported by Gemini free tier. Falling back to OSM.',
    }, 451);
  }
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...cors,
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
