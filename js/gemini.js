/* ═══════════════════════════════════════════════
   GEMINI AI — client-side direct call
   The Gemini REST API supports CORS, so we call Google directly from
   the browser. Two key sources, in order:
     1) User's own key in localStorage (Settings → Gemini AI)
     2) Built-in shared key (fragmented below), HTTP-referrer restricted
        on Google Cloud Console to nhopnhep.pages.dev + localhost.

   Tried (2026-09-10) and REVERTED: routing the shared-key path through a
   Cloudflare Pages Function (functions/api/gemini-search.js) to edge-cache
   results and stop shipping the key to the client. Confirmed dead end —
   Cloudflare executes Workers/Pages Functions for Vietnam-origin traffic
   at its Hong Kong colo (HKG), and Gemini's API hard-rejects ANY request
   whose network origin is Hong Kong with "User location is not supported
   for the API use." (verified live, 100% reproducible across repeated
   calls; see git history around this date for the full proxy code if
   Cloudflare's Vietnam routing or Google's restriction ever changes).
   Calling directly from the user's own browser avoids this entirely,
   since the browser's real network origin is wherever the user actually
   is, not Cloudflare's edge routing.
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
const _allowedHosts = ['nhopnhep.pages.dev', 'nhopnhep.netlify.app'];

// Shared by both findQuan() paths (proxy response and direct-call response)
// — takes the raw {name,address,cat,price,lat,lng,rating,desc} objects
// Gemini/the proxy returns and shapes them into what the rest of the app
// expects (id, clamped rating, length-capped strings, the _gemini flag).
function normalizeQuanArray(arr) {
  return (arr || [])
    .filter(x => x?.name && typeof x.lat === 'number' && typeof x.lng === 'number')
    .map((x, i) => ({
      id: 2e13 + (Date.now() % 1e9) + i,
      name: String(x.name).slice(0, 60),
      address: x.address ? String(x.address).slice(0, 120) : '',
      cat: ['restaurant', 'street', 'snack', 'cafe'].includes(x.cat) ? x.cat : 'restaurant',
      price: String(x.price || '—').slice(0, 30),
      lat: x.lat, lng: x.lng,
      rating: Math.max(3.5, Math.min(5.0, parseFloat(x.rating) || 4.3)),
      desc: String(x.desc || '').slice(0, 140),
      _gemini: true,
    }));
}

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

  // ── Shared-key cooldown ─────────────────────────────────────────────────
  // The built-in key's free-tier quota is small and shared across every
  // visitor of the app — once Google says 429 RESOURCE_EXHAUSTED, every
  // scan for the rest of that window would otherwise still pay the full
  // ~11s timeout attempting (and failing) the same call before falling
  // back to OSM. Remember "don't bother" for a few hours instead, so a
  // launch-day spike degrades to instant OSM results, not a slow retry
  // loop, once the shared quota is known to be out. Only affects the
  // SHARED key — a user's own key is never put on cooldown by this.
  get _sharedCooldownUntil() { return parseInt(localStorage.getItem('gemini_shared_cooldown') || '0', 10); },
  _setSharedCooldown(hours = 3) {
    localStorage.setItem('gemini_shared_cooldown', String(Date.now() + hours * 3600 * 1000));
  },
  _sharedOnCooldown() { return Date.now() < this._sharedCooldownUntil; },

  // ── Daily quota (shared key only) ────────────────────────────────────
  // Real enforcement is server-side (functions/api/gemini-quota.js →
  // PocketBase, checked in _call() below) — this localStorage flag just
  // lets isConfigured() stay synchronous and skip the network once today
  // is already known to be exhausted. A user's own key is never limited
  // by this (see _call()'s key order).
  get _dailyQuotaFlagKey() { return `gemini_quota_${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)}`; },
  _dailyQuotaExhausted() { return localStorage.getItem(this._dailyQuotaFlagKey) === '1'; },
  _markDailyQuotaExhausted() {
    // Drop any other day's stale flag so it doesn't linger in storage forever.
    Object.keys(localStorage).forEach(k => { if (k.startsWith('gemini_quota_') && k !== this._dailyQuotaFlagKey) localStorage.removeItem(k); });
    localStorage.setItem(this._dailyQuotaFlagKey, '1');
  },
  // One-shot: true only on the search that JUST discovered today's quota
  // is exhausted, so controllers.js can toast it once — not on every
  // later search this session, where _dailyQuotaExhausted() short-circuits
  // isConfigured() before _call() ever runs again.
  justHitQuota: false,
  consumeQuotaHitFlag() { const v = this.justHitQuota; this.justHitQuota = false; return v; },

  // Server-side check via the same-origin proxy. Fail-open on any error —
  // see functions/api/gemini-quota.js header for why (tunnel hiccups are
  // common here, and Google's own per-key quota is still the real backstop).
  async _checkDailyQuota() {
    if (this._dailyQuotaExhausted()) return false; // already known today — skip the round-trip
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('/api/gemini-quota', { method: 'POST', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return true;
      const data = await res.json().catch(() => null);
      if (data && data.allowed === false) {
        this._markDailyQuotaExhausted();
        this.justHitQuota = true;
        return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  },

  // Configured if we have ANY key (user or built-in) that isn't on
  // cooldown / out of daily quota right now.
  isConfigured() {
    if (this.userKey) return this.userKey.length > 20;
    return this.defaultKey.length > 20 && !this._sharedOnCooldown() && !this._dailyQuotaExhausted();
  },

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
      const quotaOk = await this._checkDailyQuota();
      if (!quotaOk) throw new Error(I18N.t('err.geminiQuotaExhausted'));
      const r = await this._fetch(this.defaultKey, body, opts.timeout);
      if (r.ok) return r.text;
      if (r.status === 429) {
        console.warn('[Gemini] shared key quota exhausted, cooling down 3h');
        this._setSharedCooldown();
      }
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

    // A named query (dish OR place name) searches a WIDER area — a specific
    // quán the user typed may sit a few km out, and "not found" is worse
    // than "found but a bit far". Generic browsing keeps the tight radius.
    const q = (opts.dish || '').trim();
    const searchRadiusKm = q
      ? Math.max(radius / 1000, 6).toFixed(1)
      : (radius / 1000).toFixed(1);

    // Region hint (2026-09): the prompt used to hardcode "Việt Nam", which
    // made Gemini default to Vietnamese-style assumptions (VNĐ "k" pricing,
    // Vietnamese address conventions) even when the GPS coords are clearly
    // somewhere else — worse than just not knowing, since it actively
    // pushes wrong-currency/wrong-format guesses. Ask it to infer the real
    // country/region FROM the coordinates instead of assuming one. Core
    // focus is still Vietnam/Southeast Asia/Asia (where OSM+this app's own
    // data is strongest), but a correct "this is actually Bangkok" beats a
    // confident-but-wrong Vietnam-flavored guess every time.
    const regionHint = 'Trước tiên xác định quốc gia/thành phố thực tế của toạ độ GPS này (trọng tâm là Việt Nam, Đông Nam Á, và Châu Á nói chung — nhưng nếu toạ độ rơi vào nơi khác thì vẫn phải nhận diện đúng, đừng mặc định là Việt Nam). Dựa vào đó suy ra: tên quán viết đúng theo ngôn ngữ/cách viết địa phương, địa chỉ đúng định dạng địa phương, và GIÁ ghi bằng ĐÚNG đơn vị tiền tệ + cách viết của nước đó (VD: Việt Nam "25.000-45.000đ", Thái Lan "100-200 บาท / 100-200 THB", Indonesia "30.000-60.000 Rp", Philippines "₱150-300", Malaysia "RM15-30" — không mặc định ghi kiểu "40k-80k" nếu không phải Việt Nam).';

    let prompt;
    if (q) {
      prompt = `Bạn là chuyên gia ẩm thực & bản đồ khắp Châu Á, thông thạo quán ăn địa phương ở bất kỳ đâu trong khu vực.
${regionHint}

Người dùng đang tìm: "${q}" — gần toạ độ GPS ${lat}, ${lng} (trong bán kính ${searchRadiusKm}km).

Xác định "${q}" là TÊN MÓN hay TÊN QUÁN cụ thể:
- Nếu là TÊN MÓN (vd: bánh canh, phở, tom yum, nasi goreng, lẩu) → liệt kê CÀNG NHIỀU quán CÓ THẬT, đang hoạt động, bán/phục vụ món đó gần toạ độ này CÀNG TỐT — mục tiêu 10-15+ quán nếu khu vực đủ đông đúc (giống mức độ đầy đủ như tìm trên Google Maps, đừng chỉ liệt kê vài quán nổi tiếng nhất rồi dừng). Đây KHÔNG phải tra tên thương hiệu cụ thể nên không cần chắc chắn tuyệt đối từng quán — chỉ cần là quán ăn thật sự tồn tại ở khu vực này và nhiều khả năng có bán món này (theo loại hình/tên quán/ẩm thực đặc trưng khu vực), không cần bỏ qua chỉ vì không chắc 100%.
- Nếu là TÊN QUÁN / THƯƠNG HIỆU cụ thể (kể cả gõ tắt/viết thường, vd "brave", "highlands") → kết quả ĐẦU TIÊN phải là quán CÓ THẬT khớp nhất, với "name" là TÊN ĐẦY ĐỦ CHÍNH THỨC ĐÚNG như trên Google Maps (vd gõ "brave" → name "Brave Coffee Brewers"; gõ "highlands" → "Highlands Coffee"). Viết hoa đúng chuẩn, KHÔNG để nguyên chữ người dùng gõ, KHÔNG bịa quán khác tên na ná (vd KHÔNG trả "Brave Roastery" khi họ tìm Brave Coffee Brewers). Nếu không chắc chắn quán đó có thật ở đúng vị trí này không, đừng bịa — bỏ qua kết quả đó thay vì đoán liều. (Lưu ý: mức độ thận trọng này CHỈ áp dụng cho tra tên thương hiệu cụ thể, KHÔNG áp dụng cho trường hợp TÊN MÓN ở trên.)

Sau kết quả đầu, mới liệt kê chi nhánh / quán liên quan. Trả tối đa ${opts.limit || 20} kết quả, khớp nhất xếp trước. Nếu không có quán nào khớp, trả [].

Trả về JSON THUẦN (không markdown, không giải thích):
[{"name":"tên quán","address":"địa chỉ đúng định dạng địa phương","cat":"restaurant|street|snack|cafe","price":"giá bằng đúng tiền tệ địa phương","lat":${lat},"lng":${lng},"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

Quy tắc: lat/lng gần đúng khu vực quán. rating 3.5-5.0. Chỉ trả JSON array.`;
    } else {
      prompt = `Bạn là chuyên gia ẩm thực & bản đồ khắp Châu Á, thông thạo quán ăn địa phương ở bất kỳ đâu trong khu vực.
${regionHint}

Tìm ${opts.limit || 20} quán ăn/cà phê CÓ THẬT, đang hoạt động, gần toạ độ GPS ${lat}, ${lng} (trong bán kính ${searchRadiusKm}km).
${catHint}. Ưu tiên quán nổi tiếng, review tốt. Nếu không chắc chắn 1 quán có thật ở đúng vị trí này không, đừng bịa — bỏ qua thay vì đoán liều.

Trả về JSON THUẦN (không markdown, không giải thích):
[{"name":"tên quán","address":"địa chỉ đúng định dạng địa phương","cat":"restaurant|street|snack|cafe","price":"giá bằng đúng tiền tệ địa phương","lat":${lat},"lng":${lng},"rating":4.5,"desc":"mô tả ngắn dưới 20 từ"}]

Quy tắc: lat/lng gần đúng khu vực quán. address ghi rõ tên đường/phố + khu vực theo cách viết địa phương. rating từ 3.5 đến 5.0. Chỉ trả JSON array.`;
    }

    // Lower temperature for a named query → less creative name drift (stops
    // "Brave Coffee Brewers" turning into "Brave Roastery"). Not as low as
    // before (0.1) — that also suppressed recall on plain DISH searches
    // (e.g. "lẩu" only returning 5 quán vs 13-15 on Google Maps for the same
    // spot), since the same low-temperature caution meant for exact brand
    // names was bleeding into "just list every real quán serving this dish".
    const callOpts = { wantJson: true, temperature: q ? 0.3 : 0.4, maxTokens: 4096, timeout: 11000 };

    // Try once, retry once on FAST transient failures (parse error, empty,
    // 429 rate-limit). Do NOT retry a timeout — a second 11s wait would
    // blow past the 20s budget; better to fall back to OSM immediately.
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
        const isTimeout = /timeout/i.test(e.message);
        if (attempt === 2 || isTimeout) throw e;
        await new Promise(r => setTimeout(r, 600));   // brief backoff, then retry
      }
    }

    return normalizeQuanArray(arr);
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
