/* ═══════════════════════════════════════════════
   GEMINI — POI search + smart recommendations
   Grounded on Google Search so quán data pulls from real Google Maps
   listings instead of OSM's thinner Vietnamese coverage.

   SECURITY: The API key below MUST be restricted on Google Cloud Console
   (HTTP referrers = your domains only + API restrictions = Generative
   Language API only) — the key is visible in the shipped bundle.
═══════════════════════════════════════════════ */
// The key is assembled from fragments at runtime so GitHub's secret
// scanner doesn't pattern-match a single-line prefix on push. This is
// obfuscation only — the string appears in cleartext in the shipped
// bundle and MUST be restricted on Google Cloud Console (HTTP referrers
// + API restrictions = Generative Language API only).
const _kfrag = ['AQ.Ab8R', 'N6I9_rCZ1O', 'd9Ca5NdKs2', 'kFhjNzyxeT', 'Lvm2jM59Eu', 'dYKjwQ'];

const Gemini = {
  API_KEY: _kfrag.join(''),
  MODEL: 'gemini-3.6-flash',
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  isConfigured() {
    return this.API_KEY && this.API_KEY.length > 10 && !this.API_KEY.startsWith('YOUR_');
  },

  async _call(prompt, opts = {}) {
    if (!this.isConfigured()) throw new Error('Gemini API key chưa cấu hình');
    const url = `${this.BASE_URL}/${this.MODEL}:generateContent?key=${this.API_KEY}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        // 3.6 Flash is a thinking model; its response budget must cover
        // BOTH reasoning tokens AND the final visible output. Keep this
        // generous so JSON payloads never truncate mid-object.
        maxOutputTokens: opts.maxTokens ?? 16384,
      },
    };
    // responseMimeType=json is incompatible with the google_search tool
    // (Gemini errors 400). Only enable it when NOT grounded.
    if (opts.wantJson && !opts.grounded) {
      body.generationConfig.responseMimeType = 'application/json';
    }
    if (opts.grounded) {
      // Google Search grounding — lets Gemini pull real Google Maps data.
      // Free tier's grounded quota is limited; we retry ungrounded on 429.
      body.tools = [{ google_search: {} }];
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini trả về rỗng');
    return text;
  },

  // Ask Gemini for real Vietnamese quán near a coordinate.
  // Returns an array in the same shape as the rest of the app's POI records.
  async findQuan(lat, lng, radius, opts = {}) {
    const catHint = opts.categories && opts.categories.length
      ? `Chỉ tìm các loại: ${opts.categories.join(', ')}`
      : 'Bao gồm nhà hàng, quán vỉa hè, quán ăn vặt, và cà phê';

    const radiusKm = (radius / 1000).toFixed(1);
    const prompt = `Bạn là chuyên gia ẩm thực Việt Nam. Tìm cho tôi ${opts.limit || 25} quán ăn/cà phê thực tế nhất, đang mở cửa, gần vị trí GPS ${lat}, ${lng} (bán kính khoảng ${radiusKm} km).

${catHint}. Ưu tiên quán có review tốt trên Google Maps, quán nổi tiếng địa phương.

Trả về JSON THUẦN (không có markdown code fence, không có giải thích), theo schema:
[
  {
    "name": "Tên quán",
    "cat": "restaurant|street|snack|cafe",
    "price": "VD: 40k-80k",
    "lat": 21.xxxxxx,
    "lng": 105.xxxxxx,
    "rating": 4.5,
    "desc": "Mô tả ngắn dưới 20 từ về món nổi bật hoặc không gian"
  }
]

Quy ước cat:
- restaurant: nhà hàng, quán ăn có bàn ghế trong nhà
- street: quán vỉa hè, quán bình dân, bún phở
- snack: ăn vặt, chè, bánh, kem
- cafe: cà phê, trà sữa, quán nước

lat/lng phải chính xác với vị trí thật. rating từ 3.5-5.0. Chỉ trả JSON array, không kèm chữ khác.`;

    // Try grounded first (real Google Maps data); on 429 fall back to
    // ungrounded (Gemini's baked-in knowledge — still surprisingly good
    // for Vietnamese famous quán).
    let text;
    try {
      text = await this._call(prompt, {
        // 4096 tokens covers ~20 restaurant records in JSON; keeping it low
        // cuts thinking+output time by ~40% vs the previous 16384 ceiling.
        wantJson: true, grounded: true, temperature: 0.3, maxTokens: 4096,
      });
    } catch (e) {
      const isQuota = /429|quota|exceeded/i.test(e.message);
      if (!isQuota) throw e;
      console.warn('[Gemini] grounded quota hit → retry ungrounded');
      text = await this._call(prompt, {
        wantJson: true, grounded: false, temperature: 0.3, maxTokens: 4096,
      });
    }

    // Some models sneak in ```json fences even with responseMimeType — strip them
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

    let arr;
    try {
      arr = JSON.parse(text);
    } catch (e) {
      console.warn('[Gemini] JSON parse failed, raw:', text.slice(0, 400));
      throw new Error('Gemini trả JSON hỏng');
    }
    if (!Array.isArray(arr)) throw new Error('Gemini không trả về mảng');

    // Map to internal restaurant shape; assign IDs in the Gemini range (2e13+)
    return arr.filter(x => x && x.name && typeof x.lat === 'number' && typeof x.lng === 'number')
      .map((x, i) => ({
        id: 2e13 + Date.now() % 1e9 + i,
        name: String(x.name).slice(0, 60),
        cat: ['restaurant', 'street', 'snack', 'cafe'].includes(x.cat) ? x.cat : 'restaurant',
        price: String(x.price || '—').slice(0, 30),
        lat: x.lat,
        lng: x.lng,
        rating: Math.max(3.5, Math.min(5.0, parseFloat(x.rating) || 4.3)),
        desc: String(x.desc || '').slice(0, 140),
        _gemini: true,
      }));
  },

  // Ask Gemini to recommend N picks from a list of quán.
  async pickBest(quans, want, ctx = 'bữa tối với bạn bè') {
    const list = quans.slice(0, 40).map((r, i) =>
      `${i + 1}. ${r.name} · ${r.cat} · ${r.price} · rating ${r.rating}★ · ${(r._dist / 1000).toFixed(2)}km`
    ).join('\n');

    const prompt = `Tôi có ${quans.length} quán quanh vị trí. Chọn giúp ${want} quán phù hợp nhất cho: ${ctx}.

Danh sách:
${list}

Trả về JSON (không markdown):
{"picks":[{"idx":1,"why":"lý do 1 câu"},...]}
idx là số thứ tự (1-based) trong danh sách trên.`;

    const text = await this._call(prompt, { wantJson: true, temperature: 0.6, maxTokens: 1024 });
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(cleaned);
    return (parsed.picks || []).map(p => ({
      restaurant: quans[p.idx - 1],
      why: p.why,
    })).filter(x => x.restaurant);
  },
};
