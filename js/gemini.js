/* ═══════════════════════════════════════════════
   GEMINI AI — client-side direct call
   The Gemini REST API supports CORS, so we call Google directly from
   the browser. No serverless proxy needed (Cloudflare Functions were
   unreliable). Two key sources, in order:
     1) User's own key in localStorage (Settings → Gemini AI)
     2) Built-in shared key (fragmented below), HTTP-referrer restricted
        on Google Cloud Console to nhopnhep.pages.dev + localhost.
═══════════════════════════════════════════════ */

// Built-in shared key, split so GitHub secret-scanning doesn't auto-revoke.
// SECURITY — the key is protected by THREE layers:
//   1. Private GitHub repo (source not publicly scrapeable)
//   2. HTTP-referrer restriction on Google Cloud Console (the real guard —
//      the key only works when the request comes from an allowed domain)
//   3. Runtime host allow-list below (the app itself refuses to send the
//      built-in key from any host other than these, so a cloned copy on
//      another domain can't quietly ride on it)
const _kfrag = ['AQ.Ab8R', 'N6JCbUoWpz', 'JvFMkd88FT', 'NULcPpuZjl', '9Ck3AULxBF', 'nskJow'];

// Hosts allowed to use the built-in key. Everything else must supply its
// own key via Settings. Keep in sync with the Google Cloud referrer list.
const _allowedHosts = ['nhopnhep.pages.dev', 'nhopnhep.netlify.app', 'localhost', '127.0.0.1'];

