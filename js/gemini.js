/* ═══════════════════════════════════════════════
   GEMINI AI INTEGRATION
   Two paths, chosen at call time:
     1) User set their own key in localStorage — call Google directly.
        Their key, their quota. We never touch it.
     2) No user key — call the /api/gemini Pages Function, which signs
        the request server-side with the shared GEMINI_API_KEY env var.
        The client never sees the shared key.
═══════════════════════════════════════════════ */
const Gemini = {
  MODEL: 'gemini-flash-latest', // stable alias — auto-tracks latest Flash
  DIRECT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  PROXY_URL: '/api/gemini',

  get userKey() {
    return localStorage.getItem('gemini_api_key') || '';
  },
  set userKey(val) {
    localStorage.setItem('gemini_api_key', val);
  },
  clearKey() {
    localStorage.removeItem('gemini_api_key');
  },

  // Always configured now — the server-side proxy is the fallback,
  // so scan() should never refuse to try. Kept for backwards-compat
  // with existing callers.
  isConfigured() { return true; },

  // Route: user key → direct Google API; no key → proxy; proxy fail → prompt for key.
  async _call(prompt, opts = {}) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4096,
      },
    };
    if (opts.wantJson && !opts.grounded) {
      body.generationConfig.responseMimeType = 'application/json';
    }
    if (opts.grounded) {
      body.tools = [{ google_search: {} }];
    }

    // Try direct first if user has a key
    if (this.userKey) {
      const result = await this._fetch(
        `${this.DIRECT_BASE}/${this.MODEL}:generateContent?key=${encodeURIComponent(this.userKey)}`,
        body, opts
      );
      if (result.ok) return result.text;
      if (result.status === 400 || result.status === 403) {
        this.clearKey();
        console.warn('[Gemini] user key invalid, cleared');
      }
    }

    // Try proxy
    const proxyResult = await this._fetch(this.PROXY_URL, { model: this.MODEL, ...body }, opts);
    if (proxyResult.ok) return proxyResult.text;

    // Proxy failed — prompt user for their own key
    if (!this.userKey) {
      const key = prompt('🔑 Nhập Gemini API key (lấy tại aistudio.google.com/apikey):');
      if (key?.trim()) {
        this.userKey = key.trim();
        const retryResult = await this._fetch(
          `${this.DIRECT_BASE}/${this.MODEL}:generateContent?key=${encodeURIComponent(this.userKey)}`,
          body, opts
        );
        if (retryResult.ok) return retryResult.text;
        if (retryResult.status === 400 || retryResult.status === 403) {
          this.clearKey();
        }
        throw new Error(`Gemini ${retryResult.status}: key lỗi`);
      }
    }

    throw new Error(`Gemini ${proxyResult.status}: proxy lỗi`);
  },

  async _fetch(url, body, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 12000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, status: res.status };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { ok: false, status: 'empty' };
      return { ok: true, text };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') return { ok: false, status: 'timeout' };
      return { ok: false, status: e.message };
    }
  },

  // ── Tìm quán gần vị trí (dùng trong scan) ─────────────────────────────
  async findQuan(lat, lng, radius, opts = {}) {
    const catHint = opts.categories?.length
      ? `Chỉ tìm: ${opts.categories.join(', ')}`
      : 'Nhà hàng, vỉa hè, ăn vặt, cà phê';
    const radiusKm = (radius / 1000).toFixed(1);

    const dishHint = opts.dish
      ? `\nMÓN CẦN TÌM: "${opts.dish}" — CHỈ trả về quán bán món "${opts.dish}" hoặc liên quan trực tiếp. Đây là yêu cầu bắt buộc.`
      : '';

    const prompt = `Bạn là chuyên gia ẩm thực Việt Nam. Tìm ${opts.limit || 20} quán ăn/cà phê thực tế, đang mở, gần GPS ${lat}, ${lng} (bán kính ${radiusKm}km).
${catHint}.${dishHint}
Ưu tiên quán nổi tiếng, review tốt trên Google Maps.

Trả về JSON THUẦN (không markdown fence):
[{"name":"...","cat":"restaurant|street|snack|cafe","price":"VD: 40k-80k","lat":21.xxx,"lng":105.xxx,"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

lat/lng chính xác. rating 3.5-5.0. Chỉ JSON array, không thêm chữ.`;

    let text;
    try {
      text = await this._call(prompt, { wantJson: true, grounded: true, temperature: 0.3, maxTokens: 4096 });
    } catch (e) {
      if (/429|quota|exceeded/i.test(e.message)) {
        console.warn('[Gemini] grounded quota → retry ungrounded');
        text = await this._call(prompt, { wantJson: true, grounded: false, temperature: 0.3, maxTokens: 4096 });
      } else throw e;
    }

    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let arr;
    try { arr = JSON.parse(text); } catch (e) {
      console.warn('[Gemini] JSON parse fail:', text.slice(0, 300));
      throw new Error('Gemini trả JSON hỏng');
    }
    if (!Array.isArray(arr)) throw new Error('Gemini không trả mảng');

    return arr
      .filter(x => x?.name && typeof x.lat === 'number' && typeof x.lng === 'number')
      .map((x, i) => ({
        id: 2e13 + Date.now() % 1e9 + i,
        name: String(x.name).slice(0, 60),
        cat: ['restaurant', 'street', 'snack', 'cafe'].includes(x.cat) ? x.cat : 'restaurant',
        price: String(x.price || '—').slice(0, 30),
        lat: x.lat, lng: x.lng,
        rating: Math.max(3.5, Math.min(5.0, parseFloat(x.rating) || 4.3)),
        desc: String(x.desc || '').slice(0, 140),
        _gemini: true,
      }));
  },

  // ── Gợi ý 1 quán hay nhất từ danh sách (bonus UI feature) ─────────────
  async suggestBest(restaurants, context = 'Đang thèm ăn ngon') {
    if (!restaurants?.length) return null;
    const sample = restaurants.slice(0, 20)
      .map(r => `- ${r.name} (${r.cat}, ${r.price}) ${r.desc}`)
      .join('\n');
    const prompt = `Danh sách quán quanh tôi:\n${sample}\n\nNgữ cảnh: ${context}\n\nChọn 1 quán ấn tượng nhất. Nhận xét ngắn (dưới 20 chữ). Format: Tên quán | Lý do`;
    try {
      const result = await this._call(prompt, { temperature: 0.6, maxTokens: 256 });
      return result.trim();
    } catch (e) {
      console.warn('[Gemini] suggestBest error:', e.message);
      return null;
    }
  },
};
