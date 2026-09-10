// ⚠️ DORMANT — built and deployed 2026-09-10, then REVERTED same day and
// disconnected from the client (js/gemini.js no longer calls this route).
// Kept in the repo only as a documented dead end — nothing currently
// requests /api/gemini-search.
//
// ORIGINAL GOAL: proxy + edge-cache Gemini restaurant search for the
// shared/default API key path, so many users scanning the same area during
// a launch-day traffic spike would share ONE real Gemini call instead of
// each spending a unit of the small shared free-tier quota (~1,000-1,500
// req/day total, across EVERY visitor) — same mechanism as the working
// functions/api/overpass.js, just for AI results instead of map data.
//
// WHY IT'S DISABLED: verified live and 100% reproducible — Cloudflare
// executes Pages Functions for Vietnam-origin requests (confirmed via
// request.cf: country "VN", region "Hanoi") at its Hong Kong colo (HKG),
// and Gemini's API hard-rejects any call whose network origin is Hong
// Kong: `400 FAILED_PRECONDITION "User location is not supported for the
// API use."` Calling directly from the user's own browser (the original,
// restored approach) avoids this entirely, since the real network origin
// is wherever the user actually is, not Cloudflare's edge routing choice.
// Revisit only if Cloudflare adds a Vietnam/SEA compute PoP that isn't
// HKG, or Google lifts the Hong Kong restriction.

const MODEL = 'gemini-flash-lite-latest';
const EDGE_CACHE_TTL = 1800; // 30 min — restaurant existence doesn't change
                             // fast; this is the main lever for stretching
                             // the shared quota through a traffic spike.