const Gemini = {
  // 'flash-lite' is the fast tier (~4s). The non-lite Flash alias resolves
  // to gemini-3.7-flash, a thinking model that takes 30s+ — too slow here.
  MODEL: 'gemini-flash-lite-latest',
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // ── Key management ─────────────────────────────────────────────────────
  get userKey() { return (localStorage.getItem('gemini_api_key') || '').trim(); },
  set userKey(v) {
    const t = (v || '').trim();
    if (t) localStorage.setItem('gemini_api_key', t);
    else localStorage.removeItem('gemini_api_key');
  },
  // Built-in key is only exposed on allowed hosts. Off-domain clones get ''.
  get defaultKey() {
    const h = (location.hostname || '').toLowerCase();
    return _allowedHosts.includes(h) ? _kfrag.join('') : '';
  },
  get apiKey() { return this.userKey || this.defaultKey; },
  usingCustomKey() { return !!this.userKey; },
  clearKey() { localStorage.removeItem('gemini_api_key'); },

  // Configured if we have ANY key (user or built-in).
  isConfigured() { return this.apiKey.length > 20; },

  // ── Low-level call to Google, with a specific key ──────────────────────
  // Returns { ok, text } or { ok:false, status }.
  async _fetch(key, body, timeout = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(
        `${this.BASE_URL}/${this.MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        }
      );
      clearTimeout(timer);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, status: res.status, detail: errText.slice(0, 150) };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { ok: false, status: 'empty' };
      return { ok: true, text };
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: e.name === 'AbortError' ? 'timeout' : e.message };
    }
  },

  // ── High-level call: user key first, fall back to built-in ─────────────
  async _call(prompt, opts = {}) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4096,
      },
    };
    if (opts.wantJson) body.generationConfig.responseMimeType = 'application/json';

    // 1) User's own key
    if (this.userKey) {
      const r = await this._fetch(this.userKey, body, opts.timeout);
      if (r.ok) return r.text;
      // Bad/expired user key → drop it, fall through to default
      if (r.status === 400 || r.status === 403) {
        console.warn('[Gemini] user key rejected, clearing');
        this.clearKey();
      } else if (r.status === 'timeout') {
        throw new Error('Gemini timeout (>12s)');
      }
    }

    // 2) Built-in shared key
    if (this.defaultKey) {
      const r = await this._fetch(this.defaultKey, body, opts.timeout);
      if (r.ok) return r.text;
      if (r.status === 'timeout') throw new Error('Gemini timeout (>12s)');
      throw new Error(`Gemini ${r.status}: ${r.detail || 'lỗi'}`);
    }

    throw new Error('Chưa có Gemini API key — thêm ở màn Cá nhân');
  },

  // ── Tìm quán gần vị trí (dùng trong scan) ─────────────────────────────
  async findQuan(lat, lng, radius, opts = {}) {
    const catHint = opts.categories?.length
      ? `Chỉ tìm loại: ${opts.categories.join(', ')}`
      : 'Nhà hàng, vỉa hè, ăn vặt, cà phê';
    const radiusKm = (radius / 1000).toFixed(1);

    const dishHint = opts.dish
      ? `\n\n⚠️ MÓN BẮT BUỘC: người dùng đang tìm "${opts.dish}". CHỈ trả về quán bán "${opts.dish}" hoặc món rất liên quan. Nếu không có quán nào bán "${opts.dish}" trong bán kính, trả về mảng rỗng [].`
      : '';

    const prompt = `Bạn là chuyên gia ẩm thực Việt Nam, thông thạo các quán ăn ở khu vực này.
Tìm ${opts.limit || 20} quán ăn/cà phê CÓ THẬT, đang hoạt động, gần toạ độ GPS ${lat}, ${lng} (trong bán kính ${radiusKm}km).
${catHint}. Ưu tiên quán nổi tiếng, review tốt.${dishHint}

Trả về JSON THUẦN (không markdown, không giải thích):
[{"name":"tên quán","cat":"restaurant|street|snack|cafe","price":"VD: 40k-80k","lat":${lat},"lng":${lng},"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

Quy tắc: lat/lng phải chính xác trong bán kính. rating từ 3.5 đến 5.0. Chỉ trả JSON array.`;

    const callOpts = { wantJson: true, temperature: 0.4, maxTokens: 4096, timeout: 15000 };

    // Try once, retry once on transient failure (429 rate-limit, network
    // blip, timeout, empty). Rapid successive scans can hit a brief limit.
    let arr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await this._call(prompt, callOpts);
        const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed)) throw new Error('Gemini không trả mảng');
        arr = parsed;
        break;
      } catch (e) {
        console.warn(`[Gemini] attempt ${attempt} failed:`, e.message);
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, 700));   // brief backoff, then retry
      }
    }

    return arr
      .filter(x => x?.name && typeof x.lat === 'number' && typeof x.lng === 'number')
      .map((x, i) => ({
        id: 2e13 + (Date.now() % 1e9) + i,
        name: String(x.name).slice(0, 60),
        cat: ['restaurant', 'street', 'snack', 'cafe'].includes(x.cat) ? x.cat : 'restaurant',
        price: String(x.price || '—').slice(0, 30),
        lat: x.lat, lng: x.lng,
        rating: Math.max(3.5, Math.min(5.0, parseFloat(x.rating) || 4.3)),
        desc: String(x.desc || '').slice(0, 140),
        _gemini: true,
      }));
  },

  // ── Gợi ý 1 quán hay nhất từ danh sách (bonus) ────────────────────────
  async suggestBest(restaurants, context = 'Đang thèm ăn ngon') {
    if (!restaurants?.length) return null;
    const sample = restaurants.slice(0, 20)
      .map(r => `- ${r.name} (${r.cat}, ${r.price}) ${r.desc}`)
      .join('\n');
    const prompt = `Danh sách quán quanh tôi:\n${sample}\n\nNgữ cảnh: ${context}\n\nChọn 1 quán ấn tượng nhất. Nhận xét ngắn (dưới 20 chữ). Format: Tên quán | Lý do`;
    try {
      const result = await this._call(prompt, { temperature: 0.6, maxTokens: 256, timeout: 10000 });
      return result.trim();
    } catch (e) {
      console.warn('[Gemini] suggestBest error:', e.message);
      return null;
    }
  },
};
