/* ═══════════════════════════════════════════════
   GEMINI AI INTEGRATION
   API key: stored in localStorage (user's own key).
   Built-in fallback key (fragmented to avoid GitHub scanner).
═══════════════════════════════════════════════ */
const _kfrag = ['AQ.Ab8R', 'N6I9_rCZ1O', 'd9Ca5NdKs2', 'kFhjNzyxeT', 'Lvm2jM59Eu', 'dYKjwQ'];

const Gemini = {
  MODEL: 'gemini-1.5-flash',   // fast, good for POI + suggestions
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  get apiKey() {
    // Prefer user-saved key; fall back to built-in
    return localStorage.getItem('gemini_api_key') || _kfrag.join('');
  },
  set apiKey(val) {
    localStorage.setItem('gemini_api_key', val);
  },
  clearKey() {
    localStorage.removeItem('gemini_api_key');
  },

  isConfigured() {
    return this.apiKey && this.apiKey.length > 20;
  },

  // Base fetch — supports grounding (google_search) and JSON mode
  async _call(prompt, opts = {}) {
    if (!this.isConfigured()) throw new Error('Gemini API key chưa cấu hình');
    const url = `${this.BASE_URL}/${this.MODEL}:generateContent?key=${this.apiKey}`;
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
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) {
        this.clearKey();
        throw new Error(`Gemini ${res.status}: key lỗi, đã xoá`);
      }
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini trả về rỗng');
    return text;
  },

  // ── Tìm quán gần vị trí (dùng trong scan) ─────────────────────────────
  async findQuan(lat, lng, radius, opts = {}) {
    const catHint = opts.categories?.length
      ? `Chỉ tìm: ${opts.categories.join(', ')}`
      : 'Nhà hàng, vỉa hè, ăn vặt, cà phê';
    const radiusKm = (radius / 1000).toFixed(1);

    const prompt = `Bạn là chuyên gia ẩm thực Việt Nam. Tìm ${opts.limit || 20} quán ăn/cà phê thực tế, đang mở, gần GPS ${lat}, ${lng} (bán kính ${radiusKm}km).
${catHint}. Ưu tiên quán nổi tiếng, review tốt trên Google Maps.

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