const GEMINI_TIMEOUT_MS = 11000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_CATS = ['restaurant', 'street', 'snack', 'cafe'];
const MAX_RADIUS_M = 10000; // matches the app's own UI ceiling (5km chip)
const MAX_DISH_LEN = 60;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!env.GEMINI_API_KEY) {
    // Fails closed, not open — client falls back to OSM same as any other
    // Gemini error (see js/controllers.js scan()'s .catch()).
    return json({ error: 'Server not configured (missing GEMINI_API_KEY)' }, 503);
  }

  let params;
  try {
    params = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const rejection = validateParams(params);
  if (rejection) return json({ error: rejection }, 400);

  const { lat, lng, radius, categories, dish, limit } = normalizeParams(params);

  // ---- Edge cache lookup ----
  const cacheKeyStr = [
    lat.toFixed(3), lng.toFixed(3), radius,
    [...categories].sort().join(','),
    dish.toLowerCase(),
  ].join('|');
  const cacheKey = new Request(`https://cache.local/gemini-search?h=${await sha1(cacheKeyStr)}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } });
  }

  // ---- Cache miss: call Gemini for real ----
  const prompt = buildPrompt({ lat, lng, radius, categories, dish, limit });
  const temperature = dish ? 0.3 : 0.4;

  let items;
  try {
    items = await callGemini(env.GEMINI_API_KEY, prompt, temperature);
  } catch (e) {
    // Temporary diagnostic (2026-09-10): include which Cloudflare edge PoP
    // handled this so we can tell whether a Gemini geo-restriction error is
    // specific to one colo or affects the PoPs real users actually hit.
    return json({
      error: 'Gemini call failed', detail: String(e.message || e),
      _diag: { colo: request.cf?.colo, country: request.cf?.country, region: request.cf?.region },
    }, 502);
  }

  const respBody = JSON.stringify(items);
  const resp = new Response(respBody, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'X-Cache': 'MISS',
      'Cache-Control': `public, max-age=${EDGE_CACHE_TTL}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function validateParams(p) {
  if (!p || typeof p !== 'object') return 'Missing body';
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || Number.isNaN(p.lat) || Number.isNaN(p.lng)) return 'Invalid lat/lng';
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return 'lat/lng out of range';
  if (p.radius != null && (typeof p.radius !== 'number' || p.radius <= 0 || p.radius > MAX_RADIUS_M)) return `radius must be 1-${MAX_RADIUS_M}`;
  if (p.categories != null && (!Array.isArray(p.categories) || p.categories.some(c => !VALID_CATS.includes(c)))) return 'Invalid categories';
  if (p.dish != null && (typeof p.dish !== 'string' || p.dish.length > MAX_DISH_LEN)) return `dish must be a string up to ${MAX_DISH_LEN} chars`;
  if (p.limit != null && (typeof p.limit !== 'number' || p.limit < 1 || p.limit > 30)) return 'limit must be 1-30';
  return null;
}

function normalizeParams(p) {
  return {
    lat: p.lat, lng: p.lng,
    radius: p.radius || 1000,
    categories: p.categories && p.categories.length ? p.categories : VALID_CATS,
    dish: (p.dish || '').trim(),
    limit: p.limit || 20,
  };
}

// Mirrors js/gemini.js findQuan()'s prompt — kept in sync manually since
// this Function and the client run in separate environments (no shared
// module system in this vanilla-JS, no-build-step project). If you change
// the wording/rules in one place, change it in the other too.
function buildPrompt({ lat, lng, radius, categories, dish, limit }) {
  const catHint = categories.length && categories.length < VALID_CATS.length
    ? `Chỉ tìm loại: ${categories.join(', ')}`
    : 'Nhà hàng, vỉa hè, ăn vặt, cà phê';

  const q = dish;
  const searchRadiusKm = q ? Math.max(radius / 1000, 6).toFixed(1) : (radius / 1000).toFixed(1);

  const regionHint = 'Trước tiên xác định quốc gia/thành phố thực tế của toạ độ GPS này (trọng tâm là Việt Nam, Đông Nam Á, và Châu Á nói chung — nhưng nếu toạ độ rơi vào nơi khác thì vẫn phải nhận diện đúng, đừng mặc định là Việt Nam). Dựa vào đó suy ra: tên quán viết đúng theo ngôn ngữ/cách viết địa phương, địa chỉ đúng định dạng địa phương, và GIÁ ghi bằng ĐÚNG đơn vị tiền tệ + cách viết của nước đó (VD: Việt Nam "25.000-45.000đ", Thái Lan "100-200 บาท / 100-200 THB", Indonesia "30.000-60.000 Rp", Philippines "₱150-300", Malaysia "RM15-30" — không mặc định ghi kiểu "40k-80k" nếu không phải Việt Nam).';

  if (q) {
    return `Bạn là chuyên gia ẩm thực & bản đồ khắp Châu Á, thông thạo quán ăn địa phương ở bất kỳ đâu trong khu vực.
${regionHint}

Người dùng đang tìm: "${q}" — gần toạ độ GPS ${lat}, ${lng} (trong bán kính ${searchRadiusKm}km).

Xác định "${q}" là TÊN MÓN hay TÊN QUÁN cụ thể:
- Nếu là TÊN MÓN (vd: bánh canh, phở, tom yum, nasi goreng, lẩu) → liệt kê CÀNG NHIỀU quán CÓ THẬT, đang hoạt động, bán/phục vụ món đó gần toạ độ này CÀNG TỐT — mục tiêu 10-15+ quán nếu khu vực đủ đông đúc (giống mức độ đầy đủ như tìm trên Google Maps, đừng chỉ liệt kê vài quán nổi tiếng nhất rồi dừng). Đây KHÔNG phải tra tên thương hiệu cụ thể nên không cần chắc chắn tuyệt đối từng quán — chỉ cần là quán ăn thật sự tồn tại ở khu vực này và nhiều khả năng có bán món này (theo loại hình/tên quán/ẩm thực đặc trưng khu vực), không cần bỏ qua chỉ vì không chắc 100%.
- Nếu là TÊN QUÁN / THƯƠNG HIỆU cụ thể (kể cả gõ tắt/viết thường, vd "brave", "highlands") → kết quả ĐẦU TIÊN phải là quán CÓ THẬT khớp nhất, với "name" là TÊN ĐẦY ĐỦ CHÍNH THỨC ĐÚNG như trên Google Maps (vd gõ "brave" → name "Brave Coffee Brewers"; gõ "highlands" → "Highlands Coffee"). Viết hoa đúng chuẩn, KHÔNG để nguyên chữ người dùng gõ, KHÔNG bịa quán khác tên na ná (vd KHÔNG trả "Brave Roastery" khi họ tìm Brave Coffee Brewers). Nếu không chắc chắn quán đó có thật ở đúng vị trí này không, đừng bịa — bỏ qua kết quả đó thay vì đoán liều. (Lưu ý: mức độ thận trọng này CHỈ áp dụng cho tra tên thương hiệu cụ thể, KHÔNG áp dụng cho trường hợp TÊN MÓN ở trên.)

Sau kết quả đầu, mới liệt kê chi nhánh / quán liên quan. Trả tối đa ${limit} kết quả, khớp nhất xếp trước. Nếu không có quán nào khớp, trả [].

Trả về JSON THUẦN (không markdown, không giải thích):
[{"name":"tên quán","address":"địa chỉ đúng định dạng địa phương","cat":"restaurant|street|snack|cafe","price":"giá bằng đúng tiền tệ địa phương","lat":${lat},"lng":${lng},"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

Quy tắc: lat/lng gần đúng khu vực quán. rating 3.5-5.0. Chỉ trả JSON array.`;
  }
  return `Bạn là chuyên gia ẩm thực & bản đồ khắp Châu Á, thông thạo quán ăn địa phương ở bất kỳ đâu trong khu vực.
${regionHint}

Tìm ${limit} quán ăn/cà phê CÓ THẬT, đang hoạt động, gần toạ độ GPS ${lat}, ${lng} (trong bán kính ${searchRadiusKm}km).
${catHint}. Ưu tiên quán nổi tiếng, review tốt. Nếu không chắc chắn 1 quán có thật ở đúng vị trí này không, đừng bịa — bỏ qua thay vì đoán liều.

Trả về JSON THUẦN (không markdown, không giải thích):
[{"name":"tên quán","address":"địa chỉ đúng định dạng địa phương","cat":"restaurant|street|snack|cafe","price":"giá bằng đúng tiền tệ địa phương","lat":${lat},"lng":${lng},"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

Quy tắc: lat/lng gần đúng khu vực quán. address ghi rõ tên đường/phố + khu vực theo cách viết địa phương. rating từ 3.5 đến 5.0. Chỉ trả JSON array.`;
}

async function callGemini(apiKey, prompt, temperature) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 150)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error('Gemini did not return an array');
  return parsed.filter(x => x?.name && typeof x.lat === 'number' && typeof x.lng === 'number');
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
